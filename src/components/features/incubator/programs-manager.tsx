'use client';

/**
 * Incubator programs manager — full CRUD with add/edit dialog.
 */
import { useState } from 'react';
import { Briefcase, Pencil, Plus, Trash2 } from 'lucide-react';
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
import type { IncubatorProgramRecord, IncubatorProgramType } from '@/server/db/store';

const TYPES: { value: IncubatorProgramType; label: string }[] = [
  { value: 'INCUBATION', label: 'Incubation' },
  { value: 'ACCELERATION', label: 'Acceleration' },
  { value: 'TRAINING', label: 'Training' },
  { value: 'BOOTCAMP', label: 'Bootcamp' },
  { value: 'WORKSHOP', label: 'Workshop' },
];

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'default'> = {
  DRAFT: 'warning', PUBLISHED: 'success', CLOSED: 'default',
};

const blank = {
  title: '', description: '', type: 'INCUBATION' as IncubatorProgramType,
  city: '', price: '0', seatsTotal: '20',
  deadline: '', startDate: '', endDate: '',
  status: 'DRAFT' as 'DRAFT' | 'PUBLISHED' | 'CLOSED',
};

interface Props { initial: IncubatorProgramRecord[] }

export function ProgramsManager({ initial }: Props) {
  const [programs, setPrograms] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IncubatorProgramRecord | null>(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IncubatorProgramRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  function toDateInput(iso: string): string { return iso ? iso.slice(0, 10) : ''; }

  function openCreate() { setEditing(null); setForm(blank); setError(null); setDialogOpen(true); }

  function openEdit(p: IncubatorProgramRecord) {
    setEditing(p);
    setForm({
      title: p.title, description: p.description, type: p.type, city: p.city,
      price: p.price.toString(), seatsTotal: p.seatsTotal.toString(),
      deadline: toDateInput(p.deadline), startDate: toDateInput(p.startDate), endDate: toDateInput(p.endDate),
      status: p.status,
    });
    setError(null); setDialogOpen(true);
  }

  async function save() {
    setSaving(true); setError(null);
    const body = {
      title: form.title.trim(), description: form.description.trim(), type: form.type,
      city: form.city.trim(), price: parseInt(form.price, 10) || 0,
      seatsTotal: parseInt(form.seatsTotal, 10) || 20,
      deadline: form.deadline, startDate: form.startDate, endDate: form.endDate, status: form.status,
    };
    try {
      if (editing) {
        const res = await fetch(`/api/incubator/programs/${editing.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Update failed');
        const data = await res.json() as { program: IncubatorProgramRecord };
        setPrograms((prev) => prev.map((p) => p.id === editing.id ? data.program : p));
      } else {
        const res = await fetch('/api/incubator/programs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'include', body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Create failed');
        const data = await res.json() as { program: IncubatorProgramRecord };
        setPrograms((prev) => [data.program, ...prev]);
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
      const res = await fetch(`/api/incubator/programs/${deleteTarget.id}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) throw new Error();
      setPrograms((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch { /* keep dialog open */ } finally { setDeleting(false); }
  }

  const canSave = !!(form.title.trim() && form.city.trim() && form.deadline && form.startDate && form.endDate);

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-3">
          <p className="text-sm text-muted-foreground">{programs.length} program{programs.length === 1 ? '' : 's'}</p>
          <Button size="sm" onClick={openCreate}><Plus className="size-4" /> New program</Button>
        </div>
        <CardContent className="p-0">
          {programs.length === 0 ? (
            <InlineEmptyState
              title="No programs yet" description="Create incubation, acceleration, or training programs."
              icon={<Briefcase className="size-5 text-muted-foreground" />}
              action={<Button size="sm" onClick={openCreate}><Plus className="size-4" />Create</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Program</TableHead><TableHead>Type</TableHead>
                    <TableHead>Seats</TableHead><TableHead>Dates</TableHead>
                    <TableHead className="text-end">Price</TableHead>
                    <TableHead>Status</TableHead><TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {programs.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium">{p.title}</div>
                        <div className="text-xs text-muted-foreground">{p.city}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="info">{TYPES.find((t) => t.value === p.type)?.label ?? p.type}</Badge>
                      </TableCell>
                      <TableCell>{p.seatsTotal} seats</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        <div>{new Date(p.startDate).toLocaleDateString()}</div>
                        <div>→ {new Date(p.endDate).toLocaleDateString()}</div>
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-sm">
                        {p.price === 0 ? <Badge variant="success">Free</Badge> : `${p.price.toLocaleString()} DZD`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[p.status] ?? 'default'}>{p.status.toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(p)}
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
            <DialogTitle>{editing ? 'Edit program' : 'New program'}</DialogTitle>
            <DialogDescription>
              {editing ? `Update details for ${editing.title}.` : 'Create a new program for your incubator.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="pg-title">Program title *</Label>
                <Input id="pg-title" value={form.title}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Spring Acceleration Cohort 2026" />
              </div>
              <div className="space-y-1.5">
                <Label>Type *</Label>
                <Select value={form.type} onValueChange={(v: string) => setForm((f) => ({ ...f, type: v as IncubatorProgramType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pg-city">City *</Label>
                <Input id="pg-city" value={form.city}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="pg-desc">Description</Label>
                <textarea id="pg-desc" rows={3} value={form.description}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Describe the program, objectives, requirements…"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pg-price">Price (DZD) — 0 for free</Label>
                <Input id="pg-price" type="number" min={0} value={form.price}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, price: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pg-seats">Total seats *</Label>
                <Input id="pg-seats" type="number" min={1} value={form.seatsTotal}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, seatsTotal: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pg-deadline">Application deadline *</Label>
                <Input id="pg-deadline" type="date" value={form.deadline}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v: string) => setForm((f) => ({ ...f, status: v as 'DRAFT' | 'PUBLISHED' | 'CLOSED' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="PUBLISHED">Published</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pg-start">Start date *</Label>
                <Input id="pg-start" type="date" value={form.startDate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pg-end">End date *</Label>
                <Input id="pg-end" type="date" value={form.endDate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button loading={saving} onClick={save} disabled={!canSave}>
              {editing ? 'Save changes' : 'Create program'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o: boolean) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete program?</DialogTitle>
            <DialogDescription>
              <strong>{deleteTarget?.title}</strong> will be permanently deleted. Existing enrollments won&apos;t be refunded automatically.
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
