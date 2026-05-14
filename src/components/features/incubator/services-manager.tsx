'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Layers, Loader2, Pencil, PlusCircle, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { ListingManagementTable, type ListingColumn } from './listing-management-table';

interface ServiceRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

/* ── Create dialog ── */
function CreateServiceDialog({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations('incubator.services');
  const [open, setOpen]         = useState(false);
  const [submitting, setSub]    = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [name, setName]         = useState('');
  const [description, setDesc]  = useState('');

  function reset() { setName(''); setDesc(''); setError(null); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSub(true);
    try {
      const res = await fetch('/api/incubator/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string };
        setError(d.message ?? 'Failed to create service.'); return;
      }
      onCreated(); setOpen(false); reset();
    } catch { setError('Network error — try again.'); }
    finally   { setSub(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <PlusCircle className="size-4" />
          {t('addService')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
          <DialogDescription>{t('createDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 py-2">
          <div>
            <Label htmlFor="svc-name">{t('labelServiceName')}</Label>
            <Input id="svc-name" className="mt-1" value={name}
              onChange={(e) => setName(e.target.value)} required minLength={1} maxLength={120} />
          </div>
          <div>
            <Label htmlFor="svc-desc">{t('labelDescription')}</Label>
            <textarea
              id="svc-desc"
              className="mt-1 min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={description}
              onChange={(e) => setDesc(e.target.value)}
              maxLength={500}
              placeholder="Optional description…"
            />
          </div>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="submit" loading={submitting}>{t('create')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ServicesManager() {
  const t = useTranslations('incubator.services');
  const [rows, setRows]             = useState<ServiceRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Edit state
  const [editOpen, setEditOpen]     = useState(false);
  const [editing, setEditing]       = useState<ServiceRow | null>(null);
  const [editName, setEditName]     = useState('');
  const [editDesc, setEditDesc]     = useState('');
  const [editError, setEditError]   = useState<string | null>(null);
  const [saving, setSaving]         = useState(false);

  async function fetchServices() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/incubator/services', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load services');
      const data = await res.json() as { items: ServiceRow[] };
      setRows(data.items);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Error loading services');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchServices(); }, []);

  function openEdit(row: ServiceRow) {
    setEditing(row);
    setEditName(row.name);
    setEditDesc(row.description ?? '');
    setEditError(null);
    setEditOpen(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true); setEditError(null);
    try {
      const res = await fetch(`/api/incubator/services/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string };
        setEditError(d.message ?? 'Failed to save.'); return;
      }
      setEditOpen(false); void fetchServices();
    } catch { setEditError('Network error.'); }
    finally { setSaving(false); }
  }

  async function toggleActive(row: ServiceRow) {
    await fetch(`/api/incubator/services/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !row.isActive }),
    });
    void fetchServices();
  }

  async function handleDelete(row: ServiceRow) {
    if (!confirm(`Delete "${row.name}"? This will soft-delete the service.`)) return;
    await fetch(`/api/incubator/services/${row.id}`, { method: 'DELETE' });
    void fetchServices();
  }

  const columns: ListingColumn<ServiceRow>[] = [
    {
      key: 'name',
      label: t('colService'),
      render: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          {r.description && (
            <div className="text-xs text-muted-foreground line-clamp-1">{r.description}</div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      label: t('colStatus'),
      render: (r) => (
        <Badge variant={r.isActive ? 'default' : 'outline'}>
          {r.isActive ? t('statusActive') : t('statusInactive')}
        </Badge>
      ),
    },
    {
      key: 'added',
      label: t('colCreated'),
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
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
            <DialogDescription>{t('editDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleSaveEdit(e)} className="space-y-3 py-2">
            <div>
              <Label htmlFor="esvc-name">{t('labelServiceName')}</Label>
              <Input id="esvc-name" className="mt-1" value={editName}
                onChange={(e) => setEditName(e.target.value)} required minLength={1} maxLength={120} />
            </div>
            <div>
              <Label htmlFor="esvc-desc">{t('labelDescription')}</Label>
              <textarea
                id="esvc-desc"
                className="mt-1 min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                maxLength={500}
              />
            </div>
            {editError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {editError}
              </div>
            )}
            <DialogFooter>
              <Button type="submit" loading={saving}>{t('saveChanges')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ListingManagementTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        createSlot={<CreateServiceDialog onCreated={() => void fetchServices()} />}
        emptyIcon={<Layers className="size-5 text-muted-foreground" />}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        actions={[
          {
            label: t('actionEdit'),
            icon: <Pencil className="size-4" />,
            onSelect: openEdit,
          },
          {
            label: t('actionToggleActive'),
            icon: <ToggleRight className="size-4" />,
            onSelect: (row) => void toggleActive(row),
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
