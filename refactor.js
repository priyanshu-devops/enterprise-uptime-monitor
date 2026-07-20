const fs = require('fs');
const path = require('path');
const dir = 'd:/Website uptime Checker/backend/src/routes';

fs.readdirSync(dir).forEach(f => {
  if (!f.endsWith('.ts')) return;
  const p = path.join(dir, f);
  let c = fs.readFileSync(p, 'utf8');
  let original = c;

  // Let's replace any lingering `getService(req).methodName` or `svc.methodName`
  // with the appropriate sub-service.
  c = c.replace(/\.getDomains\(/g, '.domains.getDomains(');
  c = c.replace(/\.createDomain\(/g, '.domains.createDomain(');
  c = c.replace(/\.updateDomain\(/g, '.domains.updateDomain(');
  c = c.replace(/\.deleteDomains\(/g, '.domains.deleteDomains(');
  c = c.replace(/\.bulkDomains\(/g, '.domains.bulkDomains(');
  c = c.replace(/\.getKpis\(/g, '.domains.getKpis(');
  c = c.replace(/\.getDistributions\(/g, '.domains.getDistributions(');
  c = c.replace(/\.readAllDomains\(/g, '.domains.readAllDomains(');
  c = c.replace(/\.importDomains\(/g, '.domains.importDomains(');
  
  c = c.replace(/\.getIncidents\(/g, '.provider.incidents.readAll(');
  c = c.replace(/\.getAuditLog\(/g, '.provider.audit.readAll(');
  c = c.replace(/\.getImportHistory\(/g, '.provider.imports.readAll(');
  c = c.replace(/\.getSettings\(/g, '.provider.settings.read(');
  c = c.replace(/\.updateSettings\(/g, '.provider.settings.write(');
  
  // Also .healthCheck -> shouldn't be touched here since it's in server.ts, but wait, sheets.ts route uses healthCheck.
  // Actually, healthCheck was in SheetsService, but db.ts ServiceContainer has no healthCheck.
  // Let's add healthCheck to db.ts. Wait, I already removed sheetsService in server.ts and faked it.
  // We can just leave .healthCheck for now and fix it manually.
  
  // Undo double-nesting if we accidentally did it:
  c = c.replace(/\.domains\.domains\./g, '.domains.');
  c = c.replace(/\.provider\.provider\./g, '.provider.');
  
  if (c !== original) fs.writeFileSync(p, c);
});
