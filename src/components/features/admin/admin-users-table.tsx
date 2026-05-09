'use client';

/**
 * Admin: live users table backed by the real DB.
 * Suspend / reinstate / ban / role-change / hard-delete all call
 * PATCH or DELETE /api/admin/users/[id] and update local state on success.
 */
import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { MoreVertical, Search, ShieldCheck, ShieldOff, Trash2, UserCog, UserX } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
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
  const locale = useLocale() as Locale;
  const [users,       setUsers]       = useState(initial);
  const [query,       setQuery]       = useState('');
  const [role,        setRole]        = useState<UserRole | typeof ALL>(ALL);
  const [status,      setStatus]      = useState<UserStatus | typeof ALL>(ALL);
  const [deletingUser, setDeletingUser] = useState<AdminUserView | null>(null);
  const [deletebusy,  setDeleteBusy]  = useState(false);
  const [deleteErr,   setDeleteErr]   = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (role   !== ALL && u.role   !== role)   return false;
      if (status !== ALL && u.status !== status) return false;
      if (!q) return true;
      return u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    });
  }, [users, query, role, status]);

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
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-9"
            aria-label="Search users"
          />
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as UserRole | typeof ALL)}>
          <SelectTrigger className="w-full md:w-[160px]">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All roles</SelectItem>
            <SelectItem value="ENTREPRENEUR">Entrepreneurs</SelectItem>
            <SelectItem value="INVESTOR">Investors</SelectItem>
            <SelectItem value="INCUBATOR">Incubators</SelectItem>
            <SelectItem value="ADMIN">Admins</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as UserStatus | typeof ALL)}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="PENDING_VERIFICATION">Pending verification</SelectItem>
            <SelectItem value="SUSPENDED">Suspended</SelectItem>
            <SelectItem value="BANNED">Banned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} of {users.length} users
      </p>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <InlineEmptyState
              title="No users match"
              description="Try clearing the search or changing the role / status filters."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">City</TableHead>
                    <TableHead className="hidden md:table-cell">Plan</TableHead>
                    <TableHead className="hidden lg:table-cell">Joined</TableHead>
                    <TableHead className="w-12" aria-label="Actions" />
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
                                Promote to admin
                              </DropdownMenuItem>
                            )}
                            {u.role === 'ADMIN' && (
                              <DropdownMenuItem onSelect={() => applyPatch(u.id, { role: 'ENTREPRENEUR' })}>
                                Demote to entrepreneur
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {/* Status change */}
                            {u.status === 'ACTIVE' ? (
                              <DropdownMenuItem onSelect={() => applyPatch(u.id, { status: 'SUSPENDED' })}>
                                <ShieldOff />
                                Suspend
                              </DropdownMenuItem>
                            ) : u.status === 'SUSPENDED' ? (
                              <DropdownMenuItem onSelect={() => applyPatch(u.id, { status: 'ACTIVE' })}>
                                <ShieldCheck />
                                Reinstate
                              </DropdownMenuItem>
                            ) : null}
                            {u.status !== 'BANNED' && (
                              <DropdownMenuItem
                                onSelect={() => applyPatch(u.id, { status: 'BANNED' })}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 />
                                Ban user
                              </DropdownMenuItem>
                            )}
                            {u.status === 'BANNED' && (
                              <DropdownMenuItem onSelect={() => applyPatch(u.id, { status: 'ACTIVE' })}>
                                <ShieldCheck />
                                Unban
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => { setDeletingUser(u); setDeleteErr(null); }}
                              className="text-destructive focus:text-destructive"
                            >
                              <UserX />
                              Delete account
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
            <DialogTitle>Delete account permanently?</DialogTitle>
            <DialogDescription>
              {deletingUser && (
                <>
                  This will permanently delete <span className="font-medium">{deletingUser.fullName}</span>{' '}
                  (<span className="font-mono text-xs">{deletingUser.email}</span>) and all their data —
                  bookings, wallet, sessions, and memberships.
                  <br /><br />
                  They will be able to create a new account with the same email or phone.
                  <strong className="block mt-2 text-destructive">This cannot be undone.</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {deleteErr && (
            <p className="text-xs text-destructive">{deleteErr}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingUser(null)} disabled={deletebusy}>
              Cancel
            </Button>
            <Button variant="destructive" loading={deletebusy} onClick={confirmDelete}>
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
