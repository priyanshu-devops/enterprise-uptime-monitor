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
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
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

/** Manages one browser instance for a batch of captures. */
export class ScreenshotEngine {
  private browser: Browser | null = null;

  constructor(
    private readonly outputDir: string,
    private readonly logger: Logger,
  ) {}

  /** Lazily launch the shared browser. */
  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
    }
    return this.browser;
  }

  /**
   * Capture desktop + mobile screenshots for one domain.
   *
   * @param domain Normalized domain (used for the output path).
   * @param url URL to load (final URL from the HTTP stage is best).
   */
  async capture(domain: string, url: string): Promise<ScreenshotResult> {
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

    try {
      await mkdir(dir, { recursive: true });
      const browser = await this.ensureBrowser();

      const desktopBuf = await this.shoot(browser, url, DESKTOP);
      await sharp(desktopBuf).jpeg({ quality: JPEG_QUALITY }).toFile(desktopPath);
      await sharp(desktopBuf)
        .resize({ width: THUMB_WIDTH })
        .jpeg({ quality: JPEG_QUALITY })
        .toFile(thumbPath);

      let mobileOk = true;
      try {
        const mobileBuf = await this.shoot(browser, url, MOBILE);
        await sharp(mobileBuf).jpeg({ quality: JPEG_QUALITY }).toFile(mobilePath);
      } catch (err) {
        mobileOk = false;
        this.logger.warn('Mobile screenshot failed', { domain, error: errMessage(err) });
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
    }
  }

  /** Load a URL at a viewport and return a PNG buffer (retries once). */
  private async shoot(
    browser: Browser,
    url: string,
    viewport: { width: number; height: number },
  ): Promise<Buffer> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const context = await browser.newContext({
        viewport,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        ignoreHTTPSErrors: true,
      });
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await page.waitForTimeout(SETTLE_MS);
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
