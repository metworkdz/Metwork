'use client';

/**
 * Admin: searchable users table with role + status filters and a row
 * action menu (suspend / reinstate / make admin). Action handlers are
 * stubbed pending the admin user-management API.
 */
import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { MoreVertical, Search, ShieldCheck, ShieldOff, Trash2, UserCog } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { AdminUserRow } from '@/lib/demo-data';

const ALL = 'all';

const roleVariant: Record<AdminUserRow['role'], React.ComponentProps<typeof Badge>['variant']> = {
  ENTREPRENEUR: 'primary',
  INVESTOR: 'info',
  INCUBATOR: 'warning',
  ADMIN: 'danger',
};

const statusVariant: Record<AdminUserRow['status'], React.ComponentProps<typeof Badge>['variant']> = {
  ACTIVE: 'success',
  PENDING_VERIFICATION: 'warning',
  SUSPENDED: 'danger',
  BANNED: 'danger',
};

const statusLabel: Record<AdminUserRow['status'], string> = {
  ACTIVE: 'Active',
  PENDING_VERIFICATION: 'Pending',
  SUSPENDED: 'Suspended',
  BANNED: 'Banned',
};

export function AdminUsersTable({ initial }: { initial: AdminUserRow[] }) {
  const locale = useLocale() as Locale;
  const [users, setUsers] = useState(initial);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<AdminUserRow['role'] | typeof ALL>(ALL);
  const [status, setStatus] = useState<AdminUserRow['status'] | typeof ALL>(ALL);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (role !== ALL && u.role !== role) return false;
      if (status !== ALL && u.status !== status) return false;
      if (!q) return true;
      return u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    });
  }, [users, query, role, status]);

  function setUserStatus(id: string, next: AdminUserRow['status']) {
    setUsers((us) => us.map((u) => (u.id === id ? { ...u, status: next } : u)));
  }

  return (
    <div className="space-y-4">
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
        <Select value={role} onValueChange={(v) => setRole(v as AdminUserRow['role'] | typeof ALL)}>
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
        <Select value={status} onValueChange={(v) => setStatus(v as AdminUserRow['status'] | typeof ALL)}>
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
                        <Badge variant={roleVariant[u.role]}>{u.role.toLowerCase()}</Badge>
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
                            <DropdownMenuItem onSelect={() => {}}>
                              <UserCog />
                              View profile
                            </DropdownMenuItem>
                            {u.status === 'ACTIVE' ? (
                              <DropdownMenuItem
                                onSelect={() => setUserStatus(u.id, 'SUSPENDED')}
                              >
                                <ShieldOff />
                                Suspend
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onSelect={() => setUserStatus(u.id, 'ACTIVE')}
                              >
                                <ShieldCheck />
                                Reinstate
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onSelect={() => setUserStatus(u.id, 'BANNED')}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 />
                              Ban
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
    </div>
  );
}
