/**
 * Screenshot capture engine.
 *
 * Uses a single shared Playwright Chromium browser per shard with a small pool
 * of contexts. Captures a desktop and a mobile viewport-only screenshot, then
 * uses sharp to produce optimized JPEGs plus a thumbnail at stable paths:
 *
 *   screenshots/{domain}/desktop.jpg
 *   screenshots/{domain}/mobile.jpg
 *   screenshots/{domain}/thumb.jpg
 *
 * Stable paths mean the sheet's =IMAGE() URLs never change between runs.
 *
 * Memory bounds (audit C-6): third-party media/fonts/analytics are blocked at
 * the network layer, each page has a total download budget, and the browser
 * process is recycled after a fixed number of captures so Chromium's
 * accumulated heap/renderer state can't grow across a large shard.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import type { ScreenshotResult } from '@uptime/shared';
import type { Logger } from '../logging.js';
import { errMessage } from '../logging.js';

const DESKTOP = { width: 1366, height: 768 };
const MOBILE = { width: 390, height: 844 };
const THUMB_WIDTH = 320;
const JPEG_QUALITY = 70;
const NAV_TIMEOUT_MS = 15_000;
const SETTLE_MS = 2500;

/** Recycle the browser process after this many captures (bounds Chromium memory). */
const RECYCLE_AFTER_CAPTURES = 40;

/** Total bytes a single page load may download before further requests are cut. */
const PAGE_BYTE_BUDGET = 15 * 1024 * 1024;

/**
 * Resource types that don't affect a viewport screenshot but dominate page
 * weight. Images and stylesheets are kept — they ARE the screenshot.
 */
const BLOCKED_RESOURCE_TYPES = new Set(['media', 'font']);

/** Analytics/ad/tracking hosts — irrelevant to rendering, often megabytes. */
const BLOCKED_URL_RE =
  /google-analytics\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|adservice\.google|connect\.facebook\.net|hotjar\.com|mixpanel\.com|segment\.(io|com)|clarity\.ms|fullstory\.com|intercom\.io|newrelic\.com|nr-data\.net/i;

/** Sleep that resolves early when the signal aborts (replaces waitForTimeout). */
function settle(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      signal?.removeEventListener('abort', done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Manages one browser instance for a batch of captures. */
export class ScreenshotEngine {
  private browser: Browser | null = null;
  private captures = 0;
  private inFlight = 0;

  constructor(
    private readonly outputDir: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Lazily launch the shared browser; recycle it after N captures. Recycling
   * only happens when this capture is the sole user — closing a browser out
   * from under a concurrent capture would fail its contexts.
   */
  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.captures >= RECYCLE_AFTER_CAPTURES && this.inFlight <= 1) {
      this.logger.info('Recycling browser', { captures: this.captures });
      await this.close();
    }
    if (!this.browser) {
      // --no-sandbox is a container workaround, not a default: only CI runners
      // (rootless containers without user namespaces) need it.
      const args = ['--disable-dev-shm-usage', '--disable-gpu'];
      if (process.env.CI) args.push('--no-sandbox');
      this.browser = await chromium.launch({ headless: true, args });
      this.captures = 0;
    }
    return this.browser;
  }

  /**
   * Capture desktop + mobile screenshots for one domain.
   *
   * @param domain Normalized domain (used for the output path).
   * @param url URL to load (final URL from the HTTP stage is best).
   * @param signal Optional abort (per-domain budget) — skips remaining work.
   */
  async capture(domain: string, url: string, signal?: AbortSignal): Promise<ScreenshotResult> {
    const dir = path.join(this.outputDir, 'screenshots', domain);
    const desktopPath = path.join(dir, 'desktop.jpg');
    const mobilePath = path.join(dir, 'mobile.jpg');
    const thumbPath = path.join(dir, 'thumb.jpg');

    const empty: ScreenshotResult = {
      ok: false,
      desktopPath: '',
      mobilePath: '',
      thumbPath: '',
    };

    if (!url) return { ...empty, error: 'No URL to capture' };
    if (signal?.aborted) return { ...empty, error: 'Screenshot skipped (budget exceeded)' };

    this.inFlight++;
    try {
      await mkdir(dir, { recursive: true });
      const browser = await this.ensureBrowser();
      this.captures++;

      const desktopBuf = await this.shoot(browser, url, DESKTOP, signal);
      await sharp(desktopBuf).jpeg({ quality: JPEG_QUALITY }).toFile(desktopPath);
      await sharp(desktopBuf)
        .resize({ width: THUMB_WIDTH })
        .jpeg({ quality: JPEG_QUALITY })
        .toFile(thumbPath);

      let mobileOk = true;
      if (signal?.aborted) {
        mobileOk = false;
      } else {
        try {
          const mobileBuf = await this.shoot(browser, url, MOBILE, signal);
          await sharp(mobileBuf).jpeg({ quality: JPEG_QUALITY }).toFile(mobilePath);
        } catch (err) {
          mobileOk = false;
          this.logger.warn('Mobile screenshot failed', { domain, error: errMessage(err) });
        }
      }

      return {
        ok: true,
        desktopPath: relPath(this.outputDir, desktopPath),
        mobilePath: mobileOk ? relPath(this.outputDir, mobilePath) : '',
        thumbPath: relPath(this.outputDir, thumbPath),
      };
    } catch (err) {
      this.logger.warn('Screenshot capture failed', { domain, error: errMessage(err) });
      return { ...empty, error: errMessage(err) };
    } finally {
      this.inFlight--;
    }
  }

  /** Load a URL at a viewport and return a PNG buffer (retries once). */
  private async shoot(
    browser: Browser,
    url: string,
    viewport: { width: number; height: number },
    signal?: AbortSignal,
  ): Promise<Buffer> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) break;
      const context = await browser.newContext({
        viewport,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        ignoreHTTPSErrors: true,
      });
      const page = await context.newPage();
      await this.boundPage(page);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await settle(SETTLE_MS, signal);
        const buf = await page.screenshot({ type: 'png', fullPage: false });
        return buf;
      } catch (err) {
        lastErr = err;
      } finally {
        await context.close().catch(() => undefined);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('screenshot failed');
  }

  /**
   * Attach network-layer bounds to a page: block heavyweight/irrelevant
   * resources and cut off requests once the total download budget is spent.
   */
  private async boundPage(page: Page): Promise<void> {
    let bytesLeft = PAGE_BYTE_BUDGET;

    page.on('response', (res) => {
      const len = Number(res.headers()['content-length']);
      if (Number.isFinite(len)) bytesLeft -= len;
    });

    await page.route('**/*', (route) => {
      const req = route.request();
      if (
        bytesLeft <= 0 ||
        BLOCKED_RESOURCE_TYPES.has(req.resourceType()) ||
        BLOCKED_URL_RE.test(req.url())
      ) {
        return route.abort();
      }
      return route.continue();
    });
  }

  /** Close the shared browser. Safe to call multiple times. */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }
}

/** Path relative to the output dir, using forward slashes for URLs. */
function relPath(outputDir: string, file: string): string {
  return path.relative(outputDir, file).split(path.sep).join('/');
}

/** Write a raw buffer to disk (used by tests/utilities). */
export async function writeBuffer(file: string, buf: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
}
