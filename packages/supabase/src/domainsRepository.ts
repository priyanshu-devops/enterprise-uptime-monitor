import type { SupabaseClient } from '@supabase/supabase-js';
import type { DomainRecord } from '@uptime/shared';
import type { IDomainsRepository } from '@uptime/database';

export class SupabaseDomainsRepository implements IDomainsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async readAll(): Promise<{ rowNumber: number; record: DomainRecord }[]> {
    const { data, error } = await this.supabase
      .from('domains')
      .select('*');

    if (error) throw error;

    return (data || []).map((row, index) => ({
      rowNumber: index + 1,
      record: this.mapToDomainRecord(row),
    }));
  }

  async writeRecords(records: DomainRecord[]): Promise<{ updated: number; appended: number }> {
    const rows = records.map(r => this.mapToDbRow(r));
    const { data, error } = await this.supabase
      .from('domains')
      .upsert(rows, { onConflict: 'domain' })
      .select('domain');

    if (error) throw error;

    return {
      updated: data?.length || 0,
      appended: 0,
    };
  }

  async updateFields(domain: string, fields: Partial<DomainRecord>): Promise<boolean> {
    const row = this.mapToDbRow(fields as DomainRecord, true);
    // Remove the domain from update payload to not change the primary key
    delete row.domain;

    const { error } = await this.supabase
      .from('domains')
      .update(row)
      .eq('domain', domain);

    if (error) throw error;
    return true;
  }

  async appendRecords(records: DomainRecord[]): Promise<number> {
    const rows = records.map(r => this.mapToDbRow(r));
    const { data, error } = await this.supabase
      .from('domains')
      .insert(rows)
      .select('domain');

    if (error) throw error;
    return data?.length || 0;
  }

  async deleteDomains(domains: string[]): Promise<number> {
    const { data, error } = await this.supabase
      .from('domains')
      .delete()
      .in('domain', domains)
      .select('domain');

    if (error) throw error;
    return data?.length || 0;
  }

  private mapToDbRow(record: DomainRecord, partial = false): any {
    const row: any = {};
    if (record.domain !== undefined) row.domain = record.domain;
    if (record.company !== undefined) row.company = record.company;
    if (record.project !== undefined) row.project = record.project;
    if (record.owner !== undefined) row.owner = record.owner;
    if (record.department !== undefined) row.department = record.department;
    if (record.website !== undefined) row.website = record.website;
    if (record.status !== undefined) row.status = record.status;
    if (record.httpStatus !== undefined) row.http_status = record.httpStatus;
    if (record.https !== undefined) row.https = record.https;
    if (record.redirectUrl !== undefined) row.redirect_url = record.redirectUrl;
    if (record.responseTime !== undefined) row.response_time = record.responseTime;
    if (record.ttfb !== undefined) row.ttfb = record.ttfb;
    if (record.sslExpiry !== undefined) row.ssl_expiry = record.sslExpiry;
    if (record.sslDaysRemaining !== undefined) row.ssl_days_remaining = record.sslDaysRemaining;
    if (record.sslIssuer !== undefined) row.ssl_issuer = record.sslIssuer;
    if (record.tlsVersion !== undefined) row.tls_version = record.tlsVersion;
    if (record.domainExpiry !== undefined) row.domain_expiry = record.domainExpiry;
    if (record.serverIp !== undefined) row.server_ip = record.serverIp;
    if (record.dns !== undefined) row.dns = record.dns;
    if (record.nameservers !== undefined) row.nameservers = record.nameservers;
    if (record.hostingProvider !== undefined) row.hosting_provider = record.hostingProvider;
    if (record.cdn !== undefined) row.cdn = record.cdn;
    if (record.cloudflare !== undefined) row.cloudflare = record.cloudflare;
    if (record.wordpress !== undefined) row.wordpress = record.wordpress;
    if (record.cms !== undefined) row.cms = record.cms;
    if (record.technologyStack !== undefined) row.technology_stack = record.technologyStack;
    if (record.framework !== undefined) row.framework = record.framework;
    if (record.metaTitle !== undefined) row.meta_title = record.metaTitle;
    if (record.metaDescription !== undefined) row.meta_description = record.metaDescription;
    if (record.robotsTxt !== undefined) row.robots_txt = record.robotsTxt;
    if (record.sitemapXml !== undefined) row.sitemap_xml = record.sitemapXml;
    if (record.securityHeaders !== undefined) row.security_headers = record.securityHeaders;
    if (record.pageSize !== undefined) row.page_size = record.pageSize;
    if (record.favicon !== undefined) row.favicon = record.favicon;
    if (record.screenshotUrl !== undefined) row.screenshot_url = record.screenshotUrl;
    if (record.thumbnailUrl !== undefined) row.thumbnail_url = record.thumbnailUrl;
    if (record.imageFormula !== undefined) row.image_formula = record.imageFormula;
    if (record.lastCheckedDate !== undefined) row.last_checked_date = record.lastCheckedDate;
    if (record.lastCheckedTime !== undefined) row.last_checked_time = record.lastCheckedTime;
    if (record.healthScore !== undefined) row.health_score = record.healthScore;
    if (record.riskScore !== undefined) row.risk_score = record.riskScore;
    if (record.errorMessage !== undefined) row.error_message = record.errorMessage;
    if (record.monitoringResult !== undefined) row.monitoring_result = record.monitoringResult;
    if (record.notes !== undefined) row.notes = record.notes;
    if (record.tags !== undefined) row.tags = record.tags;
    if (record.category !== undefined) row.category = record.category;
    
    if (!partial) {
      row.updated_at = new Date().toISOString();
    }
    return row;
  }

  private mapToDomainRecord(row: any): DomainRecord {
    return {
      domain: row.domain || '',
      company: row.company || '',
      project: row.project || '',
      owner: row.owner || '',
      department: row.department || '',
      website: row.website || '',
      status: row.status || '',
      httpStatus: row.http_status || '',
      https: row.https || '',
      redirectUrl: row.redirect_url || '',
      responseTime: row.response_time || '',
      ttfb: row.ttfb || '',
      sslExpiry: row.ssl_expiry || '',
      sslDaysRemaining: row.ssl_days_remaining || '',
      sslIssuer: row.ssl_issuer || '',
      tlsVersion: row.tls_version || '',
      domainExpiry: row.domain_expiry || '',
      serverIp: row.server_ip || '',
      dns: row.dns || '',
      nameservers: row.nameservers || '',
      hostingProvider: row.hosting_provider || '',
      cdn: row.cdn || '',
      cloudflare: row.cloudflare || '',
      wordpress: row.wordpress || '',
      cms: row.cms || '',
      technologyStack: row.technology_stack || '',
      framework: row.framework || '',
      metaTitle: row.meta_title || '',
      metaDescription: row.meta_description || '',
      robotsTxt: row.robots_txt || '',
      sitemapXml: row.sitemap_xml || '',
      securityHeaders: row.security_headers || '',
      pageSize: row.page_size || '',
      favicon: row.favicon || '',
      screenshotUrl: row.screenshot_url || '',
      thumbnailUrl: row.thumbnail_url || '',
      imageFormula: row.image_formula || '',
      lastCheckedDate: row.last_checked_date || '',
      lastCheckedTime: row.last_checked_time || '',
      healthScore: row.health_score || '',
      riskScore: row.risk_score || '',
      errorMessage: row.error_message || '',
      monitoringResult: row.monitoring_result || '',
      notes: row.notes || '',
      tags: row.tags || '',
      category: row.category || '',
    };
  }
}
