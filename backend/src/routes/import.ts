/**
 * Import routes — preview, commit, parse XLSX, and history.
 *
 * POST /preview       — validate rows, return ImportRowPreview[]
 * POST /commit        — write accepted rows to the Sheet
 * POST /parse-xlsx    — decode a base64 Excel file into rows
 * GET  /history       — ImportHistory sheet tab
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { normalizeDomain } from '@uptime/shared';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import type { SheetsService } from '../services/sheets.js';
import type { AuthRequest } from '../middleware/auth.js';
import type { ImportRowPreview } from '@uptime/shared';

// ── Schemas ───────────────────────────────────────────────────────────────────

const importRowSchema = z.object({
  website: z.string(),
  company: z.string().optional().default(''),
  project: z.string().optional().default(''),
  owner: z.string().optional().default(''),
  department: z.string().optional().default(''),
  tags: z.string().optional().default(''),
  category: z.string().optional().default(''),
});

const importBodySchema = z.object({
  source: z.enum(['csv', 'xlsx', 'txt', 'paste', 'manual', 'sheet']),
  rows: z.array(importRowSchema).min(1).max(5000),
});

const xlsxBodySchema = z.object({
  filename: z.string(),
  dataB64: z.string(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getService(req: Request): SheetsService {
  return req.app.locals.sheetsService as SheetsService;
}

function actor(req: AuthRequest): string {
  return req.user?.email || 'api';
}

/** Build ImportRowPreview[] from raw input rows, checking for duplicates. */
async function buildPreviews(
  rows: z.infer<typeof importRowSchema>[],
  knownDomains: Set<string>,
  seenInBatch = new Set<string>(),
): Promise<ImportRowPreview[]> {
  return rows.map((row, idx) => {
    const normalized = normalizeDomain(row.website);

    if (normalized.invalid) {
      return {
        row: idx + 1,
        website: row.website,
        domain: '',
        company: row.company,
        project: row.project,
        owner: row.owner,
        department: row.department,
        tags: row.tags,
        category: row.category,
        valid: false,
        duplicate: false,
        corrected: false,
        reason: normalized.reason || 'Invalid URL',
      };
    }

    const domain = normalized.domain;
    const duplicate = knownDomains.has(domain) || seenInBatch.has(domain);
    const corrected = row.website !== normalized.website;
    seenInBatch.add(domain);

    return {
      row: idx + 1,
      website: normalized.website,
      domain,
      company: row.company,
      project: row.project,
      owner: row.owner,
      department: row.department,
      tags: row.tags,
      category: row.category,
      valid: true,
      duplicate,
      corrected,
      reason: duplicate ? 'Duplicate domain' : corrected ? 'URL corrected' : '',
    };
  });
}

export const importRouter: import('express').Router = Router();

// ── POST /preview ─────────────────────────────────────────────────────────────

importRouter.post(
  '/preview',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = importBodySchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Invalid import body');

    const svc = getService(req);
    const existing = await svc.readAllDomains();
    const knownDomains = new Set(existing.map((r) => r.record.domain));

    const previews = await buildPreviews(parsed.data.rows, knownDomains);
    res.json(previews);
  }),
);

// ── POST /commit ──────────────────────────────────────────────────────────────

importRouter.post(
  '/commit',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = importBodySchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Invalid import body');

    const svc = getService(req);
    const existing = await svc.readAllDomains();
    const knownDomains = new Set(existing.map((r) => r.record.domain));

    const previews = await buildPreviews(parsed.data.rows, knownDomains);

    const report = await svc.importDomains(
      previews,
      actor(req),
      req.ip || '',
      req.headers['user-agent'] || '',
      parsed.data.source,
    );

    res.status(201).json(report);
  }),
);

// ── POST /parse-xlsx ──────────────────────────────────────────────────────────

importRouter.post(
  '/parse-xlsx',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = xlsxBodySchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Invalid request: filename and dataB64 required');

    const buffer = Buffer.from(parsed.data.dataB64, 'base64');
    const workbook = new ExcelJS.Workbook();

    const ext = parsed.data.filename.split('.').pop()?.toLowerCase();

    if (ext === 'csv') {
      // Parse CSV directly
      const csvText = buffer.toString('utf-8');
      const { data } = Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim().toLowerCase().replace(/\s+/g, '_'),
      });
      const rows = data.map((r: Record<string, string>) => ({
        website: (r['website'] || r['url'] || r['domain'] || '').trim(),
        company: (r['company'] || '').trim(),
        project: (r['project'] || '').trim(),
        owner: (r['owner'] || '').trim(),
        department: (r['department'] || '').trim(),
        tags: (r['tags'] || '').trim(),
        category: (r['category'] || '').trim(),
      }));
      res.json({ rows, totalRows: rows.length, source: 'csv' });
      return;
    }

    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw ApiError.badRequest('No worksheets found in the Excel file');

    // Build header map from row 1
    const headerRow = sheet.getRow(1);
    const headerMap: Record<number, string> = {};
    headerRow.eachCell((cell, colNumber) => {
      const header = String(cell.value || '').trim().toLowerCase().replace(/\s+/g, '_');
      headerMap[colNumber] = header;
    });

    const rows: Record<string, string>[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      const obj: Record<string, string> = {};
      row.eachCell((cell, colNumber) => {
        const key = headerMap[colNumber];
        if (key) obj[key] = String(cell.value ?? '').trim();
      });
      rows.push(obj);
    });

    const mapped = rows
      .filter((r) => r['website'] || r['url'] || r['domain'])
      .map((r) => ({
        website: (r['website'] || r['url'] || r['domain'] || '').trim(),
        company: (r['company'] || '').trim(),
        project: (r['project'] || '').trim(),
        owner: (r['owner'] || '').trim(),
        department: (r['department'] || '').trim(),
        tags: (r['tags'] || '').trim(),
        category: (r['category'] || '').trim(),
      }));

    res.json({ rows: mapped, totalRows: mapped.length, source: 'xlsx' });
  }),
);

// ── GET /history ──────────────────────────────────────────────────────────────

importRouter.get(
  '/history',
  asyncHandler(async (req: Request, res: Response) => {
    const history = await getService(req).getImportHistory();
    res.json({ items: history, total: history.length });
  }),
);
