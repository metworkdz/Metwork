'use client';

/**
 * Admin: incubators CRUD manager.
 * Table of incubator profiles with add / edit / suspend / delete actions.
 */
import { useState } from 'react';
import { Building2, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import type { IncubatorRecord, UserRecord } from '@/server/db/store';

type IncubatorRow = IncubatorRecord & { managerName?: string };

interface IncubatorFormData {
  name: string;
  description: string;
  city: string;
  managerId: string;
  website: string;
  subscriptionTier: 'COMMISSION' | 'FLAT';
}

const EMPTY_FORM: IncubatorFormData = {
  name: '', description: '', city: '', managerId: '', website: '', subscriptionTier: 'COMMISSION',
};

interface FormDialogProps {
  open: boolean;
  initial: IncubatorRow | null;
  managers: Pick<UserRecord, 'id' | 'fullName' | 'email'>[];
  onClose: () => void;
  onSaved: (inc: IncubatorRow) => void;
}

function IncubatorFormDialog({ open, initial, managers, onClose, onSaved }: FormDialogProps) {
  const [form, setForm] = useState<IncubatorFormData>(
    initial
      ? {
          name: initial.name,
          description: initial.description,
          city: initial.city,
          managerId: initial.managerId ?? '',
          website: initial.website ?? '',
          subscriptionTier: initial.subscriptionTier,
        }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  function set<K extends keyof IncubatorFormData>(k: K, v: IncubatorFormData[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    setSaving(true); setError(null);
    try {
      const body = {
        ...form,
        managerId: form.managerId || null,
        website:   form.website   || null,
      };
      const url    = initial ? `/api/admin/incubators/${initial.id}` : '/api/admin/incubators';
      const method = initial ? 'PATCH' : 'POST';
      const res    = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? 'Save failed');
      }
      const data = await res.json() as { incubator: IncubatorRecord };
      const manager = managers.find((m) => m.id === data.incubator.managerId);
      onSaved({ ...data.incubator, managerName: manager?.fullName });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit incubator' : 'Add incubator'}</DialogTitle>
          <DialogDescription>
            {initial ? 'Update the incubator profile.' : 'Register a new incubator on the platform.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="inc-name">Name *</Label>
            <Input id="inc-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Oran Startup Hub" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-desc">Description *</Label>
            <textarea
              id="inc-desc"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              placeholder="Short description of the incubator…"
              className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="inc-city">City *</Label>
              <Input id="inc-city" value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Algiers" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inc-web">Website</Label>
              <Input id="inc-web" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Billing model</Label>
              <Select value={form.subscriptionTier} onValueChange={(v) => set('subscriptionTier', v as 'COMMISSION' | 'FLAT')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMMISSION">Commission (20%)</SelectItem>
                  <SelectItem value="FLAT">Flat (6 000 DZD/mo)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Manager (optional)</Label>
              <Select value={form.managerId} onValueChange={(v) => set('managerId', v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button loading={saving} onClick={submit}>
            {initial ? 'Save changes' : 'Create incubator'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Main component ─────────────────────────── */

interface Props {
  initial:  IncubatorRow[];
  managers: Pick<UserRecord, 'id' | 'fullName' | 'email'>[];
}

export function IncubatorsManager({ initial, managers }: Props) {
  const [rows,      setRows]      = useState<IncubatorRow[]>(initial);
  const [editing,   setEditing]   = useState<IncubatorRow | null>(null);
  const [formOpen,  setFormOpen]  = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [deleting,  setDeleting]  = useState<IncubatorRow | null>(null);
  const [delBusy,   setDelBusy]   = useState(false);
  const [delErr,    setDelErr]    = useState<string | null>(null);

  function openCreate() { setEditing(null); setCreateKey((k) => k + 1); setFormOpen(true); }
  function openEdit(row: IncubatorRow) { setEditing(row); setFormOpen(true); }

  function onSaved(saved: IncubatorRow) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === saved.id);
      if (idx === -1) return [...prev, saved];
      const next = prev.slice(); next[idx] = saved; return next;
    });
  }

  async function toggleStatus(row: IncubatorRow) {
    const next = row.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const res = await fetch(`/api/admin/incubators/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) {
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: next } : r));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDelBusy(true); setDelErr(null);
    try {
      const res = await fetch(`/api/admin/incubators/${deleting.id}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) throw new Error('Delete failed');
      setRows((prev) => prev.filter((r) => r.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      setDelErr(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDelBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          {rows.length} incubator{rows.length !== 1 ? 's' : ''} registered
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" /> Add incubator
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <InlineEmptyState
              title="No incubators yet"
              description="Register the first incubator to start managing spaces and programs."
              icon={<Building2 className="size-5 text-muted-foreground" />}
              action={<Button size="sm" onClick={openCreate}><Plus className="size-4" /> Add incubator</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">City</TableHead>
                    <TableHead className="hidden md:table-cell">Manager</TableHead>
                    <TableHead>Billing</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{row.name}</div>
                        {row.website && (
                          <a href={row.website} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:underline">
                            {row.website}
                          </a>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {row.city}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {row.managerName ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.subscriptionTier === 'FLAT' ? 'info' : 'warning'}>
                          {row.subscriptionTier === 'FLAT' ? 'Flat' : 'Commission'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === 'ACTIVE' ? 'success' : 'danger'}>
                          {row.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Actions">
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openEdit(row)}>
                              <Pencil className="size-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => toggleStatus(row)}>
                              {row.status === 'ACTIVE' ? 'Suspend' : 'Reinstate'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setDeleting(row)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="size-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* key forces a full re-mount (and form state reset) when switching create ↔ edit,
          and on every new create attempt so stale form values are never carried over */}
      <IncubatorFormDialog
        key={editing?.id ?? `new-${createKey}`}
        open={formOpen}
        initial={editing}
        managers={managers}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSaved={onSaved}
      />

      <Dialog open={deleting !== null} onOpenChange={(o) => { if (!o) { setDeleting(null); setDelErr(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete incubator?</DialogTitle>
            <DialogDescription>
              {deleting && <>Remove <span className="font-medium">{deleting.name}</span> from the platform. This cannot be undone.</>}
            </DialogDescription>
          </DialogHeader>
          {delErr && <p className="text-xs text-destructive">{delErr}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" loading={delBusy} onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
