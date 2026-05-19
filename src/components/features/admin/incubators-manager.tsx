'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Building2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import type { IncubatorRecord, IncubatorStatus, IncubatorSubscription } from '@/server/db/store';

/* ─────────────────────────── Status badge ─────────────────────────── */

const STATUS_VARIANT: Record<IncubatorStatus, 'success' | 'warning' | 'danger' | 'outline'> = {
  PENDING:   'outline',
  ACTIVE:    'success',
  INACTIVE:  'warning',
  SUSPENDED: 'danger',
};

const STATUS_LABEL: Record<IncubatorStatus, string> = {
  PENDING:   'Pending approval',
  ACTIVE:    'Active',
  INACTIVE:  'Inactive',
  SUSPENDED: 'Suspended',
};

type StatusFilter = 'ALL' | 'PENDING' | 'ACTIVE';

const SUB_LABEL: Record<IncubatorSubscription, string> = {
  COMMISSION: 'Commission (20%)',
  FLAT:       'Flat (6,000 DZD/mo)',
};

/* ─────────────────────────── Form dialog ─────────────────────────── */

interface FormValues {
  name:             string;
  email:            string;
  phone:            string;
  city:             string;
  status:           IncubatorStatus;
  subscriptionCode: IncubatorSubscription;
}

const defaultValues: FormValues = {
  name:             '',
  email:            '',
  phone:            '',
  city:             '',
  status:           'ACTIVE',
  subscriptionCode: 'COMMISSION',
};

interface IncubatorFormDialogProps {
  open:     boolean;
  editing:  IncubatorRecord | null;
  onClose:  () => void;
  onSaved:  (record: IncubatorRecord) => void;
}

