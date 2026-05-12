'use client';

/**
 * Admin component — generate and view partner promo codes.
 *
 * Supports:
 *   - Generate a single code for a specific email
 *   - Bulk generate codes (up to 10 000)
 *   - View existing codes (paginated, filterable by partner)
 *   - Copy code plaintext (only shown at generation time)
 */

import { useCallback, useEffect, useState } from 'react';
import { Copy, Download, KeyRound, Plus } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PromoCodeItem {
  id: string;
  partnerId: string;
  batchId: string | null;
  discountPercentage: number;
  membershipTier: 'BUILDER' | 'FOUNDER';
  validFrom: string;
  validUntil: string;
  isUsed: boolean;
  usedBy: string | null;
  usedAt: string | null;
  createdAt: string;
  createdFor: string;
}

interface PartnerOption {
  partnerId: string;
  spaceName: string;
}

// ─── Generate dialog ─────────────────────────────────────────────────────────

interface GenerateDialogProps {
  open: boolean;
  onClose: () => void;
  onGenerated: () => void;
}

function GenerateDialog({ open, onClose, onGenerated }: GenerateDialogProps) {
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [tier, setTier] = useState<'BUILDER' | 'FOUNDER'>('BUILDER');
  const [email, setEmail] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [isBulk, setIsBulk] = useState(false);
  const [bulkCount, setBulkCount] = useState(10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState<{ plaintext: string } | null>(null);
  const [bulkCodes, setBulkCodes] = useState<Array<{ plaintext: string; createdFor: string }> | null>(null);

  useEffect(() => {
    if (!open) { setGenerated(null); setBulkCodes(null); return; }
    fetch('/api/admin/partners')
      .then((r) => r.json())
      .then((d) => setPartners(
        Array.isArray(d.items)
          ? d.items.map((i: { partner: { id: string }; spaceName: string }) => ({
              partnerId: i.partner.id,
              spaceName: i.spaceName,
            }))
          : [],
      ))
      .catch(() => setPartners([]));
  }, [open]);

  async function handleGenerate() {
    if (!partnerId) { setError('Please select a partner'); return; }
    if (!isBulk && !email) { setError('Email is required'); return; }
    setSaving(true);
    setError('');

    if (isBulk) {
      try {
        const res = await fetch('/api/admin/partner-promo-codes/generate-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partnerId, membershipTier: tier, count: bulkCount }),
        });
        const json = await res.json();
        if (!res.ok) { setError(json.error?.message ?? 'Bulk generation failed'); return; }
        setBulkCodes(json.codes);
        onGenerated();
      } catch {
        setError('Network error — please retry');
      } finally {
        setSaving(false);
      }
    } else {
      try {
        const res = await fetch('/api/admin/partner-promo-codes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partnerId, membershipTier: tier, createdFor: email, sendEmail }),
        });
        const json = await res.json();
        if (!res.ok) { setError(json.error?.message ?? 'Generation failed'); return; }
        setGenerated({ plaintext: json.plaintext });
        onGenerated();
      } catch {
        setError('Network error — please retry');
      } finally {
        setSaving(false);
      }
    }
  }

  function downloadBulkCsv() {
    if (!bulkCodes) return;
    const csv = ['code,createdFor', ...bulkCodes.map((c) => `${c.plaintext},${c.createdFor}`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `partner-codes-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyCode(code: string) {
    void navigator.clipboard.writeText(code);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate promo code{isBulk ? 's' : ''}</DialogTitle>
          <DialogDescription>
            Create partner membership discount codes.
          </DialogDescription>
        </DialogHeader>

        {generated ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-zinc-600">
              Code generated! Copy it now — it cannot be retrieved from the database later.
            </p>
            <div className="flex items-center gap-2 rounded-lg border bg-zinc-50 px-4 py-3 font-mono text-lg font-bold tracking-widest text-zinc-900">
              {generated.plaintext}
              <Button variant="ghost" size="icon" className="ml-auto" onClick={() => copyCode(generated.plaintext)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <Button className="w-full" onClick={onClose}>Done</Button>
          </div>
        ) : bulkCodes ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-zinc-600">
              {bulkCodes.length} codes generated. Download the CSV now — codes cannot be retrieved later.
            </p>
            <Button className="w-full" onClick={downloadBulkCsv}>
              <Download className="mr-2 h-4 w-4" />
              Download CSV ({bulkCodes.length} codes)
            </Button>
            <Button variant="outline" className="w-full" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Partner space</Label>
                <Select value={partnerId} onValueChange={setPartnerId}>
                  <SelectTrigger><SelectValue placeholder="Select partner…" /></SelectTrigger>
                  <SelectContent>
                    {partners.map((p) => (
                      <SelectItem key={p.partnerId} value={p.partnerId}>{p.spaceName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Membership tier</Label>
                <Select value={tier} onValueChange={(v) => setTier(v as 'BUILDER' | 'FOUNDER')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUILDER">Builder</SelectItem>
                    <SelectItem value="FOUNDER">Founder</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="text-sm font-medium">Bulk generate</div>
                <input type="checkbox" checked={isBulk} onChange={(e) => setIsBulk(e.target.checked)} className="h-4 w-4 accent-green-700" />
              </div>

              {isBulk ? (
                <div className="space-y-1.5">
                  <Label htmlFor="gc-count">Number of codes</Label>
                  <Input
                    id="gc-count"
                    type="number"
                    min={1}
                    max={10000}
                    value={bulkCount}
                    onChange={(e) => setBulkCount(Number(e.target.value))}
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="gc-email">Recipient email</Label>
                    <Input
                      id="gc-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="user@example.com"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <div className="text-sm font-medium">Send by email</div>
                      <div className="text-xs text-zinc-500">Email the code to the recipient</div>
                    </div>
                    <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="h-4 w-4 accent-green-700" />
                  </div>
                </>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button onClick={handleGenerate} disabled={saving}>
                {saving ? 'Generating…' : isBulk ? `Generate ${bulkCount} codes` : 'Generate code'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function PromoCodeManager() {
  const [items, setItems] = useState<PromoCodeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [partnerFilter, setPartnerFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (partnerFilter) params.set('partnerId', partnerFilter);
      const res = await fetch(`/api/admin/partner-promo-codes?${params}`);
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(data.total ?? 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [page, partnerFilter]);

  useEffect(() => { void load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  function codeStatus(item: PromoCodeItem): { label: string; variant: 'outline' | 'default' } {
    if (item.isUsed) return { label: 'Used', variant: 'default' };
    if (item.validUntil < today) return { label: 'Expired', variant: 'default' };
    return { label: 'Active', variant: 'outline' };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Partner promo codes ({total})</h2>
        <Button size="sm" onClick={() => setShowGenerate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Generate code
        </Button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-zinc-500">Loading…</div>
      ) : items.length === 0 ? (
        <InlineEmptyState
          icon={<KeyRound className="h-8 w-8" />}
          title="No promo codes yet"
          description="Generate a code to get started."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3">Created for</th>
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3">Discount</th>
                  <th className="px-4 py-3">Valid until</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Used at</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const { label, variant } = codeStatus(item);
                  return (
                    <tr key={item.id} className="border-b last:border-0 hover:bg-zinc-50">
                      <td className="px-4 py-3 text-zinc-700">{item.createdFor || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">{item.membershipTier}</Badge>
                      </td>
                      <td className="px-4 py-3 text-green-700 font-medium">
                        {item.discountPercentage}% off
                      </td>
                      <td className="px-4 py-3 tabular-nums">{item.validUntil}</td>
                      <td className="px-4 py-3">
                        <Badge variant={variant}
                          className={label === 'Active' ? 'border-green-200 bg-green-50 text-green-700' : ''}
                        >
                          {label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {item.usedAt
                          ? new Date(item.usedAt).toLocaleDateString()
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {total > 50 && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <span className="text-sm text-zinc-500">
                  Showing {(page - 1) * 50 + 1}–{Math.min(page * 50, total)} of {total}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page * 50 >= total} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <GenerateDialog
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        onGenerated={load}
      />
    </div>
  );
}
