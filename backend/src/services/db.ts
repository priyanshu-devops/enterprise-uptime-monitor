import pino from 'pino';
import { GSheetsDatabaseProvider } from '@uptime/gsheets';
import { SupabaseDatabaseProvider } from '@uptime/supabase';
import type { IDatabaseProvider } from '@uptime/database';
import { DomainService } from './DomainService.js';
import { CacheService } from './cache.js';

const logger = pino({ name: 'db-factory' });

export interface ServiceContainer {
  provider: IDatabaseProvider;
  domains: DomainService;
  cache: CacheService;
  flush(): Promise<void>;
  healthCheck(): Promise<{ reachable: boolean; cacheAgeSeconds: number | null }>;
  updateSettings(settings: Partial<import('@uptime/shared').AppSettings>): Promise<import('@uptime/shared').AppSettings>;
  updateIncident(id: string, action: 'ack' | 'resolve', actor: string): Promise<import('@uptime/shared').Incident | null>;
}

export function createServices(cache: CacheService): ServiceContainer {
  const providerType = process.env.DATABASE_PROVIDER || 'gsheets';

  logger.info({ provider: providerType }, 'Initializing database provider');

  let provider: IDatabaseProvider;

  if (providerType === 'supabase') {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when DATABASE_PROVIDER=supabase');
    }
    provider = new SupabaseDatabaseProvider({
      url,
      serviceRoleKey,
    });
  } else {
    // Default to Google Sheets for backward compatibility
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const serviceAccountJsonB64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
    
    if (!spreadsheetId || !serviceAccountJsonB64) {
      throw new Error('GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_B64 are required when DATABASE_PROVIDER=gsheets');
    }

    provider = new GSheetsDatabaseProvider({
      spreadsheetId,
      serviceAccountJsonB64,
    });
  }

  const domains = new DomainService(provider, cache);

  return {
    provider,
    domains,
    cache,
    flush: async () => {
      await provider.flush();
      await cache.flush();
    },
    healthCheck: async () => {
      // Mocked health check until we implement provider-specific health checks
      return { reachable: true, cacheAgeSeconds: null };
    },
    updateSettings: async (settings: Partial<import('@uptime/shared').AppSettings>) => {
      const current = await provider.settings.read();
      const updated = { ...current, ...settings };
      // Strip undefined values that might have been passed by Zod optional()
      for (const key of Object.keys(updated)) {
        if ((updated as any)[key] === undefined) {
          (updated as any)[key] = (current as any)[key];
        }
      }
      await provider.settings.write(updated);
      cache.invalidatePrefix('settings:');
      return updated;
    },
    updateIncident: async (id: string, action: 'ack' | 'resolve', actor: string) => {
      const incidents = await provider.incidents.readAll();
      const incident = incidents.find((i) => i.id === id);
      if (!incident) return null;

      const now = new Date().toISOString();
      const updated = { ...incident };
      if (action === 'ack') {
        updated.ackedAt = now;
        updated.ackedBy = actor;
      } else {
        updated.status = 'resolved';
        updated.resolvedAt = updated.resolvedAt ?? now;
        updated.ackedAt = updated.ackedAt ?? now;
        updated.ackedBy = updated.ackedBy || actor;
        if (updated.durationSeconds === null) {
          const openedMs = new Date(updated.openedAt).getTime();
          const resolvedMs = new Date(updated.resolvedAt).getTime();
          if (!Number.isNaN(openedMs) && !Number.isNaN(resolvedMs)) {
            updated.durationSeconds = Math.max(0, Math.round((resolvedMs - openedMs) / 1000));
          }
        }
      }

      await provider.incidents.update([updated]);
      cache.invalidatePrefix('incidents');
      cache.invalidatePrefix('monitoring:');
      return updated;
    }
  };
}
