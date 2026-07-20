/**
 * Export route — GET /api/v1/export
 *
 * Query params:
 *   format  xlsx | csv | json | pdf | md | html  (default: json)
 *   status  optional status filter
 *   q       optional search filter
 *
 * Responds with the appropriate Content-Disposition attachment.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import PDFDocument from 'pdfkit';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import type { ServiceContainer } from '../services/db.js';
import { sanitizeSheetCell, type DomainRecord } from '@uptime/shared';

const querySchema = z.object({
  format: z.enum(['xlsx', 'csv', 'json', 'pdf', 'md', 'html']).optional().default('json'),
  status: z.string().optional(),
  q: z.string().optional(),
});

function getService(req: Request): ServiceContainer {
  return req.app.locals.services as ServiceContainer;
}

const EXPORT_COLUMNS: Array<keyof DomainRecord> = [
  'company', 'project', 'owner', 'department', 'website', 'domain',
  'status', 'httpStatus', 'https', 'responseTime', 'ttfb',
  'sslExpiry', 'sslDaysRemaining', 'sslIssuer', 'tlsVersion',
  'domainExpiry', 'serverIp', 'dns', 'nameservers',
  'hostingProvider', 'cdn', 'cloudflare', 'wordpress', 'cms', 'framework',
  'metaTitle', 'securityHeaders', 'pageSize', 'favicon',
  'lastCheckedDate', 'lastCheckedTime', 'healthScore', 'riskScore',
  'notes', 'tags', 'category',
];

export const exportRouter: import('express').Router = Router();

exportRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw ApiError.badRequest('Invalid query parameters');

    const { format, status, q } = parsed.data;
    const svc = getService(req);

    const result = await svc.domains.getDomains({ status, q, pageSize: 10000 });
    const domains = result.items.map((r) => r.record);

    const date = new Date().toISOString().slice(0, 10);
    const filename = `uptime-export-${date}`;

    switch (format) {
      case 'json': {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
        res.json(domains);
        break;
      }

      case 'csv': {
        // Neutralize formula injection: a cell exported to CSV and reopened in
        // Excel/Sheets must never evaluate as a formula (CWE-1236). (audit C-4)
        const csv = Papa.unparse(domains.map((d) => {
          const row: Record<string, string> = {};
          for (const col of EXPORT_COLUMNS) {
            row[col] = sanitizeSheetCell(String(d[col] ?? '')) as string;
          }
          return row;
        }));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        res.send(csv);
        break;
      }

      case 'xlsx': {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Uptime Platform';
        const sheet = workbook.addWorksheet('Domains');

        sheet.columns = EXPORT_COLUMNS.map((col) => ({
          header: col,
          key: col,
          width: 20,
        }));

        // Style header row
        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1E40AF' },
        };
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        for (const domain of domains) {
          const row: Record<string, string> = {};
          // Same formula-injection neutralization as CSV (C-4).
          for (const col of EXPORT_COLUMNS) {
            row[col] = sanitizeSheetCell(String(domain[col] ?? '')) as string;
          }
          sheet.addRow(row);
        }

        // Alternate row shading
        for (let i = 2; i <= domains.length + 1; i++) {
          if (i % 2 === 0) {
            sheet.getRow(i).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF8FAFC' },
            };
          }
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        const buffer = await workbook.xlsx.writeBuffer();
        res.send(buffer);
        break;
      }

      case 'pdf': {
        const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
        doc.pipe(res);

        doc.fontSize(18).font('Helvetica-Bold').text('Uptime Platform — Domain Export', { align: 'center' });
        doc.fontSize(10).font('Helvetica').text(`Generated: ${new Date().toLocaleString()}  |  Total: ${domains.length}`, { align: 'center' });
        doc.moveDown();

        const cols: Array<keyof DomainRecord> = ['domain', 'status', 'httpStatus', 'responseTime', 'healthScore', 'sslDaysRemaining', 'lastCheckedDate'];
        const colWidth = (doc.page.width - 80) / cols.length;

        // Table header
        const startX = 40;
        let y = doc.y;
        doc.font('Helvetica-Bold').fontSize(8);
        cols.forEach((col, i) => {
          doc.text(col, startX + i * colWidth, y, { width: colWidth - 4, ellipsis: true });
        });
        doc.moveDown(0.5);
        doc.moveTo(startX, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
        doc.moveDown(0.3);

        // Rows
        doc.font('Helvetica').fontSize(7);
        for (const domain of domains) {
          if (doc.y > doc.page.height - 60) {
            doc.addPage();
            y = 40;
          }
          y = doc.y;
          cols.forEach((col, i) => {
            doc.text(String(domain[col] ?? ''), startX + i * colWidth, y, { width: colWidth - 4, ellipsis: true });
          });
          doc.moveDown(0.4);
        }

        doc.end();
        break;
      }

      case 'md': {
        const header = `| ${EXPORT_COLUMNS.slice(0, 10).join(' | ')} |\n`;
        const divider = `| ${EXPORT_COLUMNS.slice(0, 10).map(() => '---').join(' | ')} |\n`;
        const rows = domains.map((d) =>
          `| ${EXPORT_COLUMNS.slice(0, 10).map((c) => String(d[c] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`,
        ).join('\n');

        const md = [
          `# Uptime Platform — Domain Export`,
          ``,
          `Generated: ${new Date().toISOString()} | Total: ${domains.length}`,
          ``,
          header + divider + rows,
        ].join('\n');

        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.md"`);
        res.send(md);
        break;
      }

      case 'html': {
        const thRow = `<tr>${EXPORT_COLUMNS.map((c) => `<th>${c}</th>`).join('')}</tr>`;
        const bodyRows = domains.map((d) =>
          `<tr>${EXPORT_COLUMNS.map((c) => `<td>${escapeHtml(String(d[c] ?? ''))}</td>`).join('')}</tr>`,
        ).join('\n');

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Uptime Export — ${date}</title>
<style>
  body { font-family: system-ui, sans-serif; font-size: 12px; margin: 20px; }
  h1 { color: #1e40af; }
  table { border-collapse: collapse; width: 100%; }
  th { background: #1e40af; color: white; padding: 6px 8px; text-align: left; white-space: nowrap; }
  td { border: 1px solid #e2e8f0; padding: 4px 8px; white-space: nowrap; }
  tr:nth-child(even) td { background: #f8fafc; }
</style>
</head>
<body>
<h1>Uptime Platform — Domain Export</h1>
<p>Generated: ${new Date().toLocaleString()} | Total: ${domains.length}</p>
<table>
<thead>${thRow}</thead>
<tbody>${bodyRows}</tbody>
</table>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.html"`);
        res.send(html);
        break;
      }

      default:
        throw ApiError.badRequest(`Unsupported format: ${format}`);
    }
  }),
);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
