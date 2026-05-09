'use client';

/**
 * Generic CSV import dialog.
 * Parses the file client-side using a caller-supplied header→field mapping,
 * sends the rows to `endpoint` as { rows: object[] },
 * and shows an import summary.
 */
import { useRef, useState } from 'react';
import { CheckCircle2, FileUp, Loader2, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export interface CsvField {
  /** Column header label (case-insensitive match). */
  header: string;
  /** Key to use in the output row object. */
  field: string;
  /** If true, parse the cell as a number. */
  numeric?: boolean;
}

interface ImportSummary {
  imported: number;
  skipped: number;
  errors: { row: number; reason: string }[];
  batchId: string;
}

interface CsvImportDialogProps {
  /** API endpoint to POST rows to. */
  endpoint: string;
  /** Mapping of CSV headers to row object keys. */
  fields: CsvField[];
  /** Label shown on the trigger button. */
  triggerLabel?: string;
  /** Description shown in the dialog header. */
  description?: string;
  /** Called after a successful import. */
  onImported?: () => void;
}

/* ── Minimal CSV parser (handles quoted fields, \r\n / \n) ── */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        cols.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

function csvToRows(
  text: string,
  fieldMap: CsvField[],
): { rows: Record<string, unknown>[]; parseErrors: string[] } {
  const all = parseCsv(text);
  if (all.length < 2) return { rows: [], parseErrors: ['File has no data rows.'] };

  const firstRow = all[0];
  if (!firstRow) return { rows: [], parseErrors: ['Could not read header row.'] };
  const header = firstRow.map((h) => h.toLowerCase().trim());
  const parseErrors: string[] = [];

  // Map each CsvField to its column index
  const colIdx: Record<string, number> = {};
  for (const f of fieldMap) {
    const idx = header.indexOf(f.header.toLowerCase());
    if (idx === -1) parseErrors.push(`Column "${f.header}" not found.`);
    else colIdx[f.field] = idx;
  }
  if (parseErrors.length > 0) return { rows: [], parseErrors };

  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < all.length; i++) {
    const cells = all[i];
    if (!cells) continue;
    const row: Record<string, unknown> = {};
    for (const f of fieldMap) {
      const idx = colIdx[f.field] ?? -1;
      const raw = idx >= 0 ? (cells[idx] ?? '') : '';
      row[f.field] = f.numeric ? Number(raw.replace(/\s/g, '')) : raw;
    }
    rows.push(row);
  }
  return { rows, parseErrors: [] };
}

export function CsvImportDialog({
  endpoint,
  fields,
  triggerLabel = 'Import CSV',
  description,
  onImported,
}: CsvImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<'idle' | 'preview' | 'importing' | 'done'>('idle');
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStage('idle');
    setParseError(null);
    setPreviewRows([]);
    setSummary(null);
    setApiError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleFile(file: File) {
    setParseError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { rows, parseErrors } = csvToRows(text, fields);
      if (parseErrors.length > 0) {
        setParseError(parseErrors.join(' '));
        setStage('idle');
        return;
      }
      setPreviewRows(rows);
      setStage('preview');
    };
    reader.readAsText(file, 'utf-8');
  }

  async function handleImport() {
    setStage('importing');
    setApiError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: previewRows }),
      });
      const data = await res.json() as ImportSummary & { message?: string };
      if (!res.ok) {
        setApiError(data.message ?? 'Import failed.');
        setStage('preview');
        return;
      }
      setSummary(data);
      setStage('done');
      onImported?.();
    } catch {
      setApiError('Network error — try again.');
      setStage('preview');
    }
  }

  const headers = fields.map((f) => f.header);
  const previewCols = fields.map((f) => f.field);

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FileUp className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{triggerLabel}</DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>

        {/* ── Idle / file picker ── */}
        {stage === 'idle' && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <FileUp className="mx-auto mb-2 size-8 text-muted-foreground" />
              <p className="text-sm font-medium">Choose a CSV file</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Required columns: {headers.join(', ')}
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="mt-3 block w-full cursor-pointer text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1 file:text-xs hover:file:bg-accent"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
            {parseError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {parseError}
              </div>
            )}
          </div>
        )}

        {/* ── Preview ── */}
        {(stage === 'preview' || stage === 'importing') && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {previewRows.length} rows ready to import
              </p>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={reset}
              >
                <X className="inline size-3.5" /> Change file
              </button>
            </div>

            {/* Preview table — first 5 rows */}
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    {headers.map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {previewCols.map((col) => (
                        <td key={col} className="px-3 py-1.5 text-muted-foreground">
                          {String(row[col] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {previewRows.length > 5 && (
                    <tr className="border-t border-border">
                      <td colSpan={headers.length} className="px-3 py-1.5 text-center text-muted-foreground">
                        …and {previewRows.length - 5} more rows
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {apiError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {apiError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={reset} disabled={stage === 'importing'}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleImport()}
                loading={stage === 'importing'}
                disabled={stage === 'importing'}
              >
                {stage === 'importing' ? 'Importing…' : `Import ${previewRows.length} rows`}
              </Button>
            </div>
          </div>
        )}

        {/* ── Done ── */}
        {stage === 'done' && summary && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
              <CheckCircle2 className="size-5" />
              Import complete
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">{summary.imported}</div>
                <div className="text-xs text-muted-foreground">Imported</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{summary.skipped}</div>
                <div className="text-xs text-muted-foreground">Skipped</div>
              </div>
            </div>

            {summary.errors.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-3">
                <p className="mb-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                  {summary.errors.length} row{summary.errors.length !== 1 ? 's' : ''} had errors:
                </p>
                <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                  {summary.errors.slice(0, 10).map((e) => (
                    <li key={e.row}>Row {e.row}: {e.reason}</li>
                  ))}
                  {summary.errors.length > 10 && (
                    <li>…and {summary.errors.length - 10} more</li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex justify-end">
              <Button size="sm" onClick={() => { setOpen(false); reset(); }}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
