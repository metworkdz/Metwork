'use client';

/**
 * Admin: review & approve/reject investor accounts.
 *
 * Investors sign up → confirm OTP → land in PENDING_APPROVAL. This manager lists
 * pending + approved investors, shows their LinkedIn + details, and exposes
 * Approve / Reject (with reason). Off-platform contact is up to the admin.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Users, CheckCircle2, XCircle, Linkedin, Mail, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';

export interface AdminInvestorView {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  linkedin: string | null;
  investorStatus: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  investorRejectionReason: string | null;
  createdAt: string;
}

type Filter = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'ALL';

function linkedinHref(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = raw.replace(/^@/, '').replace(/^linkedin\.com\//i, '').trim();
  return `https://linkedin.com/${handle.startsWith('in/') ? handle : `in/${handle}`}`;
}

export function AdminInvestorsManager({ initial }: { initial: AdminInvestorView[] }) {
  const t = useTranslations('admin.investorsManager');
  const [investors, setInvestors] = useState<AdminInvestorView[]>(initial);
  const [filter, setFilter] = useState<Filter>('PENDING_APPROVAL');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminInvestorView | null>(null);

  function applyUpdate(updated: AdminInvestorView) {
    setInvestors((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }

  async function approve(inv: AdminInvestorView) {
    setBusyId(inv.id);
    try {
      const res = await fetch(`/api/admin/investors/${inv.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'APPROVED' }),
      });
      if (!res.ok) throw new Error('approve failed');
      applyUpdate(await res.json() as AdminInvestorView);
    } catch (err) {
      console.error('approve investor failed', err);
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount  = useMemo(() => investors.filter((i) => i.investorStatus === 'PENDING_APPROVAL').length, [investors]);
  const approvedCount = useMemo(() => investors.filter((i) => i.investorStatus === 'APPROVED').length, [investors]);
  const rejectedCount = useMemo(() => investors.filter((i) => i.investorStatus === 'REJECTED').length, [investors]);

  const filtered = useMemo(
    () => (filter === 'ALL' ? investors : investors.filter((i) => i.investorStatus === filter)),
    [investors, filter],
  );

  const statusBadge = (s: AdminInvestorView['investorStatus']) =>
    s === 'APPROVED' ? <Badge variant="success" className="text-xs">{t('statusApproved')}</Badge>
    : s === 'REJECTED' ? <Badge variant="danger" className="text-xs">{t('statusRejected')}</Badge>
    : <Badge variant="outline" className="text-xs">{t('statusPending')}</Badge>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={filter === 'PENDING_APPROVAL' ? 'default' : 'outline'} onClick={() => setFilter('PENDING_APPROVAL')}>
          {t('filterPending', { count: pendingCount })}
        </Button>
        <Button size="sm" variant={filter === 'APPROVED' ? 'default' : 'outline'} onClick={() => setFilter('APPROVED')}>
          {t('filterApproved', { count: approvedCount })}
        </Button>
        <Button size="sm" variant={filter === 'REJECTED' ? 'default' : 'outline'} onClick={() => setFilter('REJECTED')}>
          {t('filterRejected', { count: rejectedCount })}
        </Button>
        <Button size="sm" variant={filter === 'ALL' ? 'default' : 'outline'} onClick={() => setFilter('ALL')}>
          {t('filterAll', { count: investors.length })}
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
          {filtered.map((inv) => (
            <Card key={inv.id} className="border-border/60">
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground truncate">{inv.fullName}</p>
                      {statusBadge(inv.investorStatus)}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" dir="ltr">
                      <span className="inline-flex items-center gap-1"><Mail className="size-3" /> {inv.email}</span>
                      {inv.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3" /> {inv.phone}</span>}
                      {inv.city && <span>· {inv.city}</span>}
                    </div>
                    {inv.linkedin && (
                      <a href={linkedinHref(inv.linkedin)} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline" dir="ltr">
                        <Linkedin className="size-3" /> {inv.linkedin}
                      </a>
                    )}
                    <p className="text-xs text-muted-foreground/70">
                      {t('registeredOn', { date: new Date(inv.createdAt).toLocaleDateString() })}
                    </p>
                    {inv.investorStatus === 'REJECTED' && inv.investorRejectionReason && (
                      <p className="mt-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">
                        <span className="font-semibold">{t('rejectionReasonShown')}:</span> {inv.investorRejectionReason}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {inv.investorStatus !== 'APPROVED' && (
                      <Button size="sm" variant="default" onClick={() => approve(inv)} loading={busyId === inv.id}>
                        <CheckCircle2 className="size-3" />
                        {t('approve')}
                      </Button>
                    )}
                    {inv.investorStatus !== 'REJECTED' && (
                      <Button size="sm" variant="outline" onClick={() => setRejecting(inv)}>
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
        investor={rejecting}
        onClose={() => setRejecting(null)}
        onRejected={applyUpdate}
      />
    </div>
  );
}

/* ─────────────────────────── Reject dialog ─────────────────────────── */

function RejectDialog({
  investor, onClose, onRejected,
}: {
  investor: AdminInvestorView | null;
  onClose: () => void;
  onRejected: (v: AdminInvestorView) => void;
}) {
  const t = useTranslations('admin.investorsManager');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function submit() {
    if (!investor || !reason.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/investors/${investor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'REJECTED', reason: reason.trim() }),
      });
      if (!res.ok) throw new Error(t('actionFailed'));
      onRejected(await res.json() as AdminInvestorView);
      setReason('');
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('actionFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!investor} onOpenChange={(o) => { if (!o) { setReason(''); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('rejectTitle', { name: investor?.fullName ?? '' })}</DialogTitle>
          <DialogDescription>{t('rejectDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="inv-reject-reason">{t('rejectReasonLabel')}</Label>
          <textarea
            id="inv-reject-reason"
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
