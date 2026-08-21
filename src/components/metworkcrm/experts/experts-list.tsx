'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { EXPERT_STAGE_LABELS } from '@/components/metworkcrm/shared/labels';
import { ExpertFormDialog, type ExpertRow } from './expert-form-dialog';

const selectClass =
  'h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';
const inlineSelectClass =
  'h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function ExpertsList() {
  const router = useRouter();
  const [rows, setRows] = useState<ExpertRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [pipelineStage, setPipelineStage] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (q.trim()) params.set('q', q.trim());
    if (pipelineStage) params.set('pipelineStage', pipelineStage);
    const res = await fetch(`/api/metworkcrm/experts?${params.toString()}`);
    const data = res.ok ? await res.json() : { rows: [], total: 0 };
    setRows(data.rows);
    setTotal(data.total);
    setLoading(false);
  }, [q, pipelineStage, offset]);

  useEffect(() => {
    setOffset(0);
  }, [q, pipelineStage]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function changeStage(row: ExpertRow, next: string) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, pipelineStage: next } : r)));
    const res = await fetch(`/api/metworkcrm/experts/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineStage: next }),
    });
    if (!res.ok) load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par nom…" className="h-10 w-full max-w-xs" />
        <select value={pipelineStage} onChange={(e) => setPipelineStage(e.target.value)} className={selectClass}>
          <option value="">Toutes les étapes</option>
          {Object.entries(EXPERT_STAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <ExpertFormDialog
          onSaved={(id) => router.push(`/metworkcrm/experts/${id}`)}
          trigger={<CrmButton size="sm" className="ms-auto"><Plus className="size-4" aria-hidden /> Nouvel expert</CrmButton>}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Spécialités</TableHead>
              <TableHead>Ville</TableHead>
              <TableHead>Étape</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-neutral-400">Chargement…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-neutral-400">Aucun expert trouvé.</TableCell></TableRow>
            ) : (
              rows.map((x) => (
                <TableRow key={x.id}>
                  <TableCell
                    className="cursor-pointer font-medium text-[var(--crm-black)]"
                    onClick={() => router.push(`/metworkcrm/experts/${x.id}`)}
                  >
                    {x.displayNameCache ?? x.name}
                  </TableCell>
                  <TableCell>{x.specialties.length > 0 ? x.specialties.join(', ') : '—'}</TableCell>
                  <TableCell>{x.city ?? '—'}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <select value={x.pipelineStage} onChange={(e) => changeStage(x, e.target.value)} className={inlineSelectClass}>
                      {Object.entries(EXPERT_STAGE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {total > limit ? (
        <div className="flex items-center justify-between text-sm text-neutral-500">
          <span>{offset + 1}–{Math.min(offset + limit, total)} sur {total}</span>
          <div className="flex gap-2">
            <CrmButton size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Précédent</CrmButton>
            <CrmButton size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Suivant</CrmButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
