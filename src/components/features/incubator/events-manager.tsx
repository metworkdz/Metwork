'use client';

/**
 * Incubator events manager — full CRUD with add/edit dialog.
 * Mirrors the ProgramsManager / SpacesManager pattern.
 */
import { useState } from 'react';
import { Calendar, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import type { IncubatorEventRecord } from '@/server/db/store';

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'danger'> = {
  DRAFT: 'warning', PUBLISHED: 'success', CANCELLED: 'danger',
};

const blank = {
  title: '', description: '', city: '',
  price: '0', isOnline: false, capacity: '50',
  eventDate: '', status: 'DRAFT' as 'DRAFT' | 'PUBLISHED' | 'CANCELLED',
};

interface Props { initial: IncubatorEventRecord[] }

export function EventsManager({ initial }: Props) {
  const [events, setEvents] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IncubatorEventRecord | null>(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IncubatorEventRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  function toDatetimeLocal(iso: string): string {
    if (!iso) return '';
    // Trim to datetime-local format: "YYYY-MM-DDTHH:MM"
    return iso.slice(0, 16);
  }

  function openCreate() { setEditing(null); setForm(blank); setError(null); setDialogOpen(true); }

  function openEdit(e: IncubatorEventRecord) {
    setEditing(e);
    setForm({
      title: e.title, description: e.description, city: e.city,
      price: e.price.toString(), isOnline: e.isOnline, capacity: e.capacity.toString(),
      eventDate: toDatetimeLocal(e.eventDate), status: e.status,
    });
    setError(null); setDialogOpen(true);
  }

  async function save() {
    setSaving(true); setError(null);
    const body = {
      title: form.title.trim(), description: form.description.trim(),
      city: form.city.trim(), price: parseInt(form.price, 10) || 0,
      isOnline: form.isOnline, capacity: parseInt(form.capacity, 10) || 50,
      eventDate: form.eventDate ? new Date(form.eventDate).toISOString() : '',
      status: form.status,
    };
    try {
      if (editing) {
        const res = await fetch(`/api/incubator/events/${editing.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify(body),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
          throw new Error(d.error?.message ?? 'Update failed');
        }
        const data = await res.json() as { event: IncubatorEventRecord };
        setEvents((prev) => prev.map((ev) => ev.id === editing.id ? data.event : ev));
      } else {
        const res = await fetch('/api/incubator/events', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify(body),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
          throw new Error(d.error?.message ?? 'Create failed');
        }
        const data = await res.json() as { event: IncubatorEventRecord };
        setEvents((prev) => [data.event, ...prev]);
      }
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/incubator/events/${deleteTarget.id}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) throw new Error();
      setEvents((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch { /* keep dialog open */ } finally { setDeleting(false); }
  }

  const canSave = !!(form.title.trim() && form.city.trim() && form.eventDate);

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-3">
          <p className="text-sm text-muted-foreground">{events.length} event{events.length === 1 ? '' : 's'}</p>
          <Button size="sm" onClick={openCreate}><Plus className="size-4" /> New event</Button>
        </div>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <InlineEmptyState
              title="No events yet" description="Schedule pitch nights, demo days, and meetups."
              icon={<Calendar className="size-5 text-muted-foreground" />}
              action={<Button size="sm" onClick={openCreate}><Plus className="size-4" />Create</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead><TableHead>Date</TableHead>
                    <TableHead>Mode</TableHead><TableHead>Capacity</TableHead>
                    <TableHead className="text-end">Price</TableHead>
                    <TableHead>Status</TableHead><TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <div className="font-medium">{e.title}</div>
                        <div className="text-xs text-muted-foreground">{e.city}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(e.eventDate).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={e.isOnline ? 'info' : 'outline'}>
                          {e.isOnline ? 'Online' : 'In person'}
                        </Badge>
                      </TableCell>
                      <TableCell>{e.capacity} seats</TableCell>
                      <TableCell className="text-end tabular-nums text-sm">
                        {e.price === 0 ? <Badge variant="success">Free</Badge> : `${e.price.toLocaleString()} DZD`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[e.status] ?? 'default'}>{e.status.toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(e)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(e)}
                            className="text-destructive hover:text-destructive">
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o: boolean) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit event' : 'New event'}</DialogTitle>
            <DialogDescription>
              {editing ? `Update details for ${editing.title}.` : 'Create a new event for your incubator.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="ev-title">Event title *</Label>
                <Input id="ev-title" value={form.title}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Algiers Startup Pitch Night" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-city">City *</Label>
                <Input id="ev-city" value={form.city}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-date">Date & time *</Label>
                <Input id="ev-date" type="datetime-local" value={form.eventDate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, eventDate: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="ev-desc">Description</Label>
                <textarea id="ev-desc" rows={3} value={form.description}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Describe the event, agenda, speakers…"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-price">Price (DZD) — 0 for free</Label>
                <Input id="ev-price" type="number" min={0} value={form.price}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, price: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-cap">Capacity (seats) *</Label>
                <Input id="ev-cap" type="number" min={1} value={form.capacity}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select value={form.isOnline ? 'online' : 'inperson'}
                  onValueChange={(v: string) => setForm((f) => ({ ...f, isOnline: v === 'online' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inperson">In person</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v: string) => setForm((f) => ({ ...f, status: v as 'DRAFT' | 'PUBLISHED' | 'CANCELLED' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="PUBLISHED">Published</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button loading={saving} onClick={save} disabled={!canSave}>
              {editing ? 'Save changes' : 'Create event'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o: boolean) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete event?</DialogTitle>
            <DialogDescription>
              <strong>{deleteTarget?.title}</strong> will be permanently deleted. Existing registrations won&apos;t be refunded automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" loading={deleting} onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
