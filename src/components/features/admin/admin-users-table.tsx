'use client';

/**
 * Admin: live users table backed by the real DB.
 * Suspend / reinstate / ban / role-change / hard-delete all call
 * PATCH or DELETE /api/admin/users/[id] and update local state on success.
 */
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Download, MoreVertical, Search, ShieldCheck, ShieldOff, Trash2, UserCog, UserX } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { UserRole, UserStatus } from '@/types/auth';

export interface AdminUserView {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  role: UserRole;
  status: UserStatus;
  phoneVerified: boolean;
  emailVerified: boolean;
  membershipCode: string | null;
  membershipTier?: 'EXPLORER' | 'BUILDER' | 'FOUNDER';
  locale: string;
  createdAt: string;
  updatedAt: string;
}

const ALL = 'all';

const roleVariant: Record<UserRole, React.ComponentProps<typeof Badge>['variant']> = {
  ENTREPRENEUR: 'primary',
  INVESTOR:     'info',
  INCUBATOR:    'warning',
  ADMIN:        'danger',
};

const statusVariant: Record<UserStatus, React.ComponentProps<typeof Badge>['variant']> = {
  ACTIVE:                'success',
  PENDING_VERIFICATION:  'warning',
  SUSPENDED:             'danger',
  BANNED:                'danger',
};

const statusLabel: Record<UserStatus, string> = {
  ACTIVE:               'Active',
  PENDING_VERIFICATION: 'Pending',
  SUSPENDED:            'Suspended',
  BANNED:               'Banned',
};

async function patchUser(id: string, body: { role?: UserRole; status?: UserStatus }) {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? 'Update failed');
  }
  return (await res.json() as { user: AdminUserView }).user;
}

async function deleteUser(id: string): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? 'Delete failed');
  }
}

