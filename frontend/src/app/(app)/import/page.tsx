'use client';

import { useRef, useState } from 'react';
import Papa from 'papaparse';
import { Upload, FileText, ClipboardPaste, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import type { ImportBody } from '@/lib/api/hooks';
import type { ImportReport, ImportRowPreview } from '@uptime/shared';
import { useImportPreview, useImportCommit } from '@/lib/api/hooks';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { downloadCsv } from '@/lib/utils';

type RawRow = ImportBody['rows'][number];

/** Map loose CSV/paste headers onto the known row fields. */
function mapRow(obj: Record<string, string>): RawRow | null {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const found = Object.keys(obj).find((h) => h.toLowerCase().trim() === k);
      if (found && obj[found]?.trim()) return obj[found].trim();
    }
    return '';
  };
  const website = get('website', 'url', 'domain', 'site', 'link');
  if (!website) return null;
  return {
    website,
    company: get('company', 'organisation', 'organization'),
    project: get('project'),
    owner: get('owner'),
    department: get('department', 'dept'),
    tags: get('tags'),
    category: get('category', 'type'),
  };
}

export default function ImportPage() {
  const [rows, setRows] = useState<RawRow[]>([]);
  const [source, setSource] = useState<ImportBody['source']>('csv');
  const [previews, setPreviews] = useState<ImportRowPreview[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pasteText, setPasteText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = useImportPreview({
    onSuccess: (data) => {
      setPreviews(data);
      setReport(null);
    },
    onError: (e) => toast.error(e.message || 'Preview failed'),
  });
  const commit = useImportCommit({
    onSuccess: (data) => {
      setReport(data);
      setPreviews([]);
      setRows([]);
      setPasteText('');
      toast.success(`Imported ${data.totalImported} domain(s)`);
    },
    onError: (e) => toast.error(e.message || 'Import failed'),
  });

  const runPreview = (parsedRows: RawRow[], src: ImportBody['source']) => {
    if (!parsedRows.length) {
      toast.error('No valid rows found (need a website/URL column).');
      return;
    }
    setRows(parsedRows);
    setSource(src);
    preview.mutate({ source: src, rows: parsedRows });
  };

  const handleFile = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const mapped = res.data.map(mapRow).filter((r): r is RawRow => r !== null);
        runPreview(mapped, file.name.endsWith('.txt') ? 'txt' : 'csv');
      },
      error: () => toast.error('Failed to parse file'),
    });
  };

  const handlePaste = () => {
    const lines = pasteText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const mapped = lines
      .map((line) => {
        const website = line.split(/[,\t]/)[0]?.trim() ?? '';
        return website ? ({ website } as RawRow) : null;
      })
      .filter((r): r is RawRow => r !== null);
    runPreview(mapped, 'paste');
  };

  const validCount = previews.filter((p) => p.valid && !p.duplicate).length;
  const dupCount = previews.filter((p) => p.duplicate).length;
  const invalidCount = previews.filter((p) => !p.valid).length;

  return (
    <>
      <PageHeader
        title="Import domains"
        description="Bulk-add domains from a CSV/TXT file or by pasting a list. Duplicates are detected against the sheet."
      />

      {report ? (
        <ImportResult report={report} onReset={() => setReport(null)} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle>Source</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="file">
                  <TabsList className="w-full">
                    <TabsTrigger value="file" className="flex-1">
                      <FileText className="mr-1.5 h-4 w-4" /> File
                    </TabsTrigger>
                    <TabsTrigger value="paste" className="flex-1">
                      <ClipboardPaste className="mr-1.5 h-4 w-4" /> Paste
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="file" className="mt-4">
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors hover:bg-accent"
                    >
                      <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
                      <span className="text-sm font-medium">Choose CSV or TXT</span>
                      <span className="mt-1 text-2xs text-muted-foreground">
                        Needs a website/URL column
                      </span>
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,.txt"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFile(f);
                        e.target.value = '';
                      }}
                    />
                  </TabsContent>

                  <TabsContent value="paste" className="mt-4 space-y-3">
                    <Textarea
                      rows={8}
                      placeholder={'example.com\nhttps://another.com\nsite.org'}
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                    />
                    <Button
                      className="w-full"
                      onClick={handlePaste}
                      disabled={!pasteText.trim() || preview.isPending}
                    >
                      {preview.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Preview
                    </Button>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Preview</CardTitle>
                {previews.length > 0 && (
                  <div className="flex items-center gap-2 text-2xs">
                    <Badge variant="secondary" className="text-success">
                      {validCount} new
                    </Badge>
                    <Badge variant="secondary" className="text-warning">
                      {dupCount} dupes
                    </Badge>
                    <Badge variant="secondary" className="text-destructive">
                      {invalidCount} invalid
                    </Badge>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {preview.isPending ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    Validating rows…
                  </div>
                ) : previews.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    Load a file or paste a list to preview.
                  </div>
                ) : (
                  <>
                    <div className="max-h-[420px] overflow-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>Domain</TableHead>
                            <TableHead>Company</TableHead>
                            <TableHead>State</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previews.slice(0, 200).map((p) => (
                            <TableRow key={p.row}>
                              <TableCell className="text-muted-foreground">{p.row}</TableCell>
                              <TableCell className="font-medium">{p.domain || p.website}</TableCell>
                              <TableCell className="text-muted-foreground">{p.company || '—'}</TableCell>
                              <TableCell>
                                {!p.valid ? (
                                  <span className="text-2xs text-destructive">{p.reason || 'invalid'}</span>
                                ) : p.duplicate ? (
                                  <span className="text-2xs text-warning">duplicate</span>
                                ) : (
                                  <span className="text-2xs text-success">
                                    {p.corrected ? 'new (corrected)' : 'new'}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="mt-4 flex items-center justify-end gap-2">
                      <Button variant="outline" onClick={() => setPreviews([])}>
                        Clear
                      </Button>
                      <Button
                        onClick={() => commit.mutate({ source, rows })}
                        disabled={commit.isPending || validCount === 0}
                      >
                        {commit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Import {validCount} domain(s)
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function ImportResult({ report, onReset }: { report: ImportReport; onReset: () => void }) {
  const downloadRejects = () => {
    downloadCsv(
      `import-rejects-${report.importId}.csv`,
      ['Row', 'Website', 'Domain', 'Reason'],
      report.rejectedRows.map((r) => [r.row, r.website, r.domain, r.reason]),
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-success" />
          Import complete
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ResultStat label="Imported" value={report.totalImported} tone="text-success" />
          <ResultStat label="Duplicates" value={report.duplicatesRemoved} tone="text-warning" />
          <ResultStat label="Invalid" value={report.invalid} tone="text-destructive" />
          <ResultStat label="Corrected" value={report.corrected} tone="text-foreground" />
        </div>
        {report.rejectedRows.length > 0 && (
          <div className="rounded-lg border p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <XCircle className="h-4 w-4 text-destructive" />
                {report.rejectedRows.length} rejected row(s)
              </span>
              <Button variant="outline" size="sm" onClick={downloadRejects}>
                Download rejects CSV
              </Button>
            </div>
          </div>
        )}
        <Button onClick={onReset}>Import more</Button>
      </CardContent>
    </Card>
  );
}

function ResultStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
