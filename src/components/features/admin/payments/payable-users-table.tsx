'use client';

/**
 * Users tab — payable targets (users + mentors) with balance, masked payout
 * account, and row actions. Desktop table / mobile cards (Tailwind only). The
 * Send button is disabled when there is no bank account on file.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, Landmark, Send, Pencil, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { cn } from '@/lib/utils';
import { formatAmount, type PayableTarget } from './types';

interface PayableUsersTableProps {
  refreshKey: number;
  onEditBank: (t: PayableTarget) => void;
  onSendTransfer: (t: PayableTarget) => void;
}

export function PayableUsersTable({ refreshKey, onEditBank, onSendTransfer }: PayableUsersTableProps) {
  const t = useTranslations('admin.payments');
  const [rows, setRows] = useState<PayableTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/payouts/payable-users', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load payable users');
      const data = await res.json() as { items: PayableTarget[] };
      setRows(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const roles = useMemo(() => Array.from(new Set(rows.map((r) => r.role))).sort(), [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (q ? r.name.toLowerCase().includes(q) : true))
      .filter((r) => (role ? r.role === role : true));
  }, [rows, search, role]);

  if (loading) return <Card><CardContent className="h-40 animate-pulse" /></Card>;
  if (error) return <Card><CardContent className="p-6 text-sm text-destructive">{error}</CardContent></Card>;

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        {/* Search + filter */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-9 text-sm"
              placeholder={t('users.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
            <RolePill active={role === ''} onClick={() => setRole('')}>{t('users.allRoles')}</RolePill>
            {roles.map((r) => (
              <RolePill key={r} active={role === r} onClick={() => setRole(r)}>{r}</RolePill>
            ))}
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => load()} title={t('refresh')}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <InlineEmptyState
            title={t('users.emptyTitle')}
            description={t('users.emptyDescription')}
            icon={<Landmark className="size-5 text-muted-foreground" />}
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('users.colName')}</TableHead>
                    <TableHead>{t('users.colRole')}</TableHead>
                    <TableHead className="text-end">{t('users.colBalance')}</TableHead>
                    <TableHead>{t('users.colAccount')}</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={`${r.type}-${r.id}`}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{r.role}</Badge></TableCell>
                      <TableCell className="text-end font-medium tabular-nums">{formatAmount(r.balance)}</TableCell>
                      <TableCell><AccountPill row={r} t={t} /></TableCell>
                      <TableCell>
                        <RowActions row={r} onEditBank={onEditBank} onSendTransfer={onSendTransfer} t={t} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {filtered.map((r) => (
                <div key={`${r.type}-${r.id}`} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <Badge variant="outline" className="mt-1 text-[10px]">{r.role}</Badge>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{formatAmount(r.balance)}</p>
                  </div>
                  <div className="mt-3"><AccountPill row={r} t={t} /></div>
                  <div className="mt-3">
                    <RowActions row={r} onEditBank={onEditBank} onSendTransfer={onSendTransfer} t={t} stacked />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RolePill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1 text-xs transition',
        active ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-muted/50',
      )}
    >
      {children}
    </button>
  );
}

function AccountPill({ row, t }: { row: PayableTarget; t: ReturnType<typeof useTranslations> }) {
  if (!row.bankAccount) {
    return <Badge variant="warning" className="font-normal">{t('users.noAccount')}</Badge>;
  }
  return (
    <Badge variant="success" className="font-normal">
      {t('users.accountOnFile')} · <span className="ms-1 font-mono">{row.bankAccount.ribMasked}</span>
    </Badge>
  );
}

function RowActions({
  row, onEditBank, onSendTransfer, t, stacked,
}: {
  row: PayableTarget;
  onEditBank: (t: PayableTarget) => void;
  onSendTransfer: (t: PayableTarget) => void;
  t: ReturnType<typeof useTranslations>;
  stacked?: boolean;
}) {
  return (
    <div className={cn('flex gap-2', stacked && 'grid grid-cols-2')}>
      <Button variant="outline" size="sm" onClick={() => onEditBank(row)}>
        <Pencil className="size-3.5" /> {row.bankAccount ? t('users.editBank') : t('users.addBank')}
      </Button>
      <Button variant="default" size="sm" disabled={!row.bankAccount} onClick={() => onSendTransfer(row)}>
        <Send className="size-3.5" /> {t('users.send')}
      </Button>
    </div>
  );
}
