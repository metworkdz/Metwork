'use client';

/**
 * Admin: view and assign membership plans to users.
 */
import { useState } from 'react';
import { CreditCard, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { membershipTiers } from '@/config/memberships';

export interface MembershipRow {
  userId:         string;
  fullName:       string;
  email:          string;
  role:           string;
  membershipCode: string | null;
  membershipId:   string | null;
  expiresAt:      string | null;
  membershipStatus: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | null;
}

const PLAN_VARIANT: Record<string, React.ComponentProps<typeof Badge>['variant']> = {
  FREE:         'default',
  ENTREPRENEUR: 'primary',
  STARTUP:      'success',
};

interface AssignDialogProps {
  user:    MembershipRow | null;
  onClose: () => void;
  onSaved: (row: MembershipRow) => void;
}

function AssignDialog({ user, onClose, onSaved }: AssignDialogProps) {
  // Pre-fill with the user's current plan, defaulting to ENTREPRENEUR
  const [plan,    setPlan]   = useState<string>(user?.membershipCode ?? 'ENTREPRENEUR');
  const [saving,  setSaving] = useState(false);
  const [error,   setError]  = useState<string | null>(null);

  async function submit() {
    if (!user) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/admin/memberships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: user.userId, plan, expiresAt: null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Failed to assign plan');
      }
      const data = await res.json() as { membership: { id: string; plan: string; expiresAt: string | null; status: 'ACTIVE' } };
      onSaved({
        ...user,
        membershipCode:   plan === 'FREE' ? null : plan,
        membershipId:     data.membership.id,
        expiresAt:        data.membership.expiresAt,
        membershipStatus: 'ACTIVE',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    if (!user?.membershipId) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/admin/memberships/${user.membershipId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) throw new Error('Revoke failed');
      onSaved({ ...user, membershipCode: null, membershipId: null, membershipStatus: null });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign membership</DialogTitle>
          <DialogDescription>{user?.fullName} — {user?.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Plan</Label>
            <Select value={plan} onValueChange={setPlan}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {membershipTiers.map((t) => (
                  <SelectItem key={t.code} value={t.code}>
                    {t.code} {t.priceMonthly > 0 ? `— ${t.priceMonthly.toLocaleString()} DZD/mo` : '— Free'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {user?.membershipId && (
            <Button variant="outline" loading={saving} onClick={revoke} className="sm:me-auto">
              Revoke plan
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button loading={saving} onClick={submit}>Assign plan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Main component ─────────────────────────── */

export function MembershipsManager({ initial }: { initial: MembershipRow[] }) {
  const [rows,    setRows]    = useState<MembershipRow[]>(initial);
  const [query,   setQuery]   = useState('');
  const [editing, setEditing] = useState<MembershipRow | null>(null);

  const filtered = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return r.fullName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q);
  });

  function onSaved(updated: MembershipRow) {
    setRows((prev) => prev.map((r) => r.userId === updated.userId ? updated : r));
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ps-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <InlineEmptyState
              title="No users found"
              description="Try adjusting your search."
              icon={<CreditCard className="size-5 text-muted-foreground" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Current plan</TableHead>
                    <TableHead className="hidden md:table-cell">Expires</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.userId}>
                      <TableCell>
                        <div className="font-medium">{row.fullName}</div>
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground capitalize">
                        {row.role.toLowerCase()}
                      </TableCell>
                      <TableCell>
                        {row.membershipCode ? (
                          <Badge variant={PLAN_VARIANT[row.membershipCode] ?? 'default'}>
                            {row.membershipCode}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {row.expiresAt
                          ? new Date(row.expiresAt).toLocaleDateString()
                          : row.membershipCode ? 'No expiry' : '—'}
                      </TableCell>
                      <TableCell className="text-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditing(row)}
                        >
                          {row.membershipCode ? 'Change plan' : 'Assign plan'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* key forces re-mount so plan state pre-fills correctly per user */}
      <AssignDialog
        key={editing?.userId ?? 'none'}
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={(u) => { onSaved(u); setEditing(null); }}
      />
    </div>
  );
}
