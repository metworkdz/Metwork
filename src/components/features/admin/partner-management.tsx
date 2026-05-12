'use client';

/**
 * Admin component — manage Partner Program enrolments.
 *
 * Shows a table of enrolled spaces, lets admin enroll new spaces,
 * toggle settings, and unenroll.
 */

import { useEffect, useState, useCallback } from 'react';
import { Building2, Plus, Settings2, Trash2, CheckCircle2, XCircle } from 'lucide-react';
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

// ─── Types (mirrors API response shapes) ────────────────────────────────────

interface PartnerRecord {
  id: string;
  spaceId: string;
  isActive: boolean;
  offerDiscountedMemberships: boolean;
  discountPercentage: number;
  maxDiscountedMembers: number | null;
  discountedMembersCount: number;
  acceptNetworkPasses: boolean;
  networkPayoutRate: number;
  maxNetworkUsersPerDay: number | null;
  createdAt: string;
  updatedAt: string;
}

interface PartnerListItem {
  partner: PartnerRecord;
  spaceName: string;
  incubatorName: string;
}

interface SpaceOption {
  id: string;
  name: string;
  incubatorName: string;
  city: string;
}

// ─── Enroll dialog ───────────────────────────────────────────────────────────

interface EnrollDialogProps {
  open: boolean;
  onClose: () => void;
  onEnrolled: () => void;
}

