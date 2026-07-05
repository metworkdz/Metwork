'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Pencil, Trash2, UsersRound } from 'lucide-react';
import { ListingManagementTable, type ListingColumn } from './listing-management-table';
import { ClientFormDialog } from './client-form-dialog';

interface ClientRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  idCardNumber: string | null;
  companyName: string | null;
  notes: string | null;
  clientType?: 'COMPANY' | 'INDIVIDUAL';
  legalName?: string | null;
  address?: string | null;
  rc?: string | null;
  nif?: string | null;
  nis?: string | null;
  ai?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function ClientsManager() {
  const t = useTranslations('incubator.clients');
  const [rows, setRows]             = useState<ClientRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Edit dialog state — reuses ClientFormDialog (controlled) so edits get the
  // same Entreprise / Personne physique billing fields as creation.
  const [editing, setEditing]   = useState<ClientRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  async function fetchClients() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/incubator/clients', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load clients');
      const data = await res.json() as { items: ClientRow[] };
      setRows(data.items);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Error loading clients');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchClients(); }, []);

  function openEdit(row: ClientRow) {
    setEditing(row);
    setEditOpen(true);
  }

  async function handleDelete(row: ClientRow) {
    if (!confirm(`Delete client "${row.fullName}"? This cannot be undone.`)) return;
    await fetch(`/api/incubator/clients/${row.id}`, { method: 'DELETE' });
    void fetchClients();
  }

  const columns: ListingColumn<ClientRow>[] = [
    {
      key: 'name',
      label: t('colClient'),
      render: (r) => (
        <div>
          <div className="font-medium">
            {r.clientType === 'COMPANY' ? (r.legalName ?? r.companyName ?? r.fullName) : r.fullName}
          </div>
          {r.clientType === 'COMPANY'
            ? <div className="text-xs text-muted-foreground">{r.fullName}</div>
            : r.companyName && (
                <div className="text-xs text-muted-foreground">{r.companyName}</div>
              )}
        </div>
      ),
    },
    {
      key: 'contact',
      label: t('colContact'),
      render: (r) => (
        <div className="text-sm">
          {r.email && <div>{r.email}</div>}
          {r.phone && <div className="text-xs text-muted-foreground">{r.phone}</div>}
          {!r.email && !r.phone && <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      key: 'idCard',
      label: t('colIdCard'),
      render: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.clientType === 'COMPANY' ? (r.nif ?? '—') : (r.idCardNumber ?? '—')}
        </span>
      ),
    },
    {
      key: 'added',
      label: t('colAdded'),
      align: 'end',
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {new Date(r.createdAt).toLocaleDateString()}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {fetchError}
      </div>
    );
  }

  return (
    <>
      {/* Edit dialog — the shared client form in controlled mode */}
      {editing && (
        <ClientFormDialog
          key={editing.id}
          client={editing}
          open={editOpen}
          onOpenChange={(v) => { setEditOpen(v); if (!v) setEditing(null); }}
          onSaved={() => { setEditOpen(false); setEditing(null); void fetchClients(); }}
        />
      )}

      <ListingManagementTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        createSlot={<ClientFormDialog onSaved={() => void fetchClients()} />}
        emptyIcon={<UsersRound className="size-5 text-muted-foreground" />}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        actions={[
          {
            label: t('actionEdit'),
            icon: <Pencil className="size-4" />,
            onSelect: openEdit,
          },
          {
            label: t('actionDelete'),
            icon: <Trash2 className="size-4" />,
            onSelect: (row) => void handleDelete(row),
            destructive: true,
          },
        ]}
      />
    </>
  );
}