export function AdminUsersTable({ initial }: { initial: AdminUserView[] }) {
  const t = useTranslations('admin.users');
  const locale = useLocale() as Locale;
  const [users,       setUsers]       = useState(initial);
  const [query,       setQuery]       = useState('');
  const [role,        setRole]        = useState<UserRole | typeof ALL>(ALL);
  const [status,      setStatus]      = useState<UserStatus | typeof ALL>(ALL);
  const [tier,        setTier]        = useState<'EXPLORER' | 'BUILDER' | 'FOUNDER' | typeof ALL>(ALL);
  const [fromDate,    setFromDate]    = useState('');
  const [toDate,      setToDate]      = useState('');
  const [deletingUser, setDeletingUser] = useState<AdminUserView | null>(null);
  const [deletebusy,  setDeleteBusy]  = useState(false);
  const [deleteErr,   setDeleteErr]   = useState<string | null>(null);

  const fromMs = fromDate ? Date.parse(fromDate) : null;
  const toMs = useMemo(() => {
    if (!toDate) return null;
    const d = new Date(toDate);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }, [toDate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (role   !== ALL && u.role   !== role)   return false;
      if (status !== ALL && u.status !== status) return false;
      if (tier   !== ALL && (u.membershipTier ?? 'EXPLORER') !== tier) return false;
      const createdMs = Date.parse(u.createdAt);
      if (fromMs !== null && !Number.isNaN(fromMs) && createdMs < fromMs) return false;
      if (toMs !== null && createdMs > toMs) return false;
      if (!q) return true;
      return u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    });
  }, [users, query, role, status, tier, fromMs, toMs]);

  function buildExportUrl(format: 'csv' | 'xlsx'): string {
    const params = new URLSearchParams({ format });
    if (role   !== ALL) params.set('role', role);
    if (status !== ALL) params.set('status', status);
    if (tier   !== ALL) params.set('tier', tier);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    if (query.trim()) params.set('q', query.trim());
    return `/api/admin/users/export?${params.toString()}`;
  }

  function exportAs(format: 'csv' | 'xlsx') {
    window.location.assign(buildExportUrl(format));
  }

  async function applyPatch(id: string, patch: { role?: UserRole; status?: UserStatus }) {
    try {
      const updated = await patchUser(id, patch);
      setUsers((us) => us.map((u) => (u.id === id ? { ...u, ...updated } : u)));
    } catch {
      // silently ignore — in production you'd show a toast
    }
  }

  async function confirmDelete() {
    if (!deletingUser) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      await deleteUser(deletingUser.id);
      setUsers((us) => us.filter((u) => u.id !== deletingUser.id));
      setDeletingUser(null);
    } catch (err) {
      setDeleteErr(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-[1fr_auto_auto]">
        <div className="relative sm:col-span-2 md:col-span-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t('searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-9"
            aria-label="Search users"
          />
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as UserRole | typeof ALL)}>
          <SelectTrigger className="w-full md:w-[160px]">
            <SelectValue placeholder={t('roleFilter')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allRoles')}</SelectItem>
            <SelectItem value="ENTREPRENEUR">{t('entrepreneurs')}</SelectItem>
            <SelectItem value="INVESTOR">{t('investors')}</SelectItem>
            <SelectItem value="INCUBATOR">{t('incubators')}</SelectItem>
            <SelectItem value="ADMIN">{t('admins')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as UserStatus | typeof ALL)}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue placeholder={t('statusFilter')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            <SelectItem value="ACTIVE">{t('active')}</SelectItem>
            <SelectItem value="PENDING_VERIFICATION">{t('pending')}</SelectItem>
            <SelectItem value="SUSPENDED">{t('suspended')}</SelectItem>
            <SelectItem value="BANNED">{t('banned')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tier + date-range filters + export */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="users-tier" className="text-xs text-muted-foreground">{t('tierFilter')}</Label>
          <Select value={tier} onValueChange={(v) => setTier(v as 'EXPLORER' | 'BUILDER' | 'FOUNDER' | typeof ALL)}>
            <SelectTrigger id="users-tier" className="w-full sm:w-[150px]">
              <SelectValue placeholder={t('tierFilter')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allTiers')}</SelectItem>
              <SelectItem value="EXPLORER">{t('tierExplorer')}</SelectItem>
              <SelectItem value="BUILDER">{t('tierBuilder')}</SelectItem>
              <SelectItem value="FOUNDER">{t('tierFounder')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="users-from" className="text-xs text-muted-foreground">{t('fromDate')}</Label>
          <Input id="users-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full sm:w-[160px]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="users-to" className="text-xs text-muted-foreground">{t('toDate')}</Label>
          <Input id="users-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full sm:w-[160px]" />
        </div>
        <div className="ms-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportAs('csv')} disabled={filtered.length === 0}>
            <Download className="size-4" />
            {t('exportCsv')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportAs('xlsx')} disabled={filtered.length === 0}>
            <Download className="size-4" />
            {t('exportXlsx')}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} {t('of')} {users.length} {t('users')}
      </p>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <InlineEmptyState
              title={t('emptyTitle')}
              description={t('emptyDescription')}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colUser')}</TableHead>
                    <TableHead>{t('colRole')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('colCity')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('colPlan')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('colJoined')}</TableHead>
                    <TableHead className="w-12" aria-label={t('colActions')} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="font-medium">{u.fullName}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={roleVariant[u.role]}>
                          {u.role.charAt(0) + u.role.slice(1).toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[u.status]}>{statusLabel[u.status]}</Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm capitalize text-muted-foreground">
                        {u.city}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {u.membershipCode ?? '—'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(u.createdAt, locale)}
                      </TableCell>
                      <TableCell className="text-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Actions">
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled>
                              <UserCog />
                              {u.email}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {/* Role change */}
                            {u.role !== 'ADMIN' && (
                              <DropdownMenuItem onSelect={() => applyPatch(u.id, { role: 'ADMIN' })}>
                                {t('promoteToAdmin')}
                              </DropdownMenuItem>
                            )}
                            {u.role === 'ADMIN' && (
                              <DropdownMenuItem onSelect={() => applyPatch(u.id, { role: 'ENTREPRENEUR' })}>
                                {t('demoteToEntrepreneur')}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {/* Status change */}
                            {u.status === 'ACTIVE' ? (
                              <DropdownMenuItem onSelect={() => applyPatch(u.id, { status: 'SUSPENDED' })}>
                                <ShieldOff />
                                {t('suspend')}
                              </DropdownMenuItem>
                            ) : u.status === 'SUSPENDED' ? (
                              <DropdownMenuItem onSelect={() => applyPatch(u.id, { status: 'ACTIVE' })}>
                                <ShieldCheck />
                                {t('reinstate')}
                              </DropdownMenuItem>
                            ) : null}
                            {u.status !== 'BANNED' && (
                              <DropdownMenuItem
                                onSelect={() => applyPatch(u.id, { status: 'BANNED' })}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 />
                                {t('ban')}
                              </DropdownMenuItem>
                            )}
                            {u.status === 'BANNED' && (
                              <DropdownMenuItem onSelect={() => applyPatch(u.id, { status: 'ACTIVE' })}>
                                <ShieldCheck />
                                {t('unban')}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => { setDeletingUser(u); setDeleteErr(null); }}
                              className="text-destructive focus:text-destructive"
                            >
                              <UserX />
                              {t('deleteAccount')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hard-delete confirmation dialog */}
      <Dialog
        open={deletingUser !== null}
        onOpenChange={(o) => { if (!o) { setDeletingUser(null); setDeleteErr(null); } }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteDialogTitle')}</DialogTitle>
            <DialogDescription>
              {deletingUser && (
                <>
                  {t('deleteDialogDescription', { name: deletingUser.fullName })}
                  {' '}(<span className="font-mono text-xs">{deletingUser.email}</span>)
                  <br /><br />
                  {t('deleteDialogNote')}
                  <strong className="block mt-2 text-destructive">{t('deleteDialogWarning')}</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {deleteErr && (
            <p className="text-xs text-destructive">{deleteErr}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingUser(null)} disabled={deletebusy}>
              {t('deleteCancel')}
            </Button>
            <Button variant="destructive" loading={deletebusy} onClick={confirmDelete}>
              {t('deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
