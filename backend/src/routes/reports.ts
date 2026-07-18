/**
 * Reports routes.
 *
 * GET  /                    — list available reports (from Pages storage or in-memory)
 * POST /generate            — generate a report snapshot and return it
 * GET  /export              — download a report as xlsx|csv|json|pdf|md|html
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import PDFDocument from 'pdfkit';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import type { SheetsService } from '../services/sheets.js';
import type { Report, ReportPeriod } from '@uptime/shared';

function getService(req: Request): SheetsService {
  return req.app.locals.sheetsService as SheetsService;
}

const generateSchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']).optional().default('daily'),
  from: z.string().optional(),
  to: z.string().optional(),
});

const exportSchema = z.object({
  format: z.enum(['xlsx', 'csv', 'json', 'pdf', 'md', 'html']).optional().default('json'),
  period: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']).optional().default('daily'),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const reportsRouter: import('express').Router = Router();

// ── GET / — list ──────────────────────────────────────────────────────────────

reportsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const pagesBase = process.env.PAGES_BASE_URL || '';
    if (pagesBase) {
      try {
        const r = await fetch(`${pagesBase}/reports/index.json`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const index = await r.json();
          res.json({ items: Array.isArray(index) ? index : [] });
          return;
        }
      } catch {
        // fall through to empty list
      }
    }
    res.json({ items: [] });
  }),
);

// ── POST /generate — build a report from live data ───────────────────────────

reportsRouter.post(
  '/generate',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Invalid report parameters');

    const { period, from, to } = parsed.data;
    const svc = getService(req);
    const report = await buildReport(svc, period as ReportPeriod, from, to);
    res.status(201).json(report);
  }),
);

// ── GET /export — download a report ──────────────────────────────────────────

reportsRouter.get(
  '/export',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = exportSchema.safeParse(req.query);
    if (!parsed.success) throw ApiError.badRequest('Invalid export parameters');

    const { format, period, from, to } = parsed.data;
    const svc = getService(req);
    const report = await buildReport(svc, period as ReportPeriod, from, to);

    const date = new Date().toISOString().slice(0, 10);
    const filename = `uptime-report-${period}-${date}`;

    switch (format) {
      case 'json': {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
        res.json(report);
        break;
      }

      case 'csv': {
        // Flatten worst performers for CSV
        const rows = report.worstPerformers.map((d) => ({
          domain: d.domain,
          status: d.status,
          responseTimeMs: d.responseTimeMs,
          healthScore: d.healthScore,
          riskScore: d.riskScore,
          sslDaysRemaining: d.sslDaysRemaining ?? '',
          note: d.note,
        }));
        const csv = Papa.unparse(rows);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        res.send(csv);
        break;
      }

      case 'xlsx': {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'Uptime Platform';

        // Summary sheet
        const sumSheet = wb.addWorksheet('Summary');
        sumSheet.columns = [
          { header: 'Metric', key: 'metric', width: 30 },
          { header: 'Value', key: 'value', width: 20 },
        ];
        sumSheet.getRow(1).font = { bold: true };
        const kpis = report.kpis;
        [
          ['Total Domains', kpis.totalDomains],
          ['Up', kpis.healthy],
          ['Down', kpis.down],
          ['Degraded', kpis.degraded],
          ['Avg Health Score', kpis.avgHealthScore],
          ['Avg Response Time (ms)', kpis.avgResponseTimeMs],
          ['SSL Expiring (≤30d)', kpis.sslExpiringSoon],
        ].forEach(([m, v]) => sumSheet.addRow({ metric: m, value: v }));

        // Worst performers sheet
        const wpSheet = wb.addWorksheet('Worst Performers');
        wpSheet.columns = [
          { header: 'Domain', key: 'domain', width: 35 },
          { header: 'Status', key: 'status', width: 12 },
          { header: 'Response Time (ms)', key: 'responseTimeMs', width: 20 },
          { header: 'Health Score', key: 'healthScore', width: 14 },
          { header: 'Risk Score', key: 'riskScore', width: 12 },
          { header: 'Note', key: 'note', width: 40 },
        ];
        wpSheet.getRow(1).font = { bold: true };
        report.worstPerformers.forEach((d) => wpSheet.addRow(d));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        res.send(await wb.xlsx.writeBuffer());
        break;
      }

      case 'pdf': {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
        doc.pipe(res);

        doc.fontSize(20).font('Helvetica-Bold').text('Uptime Platform — Report', { align: 'center' });
        doc.fontSize(11).font('Helvetica').text(`Period: ${period}  |  Generated: ${report.generatedAt}`, { align: 'center' });
        doc.moveDown();

        // KPIs
        doc.fontSize(14).font('Helvetica-Bold').text('KPI Summary');
        doc.fontSize(10).font('Helvetica');
        doc.text(`Total: ${report.kpis.totalDomains}  Up: ${report.kpis.healthy}  Down: ${report.kpis.down}  Degraded: ${report.kpis.degraded}`);
        doc.text(`Avg Health: ${report.kpis.avgHealthScore}  Avg Response: ${report.kpis.avgResponseTimeMs}ms  SSL Expiring: ${report.kpis.sslExpiringSoon}`);
        doc.moveDown();

        // Recommendations
        if (report.recommendations.length > 0) {
          doc.fontSize(14).font('Helvetica-Bold').text('Recommendations');
          doc.fontSize(10).font('Helvetica');
          report.recommendations.forEach((r) => doc.text(`• ${r}`));
          doc.moveDown();
        }

        // Worst performers table
        doc.fontSize(14).font('Helvetica-Bold').text('Worst Performers');
        doc.fontSize(8).font('Helvetica');
        report.worstPerformers.slice(0, 20).forEach((d) => {
          doc.text(`${d.domain}  |  ${d.status}  |  Health: ${d.healthScore}  |  ${d.note}`);
        });

        doc.end();
        break;
      }

      case 'md': {
        const md = buildMarkdownReport(report, period);
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.md"`);
        res.send(md);
        break;
      }

      case 'html': {
        const html = buildHtmlReport(report, period);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.html"`);
        res.send(html);
        break;
      }
    }
  }),
);

// ── Report builder ────────────────────────────────────────────────────────────

async function buildReport(svc: SheetsService, period: ReportPeriod, from?: string, to?: string): Promise<Report> {
  const [kpis, distributions, incidents] = await Promise.all([
    svc.getKpis(),
    svc.getDistributions(),
    svc.getIncidents(),
  ]);

  const allDomains = await svc.readAllDomains();

  const now = new Date();
  const rangeEnd = to ?? now.toISOString().slice(0, 10);
  const rangeStart = from ?? (period === 'daily'
    ? rangeEnd
    : period === 'weekly'
    ? new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10)
    : period === 'monthly'
    ? new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)
    : period === 'quarterly'
    ? new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10)
    : new Date(now.getTime() - 365 * 86400000).toISOString().slice(0, 10));

  // Worst performers by risk score
  const worstPerformers = allDomains
    .filter((r) => r.record.status !== 'PAUSED')
    .sort((a, b) => parseInt(b.record.riskScore, 10) - parseInt(a.record.riskScore, 10))
    .slice(0, 50)
    .map((r) => ({
      domain: r.record.domain,
      status: r.record.status,
      responseTimeMs: parseInt(r.record.responseTime, 10) || 0,
      healthScore: parseInt(r.record.healthScore, 10) || 0,
      riskScore: parseInt(r.record.riskScore, 10) || 0,
      sslDaysRemaining: r.record.sslDaysRemaining ? parseInt(r.record.sslDaysRemaining, 10) : null,
      note: r.record.errorMessage || '',
    }));

  // SSL expiring
  const sslExpiring = allDomains
    .filter((r) => {
      const days = parseInt(r.record.sslDaysRemaining, 10);
      return !isNaN(days) && days >= 0 && days <= 30;
    })
    .map((r) => ({
      domain: r.record.domain,
      status: r.record.status,
      responseTimeMs: parseInt(r.record.responseTime, 10) || 0,
      healthScore: parseInt(r.record.healthScore, 10) || 0,
      riskScore: parseInt(r.record.riskScore, 10) || 0,
      sslDaysRemaining: parseInt(r.record.sslDaysRemaining, 10),
      note: `SSL expires in ${r.record.sslDaysRemaining} days`,
    }));

  // Recommendations
  const recommendations: string[] = [];
  if (kpis.sslExpiringSoon > 0) recommendations.push(`Renew SSL for ${kpis.sslExpiringSoon} domains expiring within 30 days`);
  if (kpis.down > 0) recommendations.push(`Investigate ${kpis.down} domains currently reporting DOWN status`);
  if (kpis.avgHealthScore < 70) recommendations.push('Average health score is below 70 — review performance and SSL issues');
  if (kpis.avgResponseTimeMs > 2000) recommendations.push('Average response time exceeds 2s — consider CDN or server optimisation');

  return {
    id: `${period}-${rangeEnd}`,
    period,
    rangeStart,
    rangeEnd,
    generatedAt: now.toISOString(),
    kpis,
    distributions,
    incidents: incidents.map((i) => ({
      domain: i.domain,
      type: i.type,
      openedAt: i.openedAt,
      resolvedAt: i.resolvedAt,
      message: i.message,
    })),
    worstPerformers,
    sslExpiring,
    recommendations,
  };
}

function buildMarkdownReport(report: Report, period: string): string {
  const kpis = report.kpis;
  const lines = [
    `# Uptime Platform — ${period.charAt(0).toUpperCase() + period.slice(1)} Report`,
    ``,
    `**Generated:** ${report.generatedAt}  |  **Period:** ${report.rangeStart} → ${report.rangeEnd}`,
    ``,
    `## KPI Summary`,
    ``,
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Total Domains | ${kpis.totalDomains} |`,
    `| Up | ${kpis.healthy} |`,
    `| Down | ${kpis.down} |`,
    `| Degraded | ${kpis.degraded} |`,
    `| Avg Health Score | ${kpis.avgHealthScore} |`,
    `| Avg Response Time | ${kpis.avgResponseTimeMs}ms |`,
    `| SSL Expiring ≤30d | ${kpis.sslExpiringSoon} |`,
    ``,
    `## Recommendations`,
    ``,
    ...(report.recommendations.length ? report.recommendations.map((r) => `- ${r}`) : ['- No critical issues found.']),
    ``,
    `## Worst Performers (Top 20)`,
    ``,
    `| Domain | Status | Health | Risk | Note |`,
    `| --- | --- | --- | --- | --- |`,
    ...report.worstPerformers.slice(0, 20).map((d) =>
      `| ${d.domain} | ${d.status} | ${d.healthScore} | ${d.riskScore} | ${d.note || '—'} |`,
    ),
  ];
  return lines.join('\n');
}

function buildHtmlReport(report: Report, period: string): string {
  const kpis = report.kpis;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Uptime Report — ${period}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 1100px; margin: 40px auto; color: #1e293b; }
  h1 { color: #1e40af; border-bottom: 2px solid #1e40af; padding-bottom: 8px; }
  h2 { color: #3b82f6; margin-top: 32px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 16px 0; }
  .kpi { background: #f1f5f9; border-radius: 8px; padding: 16px; text-align: center; }
  .kpi .value { font-size: 2rem; font-weight: 700; color: #1e40af; }
  .kpi .label { font-size: 0.85rem; color: #64748b; margin-top: 4px; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  th { background: #1e40af; color: white; padding: 8px 12px; text-align: left; }
  td { border: 1px solid #e2e8f0; padding: 6px 12px; }
  tr:nth-child(even) td { background: #f8fafc; }
  ul { padding-left: 20px; }
  li { margin: 4px 0; }
</style>
</head>
<body>
<h1>Uptime Platform — ${period.charAt(0).toUpperCase() + period.slice(1)} Report</h1>
<p><strong>Generated:</strong> ${report.generatedAt} &nbsp;|&nbsp; <strong>Period:</strong> ${report.rangeStart} → ${report.rangeEnd}</p>

<h2>KPI Summary</h2>
<div class="kpi-grid">
  <div class="kpi"><div class="value">${kpis.totalDomains}</div><div class="label">Total Domains</div></div>
  <div class="kpi"><div class="value">${kpis.healthy}</div><div class="label">Up</div></div>
  <div class="kpi"><div class="value">${kpis.down}</div><div class="label">Down</div></div>
  <div class="kpi"><div class="value">${kpis.avgHealthScore}</div><div class="label">Avg Health</div></div>
  <div class="kpi"><div class="value">${kpis.avgResponseTimeMs}ms</div><div class="label">Avg Response</div></div>
  <div class="kpi"><div class="value">${kpis.sslExpiringSoon}</div><div class="label">SSL Expiring</div></div>
</div>

<h2>Recommendations</h2>
<ul>${report.recommendations.length ? report.recommendations.map((r) => `<li>${escHtml(r)}</li>`).join('') : '<li>No critical issues found.</li>'}</ul>

<h2>Worst Performers</h2>
<table>
<thead><tr><th>Domain</th><th>Status</th><th>Health</th><th>Risk</th><th>Note</th></tr></thead>
<tbody>
${report.worstPerformers.slice(0, 30).map((d) =>
  `<tr><td>${escHtml(d.domain)}</td><td>${escHtml(d.status)}</td><td>${d.healthScore}</td><td>${d.riskScore}</td><td>${escHtml(d.note || '—')}</td></tr>`,
).join('\n')}
</tbody>
</table>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
