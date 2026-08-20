'use client';

/**
 * The full filterable Interactions log for /metworkcrm/activities — distinct
 * from Timeline (which is embedded, entity-scoped, and used on Organization/
 * Contact detail pages). Both read the same data through the same API.
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { INTERACTION_TYPE_LABELS } from '@/components/metworkcrm/shared/labels';
import { InteractionFormDialog, type InteractionRow } from './interaction-form-dialog';

const selectClass =
  'h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function InteractionsList() {
  const [rows, setRows] = useState<InteractionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState('');
  const [nextActionDue, setNextActionDue] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (type) params.set('type', type);
    if (nextActionDue) params.set('nextActionDue', 'true');
    const res = await fetch(`/api/metworkcrm/interactions?${params.toString()}`);
    const data = res.ok ? await res.json() : { rows: [], total: 0 };
    setRows(data.rows);
    setTotal(data.total);
    setLoading(false);
  }, [type, nextActionDue, offset]);

  useEffect(() => {
    setOffset(0);
  }, [type, nextActionDue]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(row: InteractionRow) {
    if (!confirm(`Supprimer l'interaction « ${row.subject} » ?`)) return;
    const res = await fetch(`/api/metworkcrm/interactions/${row.id}`, { method: 'DELETE' });
    if (res.ok) load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
          <option value="">Tous les types</option>
          {Object.entries(INTERACTION_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={nextActionDue}
            onChange={(e) => setNextActionDue(e.target.checked)}
            className="size-4 rounded border-neutral-300 text-[var(--crm-green)] focus:ring-[var(--crm-green)]"
          />
          Action à faire (échue)
        </label>

        <InteractionFormDialog
          onSaved={load}
          trigger={
            <CrmButton size="sm" className="ms-auto">
              <Plus className="size-4" aria-hidden /> Nouvelle interaction
            </CrmButton>
          }
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Objet</TableHead>
              <TableHead>Prochaine action</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-neutral-400">
                  Chargement…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-neutral-400">
                  Aucune interaction trouvée.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-neutral-500">{formatDateTime(row.occurredAt)}</TableCell>
                  <TableCell>{INTERACTION_TYPE_LABELS[row.type] ?? row.type}</TableCell>
                  <TableCell className="font-medium text-[var(--crm-black)]">
                    <InteractionFormDialog
                      interaction={row}
                      onSaved={load}
                      trigger={<button type="button" className="text-left hover:underline">{row.subject}</button>}
                    />
                  </TableCell>
                  <TableCell>
                    {row.nextAction ? (
                      <Badge variant={row.nextActionDone ? 'default' : 'warning'}>
                        {row.nextAction}
                        {row.nextActionDate ? ` · ${row.nextActionDate}` : ''}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => remove(row)}
                      className="inline-flex size-7 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Supprimer"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {total > limit ? (
        <div className="flex items-center justify-between text-sm text-neutral-500">
          <span>
            {offset + 1}–{Math.min(offset + limit, total)} sur {total}
          </span>
          <div className="flex gap-2">
            <CrmButton size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
              Précédent
            </CrmButton>
            <CrmButton size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
              Suivant
            </CrmButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
