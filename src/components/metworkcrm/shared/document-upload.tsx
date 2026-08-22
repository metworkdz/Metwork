'use client';

/**
 * Attach/list panel for one entity's documents — uploads via
 * `POST /api/metworkcrm/upload` (Cloudinary), then attaches via
 * `POST /api/metworkcrm/documents`. Minimal scope: no rename, no
 * re-categorize, no cross-entity browse — see SESSION_LOG.
 */
import { useEffect, useRef, useState } from 'react';
import { FileText, Trash2, Upload } from 'lucide-react';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { DOCUMENT_TYPE_LABELS } from '@/components/metworkcrm/shared/labels';

export interface DocumentRow {
  id: string;
  title: string;
  type: string;
  fileUrl: string;
  fileName: string | null;
  sizeBytes: number | null;
}

const selectClass =
  'h-9 rounded-md border border-neutral-300 bg-white px-2 text-xs outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function DocumentUpload({
  entityType,
  entityId,
  initial,
}: {
  entityType:
    | 'OI_PROJECT' | 'PROGRAM' | 'ORGANIZATION' | 'CONTACT' | 'OPPORTUNITY' | 'STARTUP' | 'EXPERT' | 'PARTNERSHIP'
    | 'SPACE_BOOKING' | 'PAYMENT' | 'TASK';
  entityId: string;
  initial: DocumentRow[];
}) {
  const [rows, setRows] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docType, setDocType] = useState('AUTRE');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // No standalone GET-list route — documents are embedded in the parent
  // entity's own detail payload, so this just mirrors whatever the parent
  // page's own refresh() fetched; local state otherwise updates optimistically.
  useEffect(() => {
    setRows(initial);
  }, [initial]);

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.set('file', file);

    let uploadRes: Response;
    try {
      uploadRes = await fetch('/api/metworkcrm/upload', { method: 'POST', body: form });
    } catch {
      setError('Impossible de contacter le serveur. Vérifiez votre connexion.');
      setUploading(false);
      return;
    }

    let uploadData: {
      url?: string;
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
      cloudinaryPublicId?: string;
      error?: { message?: string };
    };
    try {
      uploadData = await uploadRes.json();
    } catch {
      setError(`Réponse du serveur invalide (code ${uploadRes.status}). Réessayez ou contactez l'équipe technique.`);
      setUploading(false);
      return;
    }

    if (!uploadRes.ok) {
      setError(uploadData?.error?.message ?? 'Échec du téléversement.');
      setUploading(false);
      return;
    }

    let attachRes: Response;
    try {
      attachRes = await fetch('/api/metworkcrm/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: file.name,
          type: docType,
          entityType,
          entityId,
          fileUrl: uploadData.url,
          fileName: uploadData.fileName,
          mimeType: uploadData.mimeType,
          sizeBytes: uploadData.sizeBytes,
          cloudinaryPublicId: uploadData.cloudinaryPublicId,
        }),
      });
    } catch {
      setError('Impossible de contacter le serveur. Vérifiez votre connexion.');
      setUploading(false);
      return;
    }

    let attachData: DocumentRow & { error?: { message?: string } };
    try {
      attachData = await attachRes.json();
    } catch {
      setError(`Réponse du serveur invalide (code ${attachRes.status}). Réessayez ou contactez l'équipe technique.`);
      setUploading(false);
      return;
    }

    if (!attachRes.ok) {
      setError(attachData?.error?.message ?? "Échec de l'enregistrement du document.");
      setUploading(false);
      return;
    }
    setRows((prev) => [attachData, ...prev]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function remove(id: string) {
    if (!confirm('Supprimer ce document ?')) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    await fetch(`/api/metworkcrm/documents/${id}`, { method: 'DELETE' });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--crm-black)]">
        Documents <span className="font-normal text-neutral-400">({rows.length})</span>
      </h3>
      <ul className="mb-3 space-y-2">
        {rows.map((d) => (
          <li key={d.id} className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-neutral-50">
            <FileText className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
            <a href={d.fileUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[var(--crm-black)] hover:text-[var(--crm-green)]">
              {d.title}
            </a>
            <span className="shrink-0 text-xs text-neutral-400">
              {DOCUMENT_TYPE_LABELS[d.type] ?? d.type}
              {d.sizeBytes ? ` · ${formatSize(d.sizeBytes)}` : ''}
            </span>
            <button type="button" onClick={() => remove(d.id)} className="shrink-0 text-neutral-400 hover:text-red-600" aria-label="Supprimer">
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
        {rows.length === 0 ? <li className="text-sm text-neutral-400">Aucun document.</li> : null}
      </ul>

      <div className="flex flex-wrap items-center gap-1.5">
        <select value={docType} onChange={(e) => setDocType(e.target.value)} className={selectClass}>
          {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input ref={fileInputRef} type="file" onChange={onFileChosen} className="hidden" id="doc-upload-input" accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg" />
        <CrmButton
          type="button"
          size="sm"
          variant="outline"
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-3.5" aria-hidden /> Téléverser
        </CrmButton>
      </div>
      {error ? <p role="alert" className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
