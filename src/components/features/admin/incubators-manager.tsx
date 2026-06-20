'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Plus, Pencil, Building2, CheckCircle2, XCircle, Globe, Instagram, Archive, RotateCcw,
} from 'lucide-react';
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
  REJECTED:  'danger',
};

type StatusFilter = 'ALL' | 'PENDING' | 'ACTIVE' | 'ARCHIVED';

const SUB_LABEL: Record<IncubatorSubscription, string> = {
  COMMISSION: 'Commission (20%)',
  FLAT:       'Flat (6,000 DZD/mo)',
};

/* ─────────────────────────── Link helpers ─────────────────────────── */

function websiteHref(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}
function instagramHref(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = raw.replace(/^@/, '').trim();
  return `https://instagram.com/${handle}`;
}

/* ─────────────────────────── Form dialog ─────────────────────────── */

interface FormValues {
  name:             string;
  email:            string;
  phone:            string;
  city:             string;
  website:          string;
  instagram:        string;
  status:           IncubatorStatus;
  subscriptionCode: IncubatorSubscription;
}

const defaultValues: FormValues = {
  name:             '',
  email:            '',
  phone:            '',
  city:             '',
  website:          '',
  instagram:        '',
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

  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            name: editing.name, email: editing.email ?? '', phone: editing.phone ?? '',
            city: editing.city, website: editing.website ?? '', instagram: editing.instagram ?? '',
            status: editing.status, subscriptionCode: editing.subscriptionCode ?? 'COMMISSION',
          }
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
                  <SelectItem value="PENDING">{t('statusPending')}</SelectItem>
                  <SelectItem value="ACTIVE">{t('statusActive')}</SelectItem>
                  <SelectItem value="INACTIVE">{t('statusInactive')}</SelectItem>
                  <SelectItem value="SUSPENDED">{t('statusSuspended')}</SelectItem>
                  <SelectItem value="REJECTED">{t('statusRejected')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inc-website">{t('fieldWebsite')}</Label>
              <Input id="inc-website" type="url" dir="ltr" value={form.website}
                onChange={(e) => set('website', e.target.value)}
                placeholder={t('websitePlaceholder')} disabled={saving} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inc-instagram">{t('fieldInstagram')}</Label>
              <Input id="inc-instagram" dir="ltr" value={form.instagram}
                onChange={(e) => set('instagram', e.target.value)}
                placeholder={t('instagramPlaceholder')} disabled={saving} />
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

/* ─────────────────────────── Reject dialog ─────────────────────────── */

interface RejectDialogProps {
  incubator: IncubatorRecord | null;
  onClose: () => void;
  onRejected: (record: IncubatorRecord) => void;
}

function RejectDialog({ incubator, onClose, onRejected }: RejectDialogProps) {
  const t = useTranslations('admin.incubatorsManager');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (incubator) { setReason(''); setErrorMsg(null); }
  }, [incubator]);

  async function submit() {
    if (!incubator || !reason.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/incubators/${incubator.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'REJECTED', rejectionReason: reason.trim() }),
      });
      if (!res.ok) throw new Error(t('actionFailed'));
      onRejected(await res.json() as IncubatorRecord);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('actionFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!incubator} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('rejectTitle', { name: incubator?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('rejectDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reject-reason">{t('rejectReasonLabel')}</Label>
          <textarea
            id="reject-reason"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('rejectReasonPlaceholder')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button variant="destructive" onClick={submit} loading={saving} disabled={!reason.trim()}>
            {t('rejectConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Archive dialog ─────────────────────────── */

interface ArchiveDialogProps {
  incubator: IncubatorRecord | null;
  onClose: () => void;
  onArchived: (record: IncubatorRecord) => void;
}

function ArchiveDialog({ incubator, onClose, onArchived }: ArchiveDialogProps) {
  const t = useTranslations('admin.incubatorsManager');
  const [confirmText, setConfirmText] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (incubator) { setConfirmText(''); setErrorMsg(null); }
  }, [incubator]);

  const matches = !!incubator && confirmText.trim() === incubator.name.trim();

  async function submit() {
    if (!incubator || !matches) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/incubators/${incubator.id}/archive`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('actionFailed'));
      onArchived(await res.json() as IncubatorRecord);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('actionFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!incubator} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('archiveTitle', { name: incubator?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('archiveDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="archive-confirm">{t('archiveConfirmLabel', { name: incubator?.name ?? '' })}</Label>
          <Input
            id="archive-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
          />
        </div>
        {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button variant="destructive" onClick={submit} loading={saving} disabled={!matches}>
            {t('archiveConfirm')}
          </Button>
        </DialogFooter>
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
  const [rejecting,  setRejecting]  = useState<IncubatorRecord | null>(null);
  const [archiving,  setArchiving]  = useState<IncubatorRecord | null>(null);
  const [filter,     setFilter]     = useState<StatusFilter>('ALL');
  const [busyId,     setBusyId]     = useState<string | null>(null);

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
    setBusyId(inc.id);
    try {
      const res = await fetch(`/api/admin/incubators/${inc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      if (!res.ok) throw new Error(t('approveFailed'));
      handleSaved(await res.json() as IncubatorRecord);
    } catch (err) {
      console.error('approve incubator failed', err);
    } finally {
      setBusyId(null);
    }
  }

  async function restore(inc: IncubatorRecord) {
    setBusyId(inc.id);
    try {
      const res = await fetch(`/api/admin/incubators/${inc.id}/archive`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(t('actionFailed'));
      handleSaved(await res.json() as IncubatorRecord);
    } catch (err) {
      console.error('restore incubator failed', err);
    } finally {
      setBusyId(null);
    }
  }

  const nonArchived = useMemo(() => incubators.filter((i) => !i.archivedAt), [incubators]);
  const pendingCount = useMemo(() => nonArchived.filter((i) => i.status === 'PENDING').length, [nonArchived]);
  const activeOnlyCount = useMemo(() => nonArchived.filter((i) => i.status === 'ACTIVE').length, [nonArchived]);
  const archivedCount = useMemo(() => incubators.filter((i) => i.archivedAt).length, [incubators]);

  const filtered = useMemo(() => {
    if (filter === 'ARCHIVED') return incubators.filter((i) => i.archivedAt);
    if (filter === 'ALL') return nonArchived;
    return nonArchived.filter((i) => i.status === filter);
  }, [incubators, nonArchived, filter]);

  const statusLabel = (s: IncubatorStatus): string =>
    s === 'PENDING' ? t('statusPending')
    : s === 'ACTIVE' ? t('statusActive')
    : s === 'INACTIVE' ? t('statusInactive')
    : s === 'SUSPENDED' ? t('statusSuspended')
    : t('statusRejected');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={filter === 'ALL' ? 'default' : 'outline'} onClick={() => setFilter('ALL')}>
            {t('filterAll', { count: nonArchived.length })}
          </Button>
          <Button size="sm" variant={filter === 'PENDING' ? 'default' : 'outline'} onClick={() => setFilter('PENDING')}>
            {t('filterPending', { count: pendingCount })}
          </Button>
          <Button size="sm" variant={filter === 'ACTIVE' ? 'default' : 'outline'} onClick={() => setFilter('ACTIVE')}>
            {t('filterActive', { count: activeOnlyCount })}
          </Button>
          <Button size="sm" variant={filter === 'ARCHIVED' ? 'default' : 'outline'} onClick={() => setFilter('ARCHIVED')}>
            {t('filterArchived', { count: archivedCount })}
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
              title={
                filter === 'PENDING' ? t('emptyPendingTitle')
                : filter === 'ARCHIVED' ? t('emptyArchivedTitle')
                : t('emptyTitle')
              }
              description={
                filter === 'PENDING' ? t('emptyPendingDescription')
                : filter === 'ARCHIVED' ? t('emptyArchivedDescription')
                : t('emptyDescription')
              }
              action={
                filter === 'ARCHIVED' ? undefined : (
                  <Button size="sm" onClick={openAdd}>
                    <Plus className="size-4" />
                    {t('addIncubator')}
                  </Button>
                )
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
                        {statusLabel(inc.status)}
                      </Badge>
                      {inc.archivedAt && (
                        <Badge variant="danger" className="text-xs">{t('archivedBadge')}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[inc.city, inc.email, inc.phone].filter(Boolean).join(' · ') || t('noContactInfo')}
                    </p>
                    {(inc.website || inc.instagram) && (
                      <div className="flex flex-wrap items-center gap-3 pt-0.5" dir="ltr">
                        {inc.website && (
                          <a href={websiteHref(inc.website)} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <Globe className="size-3" /> {inc.website}
                          </a>
                        )}
                        {inc.instagram && (
                          <a href={instagramHref(inc.instagram)} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <Instagram className="size-3" /> {inc.instagram}
                          </a>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground/70">
                      {inc.subscriptionCode ? SUB_LABEL[inc.subscriptionCode] : t('subCommissionShort')} · {t('addedDate', { date: new Date(inc.createdAt).toLocaleDateString() })}
                    </p>
                    {inc.status === 'REJECTED' && inc.rejectionReason && (
                      <p className="mt-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">
                        <span className="font-semibold">{t('rejectionReasonShown')}:</span> {inc.rejectionReason}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {inc.archivedAt ? (
                      <Button size="sm" variant="outline" onClick={() => restore(inc)} loading={busyId === inc.id}>
                        <RotateCcw className="size-3" />
                        {t('restore')}
                      </Button>
                    ) : (
                      <>
                        {(inc.status === 'PENDING' || inc.status === 'REJECTED') && (
                          <Button size="sm" variant="default" onClick={() => approve(inc)} loading={busyId === inc.id}>
                            <CheckCircle2 className="size-3" />
                            {t('approve')}
                          </Button>
                        )}
                        {inc.status === 'PENDING' && (
                          <Button size="sm" variant="outline" onClick={() => setRejecting(inc)}>
                            <XCircle className="size-3" />
                            {t('reject')}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => openEdit(inc)}>
                          <Pencil className="size-3" />
                          {t('edit')}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                          onClick={() => setArchiving(inc)}>
                          <Archive className="size-3" />
                          {t('archive')}
                        </Button>
                      </>
                    )}
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
      <RejectDialog
        incubator={rejecting}
        onClose={() => setRejecting(null)}
        onRejected={handleSaved}
      />
      <ArchiveDialog
        incubator={archiving}
        onClose={() => setArchiving(null)}
        onArchived={handleSaved}
      />
    </div>
  );
}