function EnrollDialog({ open, onClose, onEnrolled }: EnrollDialogProps) {
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [spaceId, setSpaceId] = useState('');
  const [acceptPasses, setAcceptPasses] = useState(true);
  const [payoutRate, setPayoutRate] = useState(300);
  const [offerDiscount, setOfferDiscount] = useState(false);
  const [discountPct, setDiscountPct] = useState(50);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    fetch('/api/admin/spaces')
      .then((r) => r.json())
      .then((d) => setSpaces(Array.isArray(d.items) ? d.items : []))
      .catch(() => setSpaces([]));
  }, [open]);

  async function handleSubmit() {
    if (!spaceId) { setError('Please select a space'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spaceId,
          acceptNetworkPasses: acceptPasses,
          networkPayoutRate: payoutRate,
          offerDiscountedMemberships: offerDiscount,
          discountPercentage: discountPct,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error?.message ?? 'Enrolment failed'); return; }
      onEnrolled();
      onClose();
    } catch {
      setError('Network error — please retry');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enroll a space</DialogTitle>
          <DialogDescription>
            Add a coworking space to the Metwork Partner Program.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ep-space">Space</Label>
            <select
              id="ep-space"
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select a space…</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.incubatorName}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Accept Network Passes</div>
              <div className="text-xs text-zinc-500">Allow Network Pass bookings at this space</div>
            </div>
            <input type="checkbox" checked={acceptPasses} onChange={(e) => setAcceptPasses(e.target.checked)} className="h-4 w-4 accent-green-700" />
          </div>

          {acceptPasses && (
            <div className="space-y-1.5">
              <Label htmlFor="ep-payout">Payout rate (DZD per visit)</Label>
              <Input
                id="ep-payout"
                type="number"
                min={0}
                value={payoutRate}
                onChange={(e) => setPayoutRate(Number(e.target.value))}
              />
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Offer discounted memberships</div>
              <div className="text-xs text-zinc-500">Enable generation of member promo codes</div>
            </div>
            <input type="checkbox" checked={offerDiscount} onChange={(e) => setOfferDiscount(e.target.checked)} className="h-4 w-4 accent-green-700" />
          </div>

          {offerDiscount && (
            <div className="space-y-1.5">
              <Label htmlFor="ep-discount">Discount percentage</Label>
              <Input
                id="ep-discount"
                type="number"
                min={1}
                max={99}
                value={discountPct}
                onChange={(e) => setDiscountPct(Number(e.target.value))}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Enrolling…' : 'Enroll space'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Settings dialog ─────────────────────────────────────────────────────────

interface SettingsDialogProps {
  item: PartnerListItem;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function SettingsDialog({ item, open, onClose, onSaved }: SettingsDialogProps) {
  const { partner } = item;
  const [isActive, setIsActive] = useState(partner.isActive);
  const [acceptPasses, setAcceptPasses] = useState(partner.acceptNetworkPasses);
  const [payoutRate, setPayoutRate] = useState(partner.networkPayoutRate);
  const [offerDiscount, setOfferDiscount] = useState(partner.offerDiscountedMemberships);
  const [discountPct, setDiscountPct] = useState(partner.discountPercentage);
  const [maxDaily, setMaxDaily] = useState<string>(
    partner.maxNetworkUsersPerDay?.toString() ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/partners/${partner.spaceId}`, {
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
      if (!res.ok) { setError(json.error?.message ?? 'Update failed'); return; }
      onSaved();
      onClose();
    } catch {
      setError('Network error — please retry');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Partner settings — {item.spaceName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Enrolment active</div>
              <div className="text-xs text-zinc-500">Pause without losing history</div>
            </div>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 accent-green-700" />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Accept Network Passes</div>
            </div>
            <input type="checkbox" checked={acceptPasses} onChange={(e) => setAcceptPasses(e.target.checked)} className="h-4 w-4 accent-green-700" />
          </div>

          {acceptPasses && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="st-payout">Payout rate (DZD / visit)</Label>
                <Input
                  id="st-payout"
                  type="number"
                  min={0}
                  value={payoutRate}
                  onChange={(e) => setPayoutRate(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-max-daily">Max network visitors / day (blank = unlimited)</Label>
                <Input
                  id="st-max-daily"
                  type="number"
                  min={1}
                  value={maxDaily}
                  onChange={(e) => setMaxDaily(e.target.value)}
                  placeholder="No limit"
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Offer discounted memberships</div>
            </div>
            <input type="checkbox" checked={offerDiscount} onChange={(e) => setOfferDiscount(e.target.checked)} className="h-4 w-4 accent-green-700" />
          </div>

          {offerDiscount && (
            <div className="space-y-1.5">
              <Label htmlFor="st-discount">Discount percentage</Label>
              <Input
                id="st-discount"
                type="number"
                min={1}
                max={99}
                value={discountPct}
                onChange={(e) => setDiscountPct(Number(e.target.value))}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function PartnerManagement() {
  const [items, setItems] = useState<PartnerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnroll, setShowEnroll] = useState(false);
  const [editItem, setEditItem] = useState<PartnerListItem | null>(null);

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

  async function handleUnenroll(item: PartnerListItem) {
    if (!confirm(`Unenroll "${item.spaceName}" from the Partner Program?`)) return;
    await fetch(`/api/admin/partners/${item.partner.spaceId}`, { method: 'DELETE' });
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Partner spaces ({items.length})</h2>
        <Button size="sm" onClick={() => setShowEnroll(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Enroll space
        </Button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-zinc-500">Loading…</div>
      ) : items.length === 0 ? (
        <InlineEmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="No partner spaces yet"
          description="Enroll a coworking space to get started."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3">Space</th>
                  <th className="px-4 py-3">Incubator</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Network passes</th>
                  <th className="px-4 py-3">Discounts</th>
                  <th className="px-4 py-3">Payout rate</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.partner.id} className="border-b last:border-0 hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium">{item.spaceName}</td>
                    <td className="px-4 py-3 text-zinc-500">{item.incubatorName}</td>
                    <td className="px-4 py-3">
                      {item.partner.isActive ? (
                        <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-500">
                          <XCircle className="mr-1 h-3 w-3" /> Inactive
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {item.partner.acceptNetworkPasses ? (
                        <span className="text-green-700">Yes</span>
                      ) : (
                        <span className="text-zinc-400">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {item.partner.offerDiscountedMemberships ? (
                        <span className="text-green-700">{item.partner.discountPercentage}% off</span>
                      ) : (
                        <span className="text-zinc-400">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {item.partner.networkPayoutRate.toLocaleString()} DZD
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditItem(item)}
                        >
                          <Settings2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-600"
                          onClick={() => handleUnenroll(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <EnrollDialog
        open={showEnroll}
        onClose={() => setShowEnroll(false)}
        onEnrolled={load}
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
