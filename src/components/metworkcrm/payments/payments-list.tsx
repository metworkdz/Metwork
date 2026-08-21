'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import { PAYMENT_STATUS_BADGE, PAYMENT_STATUS_LABELS } from '@/components/metworkcrm/shared/labels';
import { PaymentFormDialog, type PaymentRow } from './payment-form-dialog';

const selectClass =
  'h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';
const inlineSelectClass =
  'h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function PaymentsList() {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (overdue) params.set('overdue', 'true');
    const res = await fetch(`/api/metworkcrm/payments?${params.toString()}`);
    const data = res.ok ? await res.json() : { rows: [], total: 0 };
    setRows(data.rows);
    setTotal(data.total);
    setLoading(false);
  }, [q, status, overdue, offset]);

  useEffect(() => {
    setOffset(0);
  }, [q, status, overdue]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function changeStatus(row: PaymentRow, next: string) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    const res = await fetch(`/api/metworkcrm/payments/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par libellé…" className="h-10 w-full max-w-xs" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="">Tous les statuts</option>
          {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <label className="flex h-10 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-600">
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} className="size-3.5 rounded border-neutral-300 text-[var(--crm-green)] focus:ring-[var(--crm-green)]" />
          En retard
        </label>

        <PaymentFormDialog
          onSaved={load}
          trigger={<CrmButton size="sm" className="ms-auto"><Plus className="size-4" aria-hidden /> Nouveau paiement</CrmButton>}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Libellé</TableHead>
              <TableHead>Montant</TableHead>
              <TableHead>Échéance</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-neutral-400">Chargement…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-neutral-400">Aucun paiement trouvé.</TableCell></TableRow>
            ) : (
              rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-[var(--crm-black)]">{p.label}</TableCell>
                  <TableCell>
                    {p.direction === 'OUT' ? '− ' : ''}
                    {p.amount != null ? `${p.amount.toLocaleString('fr-FR')} ${p.currency}` : '—'}
                  </TableCell>
                  <TableCell>{p.dueDate ?? '—'}</TableCell>
                  <TableCell>
                    <select value={p.status} onChange={(e) => changeStatus(p, e.target.value)} className={inlineSelectClass}>
                      {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <Badge variant={PAYMENT_STATUS_BADGE[p.status] ?? 'default'} className="ms-2">
                      {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <PaymentFormDialog
                      payment={p}
                      onSaved={load}
                      trigger={<CrmButton size="sm" variant="ghost">Modifier</CrmButton>}
                    />
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
