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
import { BOOKING_STATUS_LABELS, SPACE_TYPE_LABELS } from '@/components/metworkcrm/shared/labels';
import { SpaceBookingFormDialog, type SpaceBookingRow } from './space-booking-form-dialog';

const selectClass =
  'h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';
const inlineSelectClass =
  'h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function SpaceBookingsList() {
  const router = useRouter();
  const [rows, setRows] = useState<SpaceBookingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [spaceType, setSpaceType] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (q.trim()) params.set('q', q.trim());
    if (spaceType) params.set('spaceType', spaceType);
    if (status) params.set('status', status);
    const res = await fetch(`/api/metworkcrm/space-bookings?${params.toString()}`);
    const data = res.ok ? await res.json() : { rows: [], total: 0 };
    setRows(data.rows);
    setTotal(data.total);
    setLoading(false);
  }, [q, spaceType, status, offset]);

  useEffect(() => {
    setOffset(0);
  }, [q, spaceType, status]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function changeStatus(row: SpaceBookingRow, next: string) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    const res = await fetch(`/api/metworkcrm/space-bookings/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par espace ou référence…" className="h-10 w-full max-w-xs" />
        <select value={spaceType} onChange={(e) => setSpaceType(e.target.value)} className={selectClass}>
          <option value="">Tous les types</option>
          {Object.entries(SPACE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="">Tous les statuts</option>
          {Object.entries(BOOKING_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <SpaceBookingFormDialog
          onSaved={(id) => router.push(`/metworkcrm/spaces/${id}`)}
          trigger={<CrmButton size="sm" className="ms-auto"><Plus className="size-4" aria-hidden /> Nouvelle réservation</CrmButton>}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Référence</TableHead>
              <TableHead>Espace</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Début</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-neutral-400">Chargement…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-neutral-400">Aucune réservation trouvée.</TableCell></TableRow>
            ) : (
              rows.map((b) => (
                <TableRow key={b.id}>
                  <TableCell
                    className="cursor-pointer font-medium text-[var(--crm-black)]"
                    onClick={() => router.push(`/metworkcrm/spaces/${b.id}`)}
                  >
                    {b.reference}
                  </TableCell>
                  <TableCell>{b.spaceLabel}</TableCell>
                  <TableCell>{SPACE_TYPE_LABELS[b.spaceType] ?? b.spaceType}</TableCell>
                  <TableCell>{b.startAt ? new Date(b.startAt).toLocaleString('fr-FR') : '—'}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <select value={b.status} onChange={(e) => changeStatus(b, e.target.value)} className={inlineSelectClass}>
                      {Object.entries(BOOKING_STATUS_LABELS).map(([value, label]) => (
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
