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
import {
  ORG_TYPE_LABELS,
  RECORD_STATUS_BADGE,
  RECORD_STATUS_LABELS,
} from '@/components/metworkcrm/shared/labels';
import { OrganizationFormDialog, type OrganizationRow } from './organization-form-dialog';

const selectClass =
  'h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function OrganizationsList() {
  const router = useRouter();
  const [rows, setRows] = useState<OrganizationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [sector, setSector] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (q.trim()) params.set('q', q.trim());
    if (type) params.set('type', type);
    if (sector.trim()) params.set('sector', sector.trim());
    if (city.trim()) params.set('city', city.trim());
    if (status) params.set('status', status);
    const res = await fetch(`/api/metworkcrm/organizations?${params.toString()}`);
    const data = res.ok ? await res.json() : { rows: [], total: 0 };
    setRows(data.rows);
    setTotal(data.total);
    setLoading(false);
  }, [q, type, sector, city, status, offset]);

  // Reset to page 1 whenever a filter changes, debounced for the free-text ones.
  useEffect(() => {
    setOffset(0);
  }, [q, type, sector, city, status]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const sectors = Array.from(new Set(rows.map((r) => r.sector).filter(Boolean))) as string[];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher par nom…"
          className="h-10 w-full max-w-xs"
        />
        <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
          <option value="">Tous les types</option>
          {Object.entries(ORG_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Secteur" className="h-10 w-32" />
        <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ville" className="h-10 w-32" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="">Tous les statuts</option>
          {Object.entries(RECORD_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <OrganizationFormDialog
          onSaved={(id) => router.push(`/metworkcrm/organizations/${id}`)}
          trigger={
            <CrmButton size="sm" className="ms-auto">
              <Plus className="size-4" aria-hidden /> Nouvelle organisation
            </CrmButton>
          }
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Secteur</TableHead>
              <TableHead>Ville</TableHead>
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
                  Aucune organisation trouvée.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((org) => (
                <TableRow
                  key={org.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/metworkcrm/organizations/${org.id}`)}
                >
                  <TableCell className="font-medium text-[var(--crm-black)]">{org.name}</TableCell>
                  <TableCell>{ORG_TYPE_LABELS[org.type] ?? org.type}</TableCell>
                  <TableCell>{org.sector ?? '—'}</TableCell>
                  <TableCell>{org.city ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={RECORD_STATUS_BADGE[org.status] ?? 'default'}>
                      {RECORD_STATUS_LABELS[org.status] ?? org.status}
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
      {/* `sectors` is unused visually today — kept for a future "sector" filter select once real data exists across incubators. */}
      <span className="hidden">{sectors.length}</span>
    </div>
  );
}