function IncubatorFormDialog({ open, editing, onClose, onSaved }: IncubatorFormDialogProps) {
  const t = useTranslations('admin.incubatorsManager');
  const [form,     setForm]     = useState<FormValues>(defaultValues);
  const [saving,   setSaving]   = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync form state whenever the dialog opens or the target record changes.
  // This is the fix for the useState-lazy-initializer bug: the initializer
  // only runs once on mount, so switching between add/edit left stale values.
  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? { name: editing.name, email: editing.email ?? '', phone: editing.phone ?? '',
            city: editing.city, status: editing.status, subscriptionCode: editing.subscriptionCode ?? 'COMMISSION' }
        : defaultValues,
    );
    setErrorMsg(null);
  }, [open, editing]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) { onClose(); return; }
  }

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);

    const url    = editing ? `/api/admin/incubators/${editing.id}` : '/api/admin/incubators';
    const method = editing ? 'PATCH' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? t('saveFailed'));
      }
      const record = await res.json() as IncubatorRecord;
      onSaved(record);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>
            {editing ? t('editDescription', { name: editing.name }) : t('addDescription')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="inc-name">{t('fieldName')}</Label>
              <Input id="inc-name" value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder={t('namePlaceholder')} required disabled={saving} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inc-email">{t('fieldEmail')}</Label>
              <Input id="inc-email" type="email" value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder={t('emailPlaceholder')} required disabled={saving} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inc-phone">{t('fieldPhone')}</Label>
              <Input id="inc-phone" type="tel" value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder={t('phonePlaceholder')} required disabled={saving} dir="ltr" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inc-city">{t('fieldCity')}</Label>
              <Input id="inc-city" value={form.city} onChange={(e) => set('city', e.target.value)}
                placeholder={t('cityPlaceholder')} required disabled={saving} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inc-status">{t('fieldStatus')}</Label>
              <Select value={form.status} onValueChange={(v) => set('status', v as IncubatorStatus)}>
                <SelectTrigger id="inc-status" disabled={saving}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING">Pending approval</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                  <SelectItem value="SUSPENDED">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="inc-sub">{t('fieldSubscription')}</Label>
              <Select value={form.subscriptionCode}
                onValueChange={(v) => set('subscriptionCode', v as IncubatorSubscription)}>
                <SelectTrigger id="inc-sub" disabled={saving}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMMISSION">{t('subCommission')}</SelectItem>
                  <SelectItem value="FLAT">{t('subFlat')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {errorMsg && (
            <p className="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              {errorMsg}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? t('saveChanges') : t('addIncubator')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Main manager ─────────────────────────── */

interface AdminIncubatorsManagerProps {
  initial: IncubatorRecord[];
}

export function AdminIncubatorsManager({ initial }: AdminIncubatorsManagerProps) {
  const t = useTranslations('admin.incubatorsManager');
  const [incubators, setIncubators] = useState<IncubatorRecord[]>(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing,    setEditing]    = useState<IncubatorRecord | null>(null);
  const [filter,     setFilter]     = useState<StatusFilter>('ALL');
  const [approvingId, setApprovingId] = useState<string | null>(null);

  function openAdd()  { setEditing(null); setDialogOpen(true); }
  function openEdit(inc: IncubatorRecord) { setEditing(inc); setDialogOpen(true); }

  function handleSaved(record: IncubatorRecord) {
    setIncubators((prev) => {
      const idx = prev.findIndex((x) => x.id === record.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = record;
        return next;
      }
      return [record, ...prev];
    });
  }

  async function approve(inc: IncubatorRecord) {
    setApprovingId(inc.id);
    try {
      const res = await fetch(`/api/admin/incubators/${inc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      if (!res.ok) throw new Error('Approve failed');
      const record = await res.json() as IncubatorRecord;
      handleSaved(record);
    } catch (err) {
      console.error('approve incubator failed', err);
    } finally {
      setApprovingId(null);
    }
  }

  const pendingCount = useMemo(
    () => incubators.filter((i) => i.status === 'PENDING').length,
    [incubators],
  );
  const activeOnlyCount = useMemo(
    () => incubators.filter((i) => i.status === 'ACTIVE').length,
    [incubators],
  );
  const filtered = useMemo(() => {
    if (filter === 'ALL') return incubators;
    return incubators.filter((i) => i.status === filter);
  }, [incubators, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={filter === 'ALL' ? 'default' : 'outline'}
            onClick={() => setFilter('ALL')}
          >
            All ({incubators.length})
          </Button>
          <Button
            size="sm"
            variant={filter === 'PENDING' ? 'default' : 'outline'}
            onClick={() => setFilter('PENDING')}
          >
            Pending approval ({pendingCount})
          </Button>
          <Button
            size="sm"
            variant={filter === 'ACTIVE' ? 'default' : 'outline'}
            onClick={() => setFilter('ACTIVE')}
          >
            Active ({activeOnlyCount})
          </Button>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="size-4" />
          {t('addIncubator')}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <InlineEmptyState
              title={filter === 'PENDING' ? 'No incubators awaiting approval' : 'No incubators yet'}
              description={
                filter === 'PENDING'
                  ? 'New signups will appear here for review.'
                  : 'Add the first incubator to get started.'
              }
              action={
                <Button size="sm" onClick={openAdd}>
                  <Plus className="size-4" />
                  {t('addIncubator')}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((inc) => (
            <Card key={inc.id} className="border-border/60">
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Building2 className="size-4 shrink-0 text-muted-foreground" />
                      <p className="font-medium text-foreground truncate">{inc.name}</p>
                      <Badge variant={STATUS_VARIANT[inc.status]} className="text-xs">
                        {STATUS_LABEL[inc.status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {inc.city} · {inc.email} · {inc.phone}
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      {inc.subscriptionCode ? SUB_LABEL[inc.subscriptionCode] : t('subCommissionShort')} · {t('addedDate', { date: new Date(inc.createdAt).toLocaleDateString() })}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {inc.status === 'PENDING' && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => approve(inc)}
                        loading={approvingId === inc.id}
                      >
                        <CheckCircle2 className="size-3" />
                        Approve
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openEdit(inc)}>
                      <Pencil className="size-3" />
                      Edit
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <IncubatorFormDialog
        open={dialogOpen}
        editing={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
}
