/**
 * Zod schemas shared by backend validation and frontend forms.
 */
import { z } from 'zod';

/** Login payload. */
export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});

/** Create-domain payload (user-owned fields). */
export const createDomainSchema = z.object({
  website: z.string().min(4).max(2048),
  company: z.string().max(200).optional().default(''),
  project: z.string().max(200).optional().default(''),
  owner: z.string().max(200).optional().default(''),
  department: z.string().max(200).optional().default(''),
  notes: z.string().max(2000).optional().default(''),
  tags: z.string().max(500).optional().default(''),
  category: z.string().max(200).optional().default(''),
});

/** Patch-domain payload. */
export const updateDomainSchema = createDomainSchema.partial();

/** Bulk domain operation. */
export const bulkDomainSchema = z.object({
  action: z.enum(['delete', 'tag', 'untag', 'categorize', 'pause', 'resume']),
  domains: z.array(z.string().min(1)).min(1).max(1000),
  value: z.string().max(200).optional(),
});

/** One import row before normalization. */
export const importRowSchema = z.object({
  website: z.string().min(1),
  company: z.string().optional().default(''),
  project: z.string().optional().default(''),
  owner: z.string().optional().default(''),
  department: z.string().optional().default(''),
  tags: z.string().optional().default(''),
  category: z.string().optional().default(''),
});

/** Import commit payload. */
export const importCommitSchema = z.object({
  source: z.enum(['csv', 'xlsx', 'txt', 'paste', 'manual', 'sheet']),
  rows: z.array(importRowSchema).min(1).max(5000),
});

/** Job trigger payload. */
export const triggerJobSchema = z.object({
  domains: z.array(z.string()).max(100).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  skipScreenshots: z.boolean().optional().default(false),
});

/** Domain list query params. */
export const domainListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.string().max(50).optional(),
  category: z.string().max(200).optional(),
  tag: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  project: z.string().max(200).optional(),
  owner: z.string().max(200).optional(),
  sortBy: z.string().max(50).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).optional().default(50),
});

/** Report export query. */
export const reportExportSchema = z.object({
  format: z.enum(['xlsx', 'csv', 'json', 'pdf', 'md', 'html']),
  period: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Settings payload. */
export const settingsSchema = z.object({
  sslWarnDays: z.number().int().min(1).max(365).default(30),
  responseTimeWarnMs: z.number().int().min(100).max(60000).default(3000),
  savedFilters: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        query: z.record(z.string(), z.unknown()),
      }),
    )
    .max(50)
    .default([]),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateDomainInput = z.infer<typeof createDomainSchema>;
export type UpdateDomainInput = z.infer<typeof updateDomainSchema>;
export type BulkDomainInput = z.infer<typeof bulkDomainSchema>;
export type ImportCommitInput = z.infer<typeof importCommitSchema>;
export type TriggerJobInput = z.infer<typeof triggerJobSchema>;
export type DomainListQueryInput = z.infer<typeof domainListQuerySchema>;
export type ReportExportInput = z.infer<typeof reportExportSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
