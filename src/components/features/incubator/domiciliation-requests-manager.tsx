'use client';

/**
 * Incubator domiciliation requests — table of address-slot enquiries with an
 * inline status workflow (PENDING → CONTACTED → ACTIVE → REJECTED).
 * Reads `/api/incubator/domiciliation`, updates via PATCH on each row.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Inbox, Loader2 } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type Status = 'PENDING' | 'CONTACTED' | 'ACTIVE' | 'REJECTED';

interface DomiciliationRequest {
  id: string;
  spaceId: string;
  fullName: string;
  companyName: string | null;
  phone: string;
  email: string;
  message: string | null;
  status: Status;
  createdAt: string;
}

const STATUSES: Status[] = ['PENDING', 'CONTACTED', 'ACTIVE', 'REJECTED'];

const badgeClass: Record<Status, string> = {
  PENDING:   'bg-amber-100 text-amber-700',
  CONTACTED: 'bg-blue-100 text-blue-700',
  ACTIVE:    'bg-[#30a735]/10 text-[#30a735]',
  REJECTED:  'bg-red-100 text-red-700',
};

export function DomiciliationRequestsManager() {
  const t = useTranslations('incubator.domiciliation');
  const [rows, setRows] = useState<DomiciliationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function fetchRows() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/incubator/domiciliation', { cache: 'no-store' });
      if (!res.ok) throw new Error('load');
      const data = await res.json() as { items: DomiciliationRequest[] };
      setRows(data.items);
    } catch {
      setError(t('loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchRows(); }, []);

  async function updateStatus(id: string, status: Status) {
    const prev = rows;
    setSavingId(id);
    setRows((r) => r.map((x) => (x.id === id ? { ...x, status } : x))); // optimistic
    try {
      const res = await fetch(`/api/incubator/domiciliation/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('save');
    } catch {
      setRows(prev); // rollback
      setError(t('saveError'));
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="me-2 size-5 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  if (error && rows.length === 0) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-12 text-center">
        <Inbox className="size-6 text-muted-foreground/50" />
        <p className="text-sm font-medium">{t('emptyTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('emptyDescription')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-start text-xs font-semibold text-muted-foreground">
              <th className="px-4 py-3 text-start">{t('colName')}</th>
              <th className="px-4 py-3 text-start">{t('colCompany')}</th>
              <th className="px-4 py-3 text-start">{t('colPhone')}</th>
              <th className="px-4 py-3 text-start">{t('colEmail')}</th>
              <th className="px-4 py-3 text-start">{t('colDate')}</th>
              <th className="px-4 py-3 text-start">{t('colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium">{r.fullName}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.companyName || '—'}</td>
                <td className="px-4 py-3 tabular-nums">{r.phone}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.email}</td>
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">
                  {r.createdAt.slice(0, 10)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', badgeClass[r.status])}>
                      {t(`status.${r.status}`)}
                    </span>
                    <Select
                      value={r.status}
                      onValueChange={(v) => void updateStatus(r.id, v as Status)}
                      disabled={savingId === r.id}
                    >
                      <SelectTrigger className="h-8 w-[140px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">{t(`status.${s}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
