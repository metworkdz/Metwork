'use client';

/**
 * Admin — manage the Partner Program PER INCUBATOR.
 *
 * Add an incubator to the network (all its coworking/training/domiciliation
 * spaces become bookable by default, private offices off), tune settings, and
 * toggle individual spaces in/out via the expandable spaces panel.
 */

import { Fragment, useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Plus, Settings2, Trash2, CheckCircle2, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';

// ─── Types (mirror API response shapes) ─────────────────────────────────────

interface PartnerRecord {
  id: string;
  incubatorId: string;
  isActive: boolean;
  offerDiscountedMemberships: boolean;
  discountPercentage: number;
  maxDiscountedMembers: number | null;
  discountedMembersCount: number;
  acceptNetworkPasses: boolean;
  networkPayoutRate: number;
  maxNetworkUsersPerDay: number | null;
}

type SpaceCategory = 'COWORKING' | 'PRIVATE_OFFICE' | 'TRAINING_ROOM' | 'DOMICILIATION';

interface PartnerSpace {
  id: string;
  name: string;
  category: SpaceCategory;
  networkBookable: boolean;
  isPartnerInNetwork: boolean;
}

interface PartnerListItem {
  partner: PartnerRecord;
  incubatorId: string;
  incubatorName: string;
  spaces: PartnerSpace[];
}

interface IncubatorOption {
  id: string;
  name: string;
  city: string;
  status: string;
  archivedAt?: string | null;
}

// ─── Enroll dialog ───────────────────────────────────────────────────────────

function EnrollDialog({
  open, onClose, onEnrolled, enrolledIds,
}: {
  open: boolean;
  onClose: () => void;
  onEnrolled: () => void;
  enrolledIds: Set<string>;
}) {
  const t = useTranslations('admin.partnerManagement');
  const [incubators, setIncubators] = useState<IncubatorOption[]>([]);
  const [incubatorId, setIncubatorId] = useState('');
  const [acceptPasses, setAcceptPasses] = useState(true);
  const [payoutRate, setPayoutRate] = useState(300);
  const [offerDiscount, setOfferDiscount] = useState(false);
  const [discountPct, setDiscountPct] = useState(50);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setIncubatorId(''); setAcceptPasses(true); setPayoutRate(300);
    setOfferDiscount(false); setDiscountPct(50); setError('');
    fetch('/api/admin/incubators')
      .then((r) => r.json())
      .then((d) => setIncubators(Array.isArray(d.items) ? d.items : []))
      .catch(() => setIncubators([]));
  }, [open]);

  // Only approved, non-archived incubators that aren't already enrolled.
  const options = incubators.filter(
    (i) => i.status === 'ACTIVE' && !i.archivedAt && !enrolledIds.has(i.id),
  );

  async function handleSubmit() {
    if (!incubatorId) { setError(t('selectIncubatorError')); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incubatorId,
          acceptNetworkPasses: acceptPasses,
          networkPayoutRate: payoutRate,
          offerDiscountedMemberships: offerDiscount,
          discountPercentage: discountPct,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error?.message ?? t('enrolmentFailedError')); return; }
      onEnrolled();
      onClose();
    } catch {
      setError(t('networkError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('enrollDialogTitle')}</DialogTitle>
          <DialogDescription>{t('enrollDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ep-incubator">{t('incubatorLabel')}</Label>
            <select
              id="ep-incubator"
              value={incubatorId}
              onChange={(e) => setIncubatorId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('incubatorSelectPlaceholder')}</option>
              {options.map((i) => (
                <option key={i.id} value={i.id}>{i.name} — {i.city}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">{t('acceptPassesLabel')}</div>
              <div className="text-xs text-zinc-500">{t('acceptPassesDescription')}</div>
            </div>
            <input type="checkbox" checked={acceptPasses} onChange={(e) => setAcceptPasses(e.target.checked)} className="h-4 w-4 accent-green-700" />
          </div>

          {acceptPasses && (
            <div className="space-y-1.5">
              <Label htmlFor="ep-payout">{t('payoutRateLabel')}</Label>
              <Input id="ep-payout" type="number" min={0} value={payoutRate}
                onChange={(e) => setPayoutRate(Number(e.target.value))} />
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">{t('offerDiscountLabel')}</div>
              <div className="text-xs text-zinc-500">{t('offerDiscountDescription')}</div>
            </div>
            <input type="checkbox" checked={offerDiscount} onChange={(e) => setOfferDiscount(e.target.checked)} className="h-4 w-4 accent-green-700" />
          </div>

          {offerDiscount && (
            <div className="space-y-1.5">
              <Label htmlFor="ep-discount">{t('discountPercentLabel')}</Label>
              <Input id="ep-discount" type="number" min={1} max={99} value={discountPct}
                onChange={(e) => setDiscountPct(Number(e.target.value))} />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? t('enrolling') : t('enrollConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Settings dialog ─────────────────────────────────────────────────────────

function SettingsDialog({
  item, open, onClose, onSaved,
}: {
  item: PartnerListItem;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('admin.partnerManagement');
  const { partner } = item;
  const [isActive, setIsActive] = useState(partner.isActive);
  const [acceptPasses, setAcceptPasses] = useState(partner.acceptNetworkPasses);
  const [payoutRate, setPayoutRate] = useState(partner.networkPayoutRate);
  const [offerDiscount, setOfferDiscount] = useState(partner.offerDiscountedMemberships);
  const [discountPct, setDiscountPct] = useState(partner.discountPercentage);
  const [maxDaily, setMaxDaily] = useState<string>(partner.maxNetworkUsersPerDay?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/partners/${item.incubatorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive,
          acceptNetworkPasses: acceptPasses,
          networkPayoutRate: payoutRate,
          offerDiscountedMemberships: offerDiscount,
          discountPercentage: discountPct,
          maxNetworkUsersPerDay: maxDaily ? Number(maxDaily) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error?.message ?? t('updateFailed')); return; }
      onSaved();
      onClose();
    } catch {
      setError(t('networkError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('settingsDialogTitle', { name: item.incubatorName })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">{t('enrolmentActiveLabel')}</div>
              <div className="text-xs text-zinc-500">{t('enrolmentActiveDescription')}</div>
            </div>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 accent-green-700" />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="text-sm font-medium">{t('acceptPassesLabel')}</div>
            <input type="checkbox" checked={acceptPasses} onChange={(e) => setAcceptPasses(e.target.checked)} className="h-4 w-4 accent-green-700" />
          </div>

          {acceptPasses && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="st-payout">{t('payoutRateDzdLabel')}</Label>
                <Input id="st-payout" type="number" min={0} value={payoutRate}
                  onChange={(e) => setPayoutRate(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-max-daily">{t('maxDailyLabel')}</Label>
                <Input id="st-max-daily" type="number" min={1} value={maxDaily}
                  onChange={(e) => setMaxDaily(e.target.value)} placeholder={t('maxDailyPlaceholder')} />
              </div>
            </>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="text-sm font-medium">{t('offerDiscountLabel')}</div>
            <input type="checkbox" checked={offerDiscount} onChange={(e) => setOfferDiscount(e.target.checked)} className="h-4 w-4 accent-green-700" />
          </div>

          {offerDiscount && (
            <div className="space-y-1.5">
              <Label htmlFor="st-discount">{t('discountPercentLabel')}</Label>
              <Input id="st-discount" type="number" min={1} max={99} value={discountPct}
                onChange={(e) => setDiscountPct(Number(e.target.value))} />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('saving') : t('saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Spaces panel (per-space toggles) ────────────────────────────────────────

function SpacesPanel({
  item, onToggled,
}: {
  item: PartnerListItem;
  onToggled: (spaceId: string, networkBookable: boolean, isPartnerInNetwork: boolean) => void;
}) {
  const t = useTranslations('admin.partnerManagement');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggle(space: PartnerSpace) {
    setBusyId(space.id);
    try {
      const res = await fetch(`/api/admin/partners/${item.incubatorId}/space`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId: space.id, networkBookable: !space.networkBookable }),
      });
      if (!res.ok) return;
      const json = await res.json();
      onToggled(space.id, json.networkBookable, json.isPartnerInNetwork);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="border-t bg-zinc-50/60 px-4 py-3">
      <div className="mb-2">
        <div className="text-sm font-medium">{t('spacesTitle')}</div>
        <div className="text-xs text-zinc-500">{t('spacesDescription')}</div>
      </div>
      {item.spaces.length === 0 ? (
        <p className="py-2 text-sm text-zinc-500">{t('noSpaces')}</p>
      ) : (
        <ul className="divide-y rounded-md border bg-background">
          {item.spaces.map((space) => (
            <li key={space.id} className="flex items-center justify-between px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{space.name}</div>
                <div className="text-xs text-zinc-500">{t(`cat${space.category}` as 'catCOWORKING')}</div>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-green-700"
                  checked={space.networkBookable}
                  disabled={busyId === space.id}
                  onChange={() => toggle(space)}
                />
                {space.networkBookable ? t('yes') : t('no')}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function PartnerManagement() {
  const t = useTranslations('admin.partnerManagement');
  const [items, setItems] = useState<PartnerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnroll, setShowEnroll] = useState(false);
  const [editItem, setEditItem] = useState<PartnerListItem | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/partners');
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Only ACTIVE enrolments block re-adding; an unenrolled (inactive) incubator
  // can be re-added via the dialog (enrollIncubator reactivates it).
  const enrolledIds = new Set(items.filter((i) => i.partner.isActive).map((i) => i.incubatorId));

  async function handleUnenroll(item: PartnerListItem) {
    if (!confirm(t('unenrollConfirm', { name: item.incubatorName }))) return;
    await fetch(`/api/admin/partners/${item.incubatorId}`, { method: 'DELETE' });
    void load();
  }

  function handleSpaceToggled(incubatorId: string, spaceId: string, networkBookable: boolean, isPartnerInNetwork: boolean) {
    setItems((prev) => prev.map((it) =>
      it.incubatorId !== incubatorId ? it : {
        ...it,
        spaces: it.spaces.map((s) => (s.id === spaceId ? { ...s, networkBookable, isPartnerInNetwork } : s)),
      },
    ));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('title', { count: items.length })}</h2>
        <Button size="sm" onClick={() => setShowEnroll(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('enrollButton')}
        </Button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-zinc-500">{t('loading')}</div>
      ) : items.length === 0 ? (
        <InlineEmptyState
          icon={<Building2 className="h-8 w-8" />}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3">{t('colIncubator')}</th>
                  <th className="px-4 py-3">{t('colStatus')}</th>
                  <th className="px-4 py-3">{t('colNetworkPasses')}</th>
                  <th className="px-4 py-3">{t('colDiscounts')}</th>
                  <th className="px-4 py-3">{t('colPayoutRate')}</th>
                  <th className="px-4 py-3">{t('colSpaces')}</th>
                  <th className="px-4 py-3 text-right">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const bookableCount = item.spaces.filter((s) => s.networkBookable).length;
                  const expanded = expandedId === item.incubatorId;
                  return (
                    <Fragment key={item.partner.id}>
                      <tr className="border-b last:border-0 hover:bg-zinc-50">
                        <td className="px-4 py-3 font-medium">{item.incubatorName}</td>
                        <td className="px-4 py-3">
                          {item.partner.isActive ? (
                            <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                              <CheckCircle2 className="mr-1 h-3 w-3" /> {t('active')}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-500">
                              <XCircle className="mr-1 h-3 w-3" /> {t('inactive')}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.partner.acceptNetworkPasses ? (
                            <span className="text-green-700">{t('yes')}</span>
                          ) : (
                            <span className="text-zinc-400">{t('no')}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.partner.offerDiscountedMemberships ? (
                            <span className="text-green-700">{item.partner.discountPercentage}%</span>
                          ) : (
                            <span className="text-zinc-400">{t('no')}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {item.partner.networkPayoutRate.toLocaleString()} {t('dzdSuffix')}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : item.incubatorId)}
                            className="inline-flex items-center gap-1 text-zinc-600 hover:text-zinc-900"
                          >
                            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {bookableCount}/{item.spaces.length}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" size="icon" onClick={() => setEditItem(item)} aria-label={t('settings')}>
                              <Settings2 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600"
                              onClick={() => handleUnenroll(item)} aria-label={t('unenroll')}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={7} className="p-0">
                            <SpacesPanel
                              item={item}
                              onToggled={(spaceId, nb, ipn) => handleSpaceToggled(item.incubatorId, spaceId, nb, ipn)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <EnrollDialog
        open={showEnroll}
        onClose={() => setShowEnroll(false)}
        onEnrolled={load}
        enrolledIds={enrolledIds}
      />

      {editItem && (
        <SettingsDialog
          item={editItem}
          open={!!editItem}
          onClose={() => setEditItem(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
