'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Pencil, Trash2, UsersRound } from 'lucide-react';
import { ListingManagementTable, type ListingColumn } from './listing-management-table';
import { ClientFormDialog } from './client-form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ClientRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  idCardNumber: string | null;
  companyName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export function ClientsManager() {
  const t = useTranslations('incubator.clients');
  const [rows, setRows]             = useState<ClientRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Edit dialog state
  const [editing, setEditing]     = useState<ClientRow | null>(null);
  const [editOpen, setEditOpen]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editError, setEditError]   = useState<string | null>(null);
  const [fullName, setFullName]   = useState('');
  const [email, setEmail]         = useState('');
  const [phone, setPhone]         = useState('');
  const [idCard, setIdCard]       = useState('');
  const [company, setCompany]     = useState('');
  const [notes, setNotes]         = useState('');

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
    setFullName(row.fullName);
    setEmail(row.email ?? '');
    setPhone(row.phone ?? '');
    setIdCard(row.idCardNumber ?? '');
    setCompany(row.companyName ?? '');
    setNotes(row.notes ?? '');
    setEditError(null);
    setEditOpen(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/incubator/clients/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName:     fullName.trim(),
          email:        email.trim() || undefined,
          phone:        phone.trim() || undefined,
          idCardNumber: idCard.trim() || null,
          companyName:  company.trim() || null,
          notes:        notes.trim() || null,
        }),
      });
      if (!res.ok) {
        // API error envelope: { error: { code, message, details: { fieldErrors } } }
        const d = await res.json().catch(() => ({})) as {
          error?: { message?: string; details?: { fieldErrors?: Record<string, string[]> } };
        };
        const fieldReason = Object.values(d.error?.details?.fieldErrors ?? {})
          .flat()
          .find(Boolean);
        setEditError(fieldReason ?? d.error?.message ?? 'Failed to save.');
        return;
      }
      setEditOpen(false);
      void fetchClients();
    } catch {
      setEditError('Network error — try again.');
    } finally {
      setSubmitting(false);
    }
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
          <div className="font-medium">{r.fullName}</div>
          {r.companyName && (
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
        <span className="text-sm text-muted-foreground">{r.idCardNumber ?? '—'}</span>
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
      {/* Edit dialog — controlled from the manager */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
            <DialogDescription>{t('editDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleSaveEdit(e)} className="space-y-3 py-2">
            <div>
              <Label htmlFor="ec-name">{t('labelFullName')}</Label>
              <Input id="ec-name" className="mt-1" value={fullName}
                onChange={(e) => setFullName(e.target.value)} required minLength={2} maxLength={120} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ec-email">{t('labelEmail')}</Label>
                <Input id="ec-email" type="email" className="mt-1" value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
              </div>
              <div>
                <Label htmlFor="ec-phone">{t('labelPhone')}</Label>
                <Input id="ec-phone" type="tel" className="mt-1" value={phone}
                  onChange={(e) => setPhone(e.target.value)} placeholder="optional" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ec-id">{t('labelIdCard')}</Label>
                <Input id="ec-id" className="mt-1" value={idCard}
                  onChange={(e) => setIdCard(e.target.value)} placeholder="optional" />
              </div>
              <div>
                <Label htmlFor="ec-company">{t('labelCompany')}</Label>
                <Input id="ec-company" className="mt-1" value={company}
                  onChange={(e) => setCompany(e.target.value)} placeholder="optional" />
              </div>
            </div>
            <div>
              <Label htmlFor="ec-notes">{t('labelNotes')}</Label>
              <textarea
                id="ec-notes"
                className="mt-1 min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
              />
            </div>
            {editError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {editError}
              </div>
            )}
            <DialogFooter>
              <Button type="submit" loading={submitting}>{t('saveChanges')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
