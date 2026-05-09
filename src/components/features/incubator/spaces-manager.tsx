'use client';

import { useRef, useState } from 'react';
import { Building2, CalendarOff, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
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
import type { IncubatorSpaceRecord, IncubatorSpaceCategory } from '@/server/db/store';

const CATEGORIES: { value: IncubatorSpaceCategory; label: string }[] = [
  { value: 'COWORKING', label: 'Coworking' },
  { value: 'PRIVATE_OFFICE', label: 'Private office' },
  { value: 'TRAINING_ROOM', label: 'Training room' },
  { value: 'DOMICILIATION', label: 'Domiciliation' },
];

function fmt(n: number | null): string {
  if (n == null) return '—';
  return `${n.toLocaleString()} DZD`;
}

const blank = {
  name: '', description: '', category: 'COWORKING' as IncubatorSpaceCategory,
  city: '', pricePerHour: '', pricePerDay: '', pricePerMonth: '',
  capacity: '1', amenities: '', status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  imageUrl: '',
};

interface Props { initial: IncubatorSpaceRecord[] }

export function SpacesManager({ initial }: Props) {
  const [spaces, setSpaces] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IncubatorSpaceRecord | null>(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IncubatorSpaceRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [availTarget, setAvailTarget] = useState<IncubatorSpaceRecord | null>(null);
  const [availDates, setAvailDates] = useState('');
  const [availSaving, setAvailSaving] = useState(false);
  const [availError, setAvailError] = useState<string | null>(null);

  function openAvailability(s: IncubatorSpaceRecord) {
    setAvailTarget(s);
    setAvailDates((s.unavailableDates ?? []).join(', '));
    setAvailError(null);
  }

  async function saveAvailability() {
    if (!availTarget) return;
    setAvailSaving(true); setAvailError(null);
    const dates = availDates
      .split(/[,\n]+/)
      .map((d) => d.trim())
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    try {
      const res = await fetch(`/api/incubator/spaces/${availTarget.id}/availability`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ unavailableDates: dates }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Failed to save');
      }
      const data = await res.json() as { unavailableDates: string[] };
      setSpaces((prev) =>
        prev.map((s) =>
          s.id === availTarget.id ? { ...s, unavailableDates: data.unavailableDates } : s,
        ),
      );
      setAvailTarget(null);
    } catch (err) {
      setAvailError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setAvailSaving(false); }
  }

  function openCreate() {
    setEditing(null); setForm(blank); setError(null); setDialogOpen(true);
  }

  function openEdit(s: IncubatorSpaceRecord) {
    setEditing(s);
    setForm({
      name: s.name, description: s.description, category: s.category, city: s.city,
      pricePerHour: s.pricePerHour?.toString() ?? '',
      pricePerDay: s.pricePerDay?.toString() ?? '',
      pricePerMonth: s.pricePerMonth?.toString() ?? '',
      capacity: s.capacity.toString(),
      amenities: s.amenities.join(', '),
      status: s.status,
      imageUrl: s.imageUrl ?? '',
    });
    setError(null); setDialogOpen(true);
  }

  async function handleImageFile(file: File) {
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/incubator/upload', {
        method: 'POST', credentials: 'include', body: fd,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Upload failed');
      }
      const data = await res.json() as { url: string };
      setForm((f) => ({ ...f, imageUrl: data.url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function parsePrice(v: string): number | null {
    const n = parseInt(v, 10);
    return isNaN(n) || v.trim() === '' ? null : n;
  }

  async function save() {
    setSaving(true); setError(null);
    const body = {
      name: form.name.trim(), description: form.description.trim(),
      category: form.category, city: form.city.trim(),
      imageUrl: form.imageUrl.trim() || null,
      pricePerHour: parsePrice(form.pricePerHour),
      pricePerDay: parsePrice(form.pricePerDay),
      pricePerMonth: parsePrice(form.pricePerMonth),
      capacity: parseInt(form.capacity, 10) || 1,
      amenities: form.amenities.split(',').map((a) => a.trim()).filter(Boolean),
      status: form.status,
    };
    try {
      if (editing) {
        const res = await fetch(`/api/incubator/spaces/${editing.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify(body),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
          throw new Error(d.error?.message ?? 'Update failed');
        }
        const data = await res.json() as { space: IncubatorSpaceRecord };
        setSpaces((prev) => prev.map((s) => s.id === editing.id ? data.space : s));
      } else {
        const res = await fetch('/api/incubator/spaces', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify(body),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
          throw new Error(d.error?.message ?? 'Create failed');
        }
        const data = await res.json() as { space: IncubatorSpaceRecord };
        setSpaces((prev) => [data.space, ...prev]);
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
      const res = await fetch(`/api/incubator/spaces/${deleteTarget.id}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) throw new Error();
      setSpaces((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch { /* keep dialog open */ } finally { setDeleting(false); }
  }

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-3">
          <p className="text-sm text-muted-foreground">{spaces.length} space{spaces.length === 1 ? '' : 's'}</p>
          <Button size="sm" onClick={openCreate}><Plus className="size-4" /> New space</Button>
        </div>
        <CardContent className="p-0">
          {spaces.length === 0 ? (
            <InlineEmptyState
              title="No spaces yet" description="Add coworking floors, private offices, or training rooms."
              icon={<Building2 className="size-5 text-muted-foreground" />}
              action={<Button size="sm" onClick={openCreate}><Plus className="size-4" />Create</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Space</TableHead><TableHead>Category</TableHead>
                    <TableHead>Capacity</TableHead><TableHead>Pricing</TableHead>
                    <TableHead>Status</TableHead><TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spaces.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-muted-foreground">{s.city}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{CATEGORIES.find((c) => c.value === s.category)?.label ?? s.category}</Badge>
                      </TableCell>
                      <TableCell>{s.capacity} seats</TableCell>
                      <TableCell className="text-sm">
                        {s.pricePerHour != null && <div>{fmt(s.pricePerHour)}/hr</div>}
                        {s.pricePerDay != null && <div className="text-xs text-muted-foreground">{fmt(s.pricePerDay)}/day</div>}
                        {s.pricePerMonth != null && <div className="text-xs text-muted-foreground">{fmt(s.pricePerMonth)}/mo</div>}
                        {s.pricePerHour == null && s.pricePerDay == null && s.pricePerMonth == null && (
                          <span className="text-muted-foreground">No pricing</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.status === 'ACTIVE' ? 'success' : 'default'}>
                          {s.status.toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Manage availability" onClick={() => openAvailability(s)}>
                            <CalendarOff className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(s)}
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
            <DialogTitle>{editing ? 'Edit space' : 'New space'}</DialogTitle>
            <DialogDescription>
              {editing ? `Update details for ${editing.name}.` : 'Add a new space to your incubator.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="sp-name">Space name *</Label>
                <Input id="sp-name" value={form.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Open Coworking Floor" />
              </div>
              <div className="space-y-1.5">
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={(v: string) => setForm((f) => ({ ...f, category: v as IncubatorSpaceCategory }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-city">City *</Label>
                <Input id="sp-city" value={form.city}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="sp-desc">Description</Label>
                <textarea id="sp-desc" rows={3} value={form.description}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Describe the space, amenities, rules…"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-cap">Capacity (seats) *</Label>
                <Input id="sp-cap" type="number" min={1} value={form.capacity}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v: string) => setForm((f) => ({ ...f, status: v as 'ACTIVE' | 'INACTIVE' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-hour">Price / hour (DZD)</Label>
                <Input id="sp-hour" type="number" min={0} value={form.pricePerHour}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, pricePerHour: e.target.value }))}
                  placeholder="Leave blank if not offered" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-day">Price / day (DZD)</Label>
                <Input id="sp-day" type="number" min={0} value={form.pricePerDay}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, pricePerDay: e.target.value }))}
                  placeholder="Leave blank if not offered" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-month">Price / month (DZD)</Label>
                <Input id="sp-month" type="number" min={0} value={form.pricePerMonth}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, pricePerMonth: e.target.value }))}
                  placeholder="Leave blank if not offered" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-amenities">Amenities (comma-separated)</Label>
                <Input id="sp-amenities" value={form.amenities}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, amenities: e.target.value }))}
                  placeholder="WiFi, Coffee, Printer" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Space image</Label>
                <div className="flex items-center gap-3">
                  {form.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.imageUrl} alt="Space preview"
                      className="h-16 w-24 rounded-md border object-cover" />
                  ) : (
                    <div className="flex h-16 w-24 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                      <ImagePlus className="size-5" />
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleImageFile(f);
                        e.target.value = '';
                      }}
                    />
                    <Button type="button" variant="outline" size="sm"
                      loading={uploading}
                      onClick={() => fileInputRef.current?.click()}>
                      {uploading ? 'Uploading…' : 'Upload image'}
                    </Button>
                    {form.imageUrl && (
                      <button type="button"
                        className="text-xs text-destructive hover:underline"
                        onClick={() => setForm((f) => ({ ...f, imageUrl: '' }))}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button loading={saving} onClick={save} disabled={!form.name.trim() || !form.city.trim() || uploading}>
              {editing ? 'Save changes' : 'Create space'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o: boolean) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete space?</DialogTitle>
            <DialogDescription>
              <strong>{deleteTarget?.name}</strong> will be permanently deleted. Existing bookings won&apos;t be affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" loading={deleting} onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Availability Dialog */}
      <Dialog open={!!availTarget} onOpenChange={(o: boolean) => { if (!o) setAvailTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Blocked dates — {availTarget?.name}</DialogTitle>
            <DialogDescription>
              Enter YYYY-MM-DD dates (comma or newline separated) when this space cannot be booked. Bookings on these dates will be rejected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <textarea
              rows={6}
              value={availDates}
              onChange={(e) => setAvailDates(e.target.value)}
              placeholder="2025-12-25, 2025-12-26&#10;2026-01-01"
              disabled={availSaving}
              className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground">
              Currently blocked: {(availTarget?.unavailableDates ?? []).length} date(s)
            </p>
            {availError && <p className="text-xs text-destructive">{availError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAvailTarget(null)} disabled={availSaving}>Cancel</Button>
            <Button loading={availSaving} onClick={saveAvailability}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
