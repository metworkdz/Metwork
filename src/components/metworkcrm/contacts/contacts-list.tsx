'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { RECORD_STATUS_BADGE, RECORD_STATUS_LABELS } from '@/components/metworkcrm/shared/labels';
import { ContactFormDialog, type ContactRow } from './contact-form-dialog';

const selectClass =
  'h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function ContactsList() {
  const router = useRouter();
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    const res = await fetch(`/api/metworkcrm/contacts?${params.toString()}`);
    const data = res.ok ? await res.json() : { rows: [], total: 0 };
    setRows(data.rows);
    setTotal(data.total);
    setLoading(false);
  }, [q, status, offset]);

  useEffect(() => {
    setOffset(0);
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher par nom ou e-mail…"
          className="h-10 w-full max-w-xs"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="">Tous les statuts</option>
          {Object.entries(RECORD_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <ContactFormDialog
          onSaved={(id) => router.push(`/metworkcrm/contacts/${id}`)}
          trigger={
            <CrmButton size="sm" className="ms-auto">
              <Plus className="size-4" aria-hidden /> Nouveau contact
            </CrmButton>
          }
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Poste</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Téléphone</TableHead>
              <TableHead>Statut</TableHead>
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
                  Aucun contact trouvé.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/metworkcrm/contacts/${c.id}`)}>
                  <TableCell className="font-medium text-[var(--crm-black)]">{c.fullName ?? `${c.firstName} ${c.lastName}`}</TableCell>
                  <TableCell>{c.position ?? '—'}</TableCell>
                  <TableCell>{c.email ?? '—'}</TableCell>
                  <TableCell>{c.phone ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={RECORD_STATUS_BADGE[c.status] ?? 'default'}>
                      {RECORD_STATUS_LABELS[c.status] ?? c.status}
                    </Badge>
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
