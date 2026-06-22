'use client';

/**
 * Admin: review & approve/reject gated accounts (INCUBATOR / INVESTOR / BUSINESS).
 *
 * These roles sign up → confirm OTP → land PENDING with read-only access. This
 * manager lists pending + decided accounts across all three roles, shows their
 * details, and exposes Approve / Reject (with reason). It drives the unified
 * `/api/admin/accounts/:id/approval` endpoint, which keeps the read-only gate
 * and the legacy per-surface gates in sync.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Users, CheckCircle2, XCircle, Mail, Phone, Globe, Instagram, Linkedin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import type { ApprovalStatus, BusinessSubType } from '@/types/auth';

export type AdminAccountRole = 'INCUBATOR' | 'INVESTOR' | 'BUSINESS';

export interface AdminAccountView {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  role: AdminAccountRole;
  approvalStatus: ApprovalStatus;
  rejectionReason: string | null;
  createdAt: string;
  /** Provider / organisation name (INCUBATOR / BUSINESS). */
  orgName: string | null;
  businessSubType: BusinessSubType | null;
  website: string | null;
  instagram: string | null;
  linkedin: string | null;
}

type StatusFilter = ApprovalStatus | 'ALL';
type RoleFilter = AdminAccountRole | 'ALL';

export function AdminAccountApprovalsManager({ initial }: { initial: AdminAccountView[] }) {
  const t = useTranslations('admin.accountApprovals');
  const [accounts, setAccounts] = useState<AdminAccountView[]>(initial);
  const [status, setStatus] = useState<StatusFilter>('PENDING');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminAccountView | null>(null);

  function applyUpdate(updated: AdminAccountView) {
    setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  /** Map the safe-user PATCH response back onto the existing view row. */
  function mergeFromResponse(prev: AdminAccountView, raw: Record<string, unknown>): AdminAccountView {
    return {
      ...prev,
      approvalStatus: (raw.approvalStatus as ApprovalStatus) ?? prev.approvalStatus,
      rejectionReason: (raw.approvalRejectionReason as string | null) ?? null,
    };
  }

  async function approve(acc: AdminAccountView) {
    setBusyId(acc.id);
    try {
      const res = await fetch(`/api/admin/accounts/${acc.id}/approval`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'APPROVED' }),
      });
      if (!res.ok) throw new Error('approve failed');
      applyUpdate(mergeFromResponse(acc, await res.json() as Record<string, unknown>));
    } catch (err) {
      console.error('approve account failed', err);
    } finally {
      setBusyId(null);
    }
  }

  const countByStatus = (s: ApprovalStatus) => accounts.filter((a) => a.approvalStatus === s).length;

  const filtered = useMemo(
    () =>
      accounts.filter(
        (a) =>
          (status === 'ALL' || a.approvalStatus === status) &&
          (roleFilter === 'ALL' || a.role === roleFilter),
      ),
    [accounts, status, roleFilter],
  );

  const statusBadge = (s: ApprovalStatus) =>
    s === 'APPROVED' ? <Badge variant="success" className="text-xs">{t('statusApproved')}</Badge>
    : s === 'REJECTED' ? <Badge variant="danger" className="text-xs">{t('statusRejected')}</Badge>
    : <Badge variant="outline" className="text-xs">{t('statusPending')}</Badge>;

  const roleLabel = (a: AdminAccountView) => {
    if (a.role === 'INVESTOR') return t('roleInvestor');
    if (a.role === 'INCUBATOR') return t('roleIncubator');
    // BUSINESS — show the sub-type when known.
    if (a.businessSubType === 'TRAINER') return t('subTypeTrainer');
    if (a.businessSubType === 'TRAINING_CENTER') return t('subTypeTrainingCenter');
    if (a.businessSubType === 'COMPANY') return t('subTypeCompany');
    return t('roleBusiness');
  };

  return (
    <div className="space-y-4">
      {/* Status filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={status === 'PENDING' ? 'default' : 'outline'} onClick={() => setStatus('PENDING')}>
          {t('filterPending', { count: countByStatus('PENDING') })}
        </Button>
        <Button size="sm" variant={status === 'APPROVED' ? 'default' : 'outline'} onClick={() => setStatus('APPROVED')}>
          {t('filterApproved', { count: countByStatus('APPROVED') })}
        </Button>
        <Button size="sm" variant={status === 'REJECTED' ? 'default' : 'outline'} onClick={() => setStatus('REJECTED')}>
          {t('filterRejected', { count: countByStatus('REJECTED') })}
        </Button>
        <Button size="sm" variant={status === 'ALL' ? 'default' : 'outline'} onClick={() => setStatus('ALL')}>
          {t('filterAll', { count: accounts.length })}
        </Button>
      </div>

      {/* Role filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={roleFilter === 'ALL' ? 'default' : 'outline'} onClick={() => setRoleFilter('ALL')}>
          {t('roleAll')}
        </Button>
        <Button size="sm" variant={roleFilter === 'INCUBATOR' ? 'default' : 'outline'} onClick={() => setRoleFilter('INCUBATOR')}>
          {t('roleIncubator')}
        </Button>
        <Button size="sm" variant={roleFilter === 'INVESTOR' ? 'default' : 'outline'} onClick={() => setRoleFilter('INVESTOR')}>
          {t('roleInvestor')}
        </Button>
        <Button size="sm" variant={roleFilter === 'BUSINESS' ? 'default' : 'outline'} onClick={() => setRoleFilter('BUSINESS')}>
          {t('roleBusiness')}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <InlineEmptyState
              icon={<Users className="size-8" />}
              title={t('emptyTitle')}
              description={t('emptyDescription')}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((acc) => (
            <Card key={acc.id} className="border-border/60">
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground truncate">{acc.orgName || acc.fullName}</p>
                      <Badge variant="info" className="text-xs">{roleLabel(acc)}</Badge>
                      {statusBadge(acc.approvalStatus)}
                    </div>
                    {acc.orgName && acc.orgName !== acc.fullName && (
                      <p className="text-xs text-muted-foreground">{t('contactLabel')}: {acc.fullName}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" dir="ltr">
                      <span className="inline-flex items-center gap-1"><Mail className="size-3" /> {acc.email}</span>
                      {acc.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3" /> {acc.phone}</span>}
                      {acc.city && <span>· {acc.city}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs" dir="ltr">
                      {acc.website && (
                        <a href={acc.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          <Globe className="size-3" /> {acc.website}
                        </a>
                      )}
                      {acc.instagram && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground"><Instagram className="size-3" /> {acc.instagram}</span>
                      )}
                      {acc.linkedin && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground"><Linkedin className="size-3" /> {acc.linkedin}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground/70">
                      {t('registeredOn', { date: new Date(acc.createdAt).toLocaleDateString() })}
                    </p>
                    {acc.approvalStatus === 'REJECTED' && acc.rejectionReason && (
                      <p className="mt-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">
                        <span className="font-semibold">{t('rejectionReasonShown')}:</span> {acc.rejectionReason}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {acc.approvalStatus !== 'APPROVED' && (
                      <Button size="sm" variant="default" onClick={() => approve(acc)} loading={busyId === acc.id}>
                        <CheckCircle2 className="size-3" />
                        {t('approve')}
                      </Button>
                    )}
                    {acc.approvalStatus !== 'REJECTED' && (
                      <Button size="sm" variant="outline" onClick={() => setRejecting(acc)}>
                        <XCircle className="size-3" />
                        {t('reject')}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RejectDialog
        account={rejecting}
        onClose={() => setRejecting(null)}
        onRejected={applyUpdate}
        merge={mergeFromResponse}
      />
    </div>
  );
}

/* ─────────────────────────── Reject dialog ─────────────────────────── */

function RejectDialog({
  account, onClose, onRejected, merge,
}: {
  account: AdminAccountView | null;
  onClose: () => void;
  onRejected: (v: AdminAccountView) => void;
  merge: (prev: AdminAccountView, raw: Record<string, unknown>) => AdminAccountView;
}) {
  const t = useTranslations('admin.accountApprovals');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function submit() {
    if (!account || !reason.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/accounts/${account.id}/approval`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'REJECTED', reason: reason.trim() }),
      });
      if (!res.ok) throw new Error(t('actionFailed'));
      onRejected(merge(account, await res.json() as Record<string, unknown>));
      setReason('');
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('actionFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!account} onOpenChange={(o) => { if (!o) { setReason(''); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('rejectTitle', { name: account?.orgName || account?.fullName || '' })}</DialogTitle>
          <DialogDescription>{t('rejectDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="acct-reject-reason">{t('rejectReasonLabel')}</Label>
          <textarea
            id="acct-reject-reason"
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
