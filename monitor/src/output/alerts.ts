/**
 * Alert notifications.
 *
 * After the aggregate step detects incident transitions, sends one digest per
 * run to every configured channel:
 *
 *   SLACK_WEBHOOK_URL   Slack incoming webhook (Block Kit message).
 *   ALERT_WEBHOOK_URL   Generic JSON POST (Datadog/PagerDuty/n8n/Zapier style).
 *   RESEND_API_KEY      Email via Resend, with ALERT_EMAIL_FROM / ALERT_EMAIL_TO.
 *
 * All channels are optional and fail-soft: a delivery error is logged but
 * never fails the run. Nothing is sent when there were no transitions.
 */
import type { Incident, RunSummary } from '@uptime/shared';
import type { Logger } from '../logging.js';
import { errMessage } from '../logging.js';

/** Incident transitions from one run. */
export interface AlertPayload {
  opened: Incident[];
  resolved: Incident[];
  summary: RunSummary;
  /** Dashboard URL for links (optional). */
  dashboardUrl: string;
}

/** Read alert channel config from the environment. */
function channels(): { slack: string; webhook: string; resendKey: string; from: string; to: string[] } {
  return {
    slack: process.env.SLACK_WEBHOOK_URL ?? '',
    webhook: process.env.ALERT_WEBHOOK_URL ?? '',
    resendKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.ALERT_EMAIL_FROM ?? '',
    to: (process.env.ALERT_EMAIL_TO ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** Send the digest to every configured channel. Never throws. */
export async function sendAlerts(payload: AlertPayload, logger: Logger): Promise<void> {
  const { opened, resolved } = payload;
  if (opened.length === 0 && resolved.length === 0) {
    logger.info('No incident transitions — skipping alerts');
    return;
  }

  const cfg = channels();
  const tasks: Promise<void>[] = [];
  if (cfg.slack) tasks.push(deliver('slack', () => sendSlack(cfg.slack, payload), logger));
  if (cfg.webhook) tasks.push(deliver('webhook', () => sendWebhook(cfg.webhook, payload), logger));
  if (cfg.resendKey && cfg.from && cfg.to.length > 0) {
    tasks.push(deliver('email', () => sendEmail(cfg.resendKey, cfg.from, cfg.to, payload), logger));
  }

  if (tasks.length === 0) {
    logger.info('No alert channels configured', { opened: opened.length, resolved: resolved.length });
    return;
  }
  await Promise.all(tasks);
}

/** Run one channel delivery, logging success/failure without throwing. */
async function deliver(name: string, fn: () => Promise<void>, logger: Logger): Promise<void> {
  try {
    await fn();
    logger.info(`Alert sent`, { channel: name });
  } catch (err) {
    logger.warn(`Alert delivery failed`, { channel: name, error: errMessage(err) });
  }
}

/** POST JSON with a timeout; throws on non-2xx. */
async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ── Slack ─────────────────────────────────────────────────────────────────────

/** Emoji per incident type. */
function typeEmoji(type: Incident['type']): string {
  switch (type) {
    case 'DOWN': return ':red_circle:';
    case 'DNS_FAILURE': return ':warning:';
    case 'DEGRADED': return ':large_yellow_circle:';
    case 'SSL_EXPIRING': return ':lock:';
    case 'SSL_EXPIRED': return ':unlock:';
    default: return ':large_green_circle:';
  }
}

async function sendSlack(url: string, p: AlertPayload): Promise<void> {
  const lines: string[] = [];
  for (const i of p.opened.slice(0, 15)) {
    lines.push(`${typeEmoji(i.type)} *${i.domain}* — ${i.message}`);
  }
  for (const i of p.resolved.slice(0, 15)) {
    const dur = i.durationSeconds !== null ? ` (down ${fmtDur(i.durationSeconds)})` : '';
    lines.push(`:large_green_circle: *${i.domain}* — resolved${dur}`);
  }
  const more = p.opened.length + p.resolved.length - lines.length;
  if (more > 0) lines.push(`…and ${more} more`);

  const header =
    p.opened.length > 0
      ? `:rotating_light: ${p.opened.length} incident(s) opened, ${p.resolved.length} resolved`
      : `:white_check_mark: ${p.resolved.length} incident(s) resolved`;

  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: 'Uptime Monitor', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${header}*\n${lines.join('\n')}` } },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Run ${p.summary.runId} · ${p.summary.up} up / ${p.summary.down} down of ${p.summary.totalDomains}${p.dashboardUrl ? ` · <${p.dashboardUrl}|dashboard>` : ''}`,
        },
      ],
    },
  ];
  await postJson(url, { text: header, blocks });
}

// ── Generic webhook ───────────────────────────────────────────────────────────

async function sendWebhook(url: string, p: AlertPayload): Promise<void> {
  await postJson(url, {
    source: 'uptime-monitor',
    runId: p.summary.runId,
    finishedAt: p.summary.finishedAt,
    opened: p.opened,
    resolved: p.resolved,
    summary: {
      totalDomains: p.summary.totalDomains,
      up: p.summary.up,
      down: p.summary.down,
      degraded: p.summary.degraded,
    },
  });
}

// ── Email (Resend) ────────────────────────────────────────────────────────────

async function sendEmail(apiKey: string, from: string, to: string[], p: AlertPayload): Promise<void> {
  const subject =
    p.opened.length > 0
      ? `🔴 ${p.opened.length} incident(s) opened — uptime monitor`
      : `✅ ${p.resolved.length} incident(s) resolved — uptime monitor`;

  const row = (i: Incident, kind: 'opened' | 'resolved'): string => {
    const color = kind === 'opened' ? '#dc2626' : '#16a34a';
    const dur = i.durationSeconds !== null ? ` · down ${fmtDur(i.durationSeconds)}` : '';
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;"><strong style="color:${color}">${i.domain}</strong></td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${i.type}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(i.message)}${dur}</td>
    </tr>`;
  };

  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px">
    <h2 style="margin:0 0 4px">Uptime Monitor</h2>
    <p style="margin:0 0 16px;color:#6b7280">Run ${p.summary.runId} · ${p.summary.up} up / ${p.summary.down} down of ${p.summary.totalDomains}</p>
    ${p.opened.length ? `<h3 style="color:#dc2626">Opened (${p.opened.length})</h3><table style="border-collapse:collapse;width:100%">${p.opened.map((i) => row(i, 'opened')).join('')}</table>` : ''}
    ${p.resolved.length ? `<h3 style="color:#16a34a">Resolved (${p.resolved.length})</h3><table style="border-collapse:collapse;width:100%">${p.resolved.map((i) => row(i, 'resolved')).join('')}</table>` : ''}
    ${p.dashboardUrl ? `<p style="margin-top:16px"><a href="${p.dashboardUrl}">Open dashboard →</a></p>` : ''}
  </div>`;

  await postJson(
    'https://api.resend.com/emails',
    { from, to, subject, html },
    { Authorization: `Bearer ${apiKey}` },
  );
}

/** "2h 5m" / "3m" / "45s" from seconds. */
function fmtDur(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
