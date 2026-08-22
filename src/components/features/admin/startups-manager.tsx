'use client';

/**
 * Admin: all registered startup listings (every status, DRAFT included),
 * backed by the real DB. View opens a detail dialog (fresh fetch of full
 * detail, including founder contact + pitch deck); Delete is a hard delete
 * behind a typed-name confirmation, mirroring admin-users-table.tsx.
 */
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Eye, FileText, Globe, MoreVertical, Search, Trash2 } from 'lucide-react';
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
  DropdownMenuTrigger,
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
import { StartupLogo } from '@/components/shared/startup-logo';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { StartupListing, StartupMaturityStage } from '@/types/startup';

export interface AdminStartupView extends StartupListing {
  founderName: string | null;
  founderEmail: string | null;
}

interface AdminStartupDetail extends AdminStartupView {
  founderPhone: string | null;
}

const ALL = 'all';
type StatusFilter = StartupListing['status'] | typeof ALL;

const statusVariant: Record<StartupListing['status'], React.ComponentProps<typeof Badge>['variant']> = {
  DRAFT: 'default',
  ACTIVE: 'success',
  CLOSED: 'warning',
};

async function fetchDetail(id: string): Promise<AdminStartupDetail> {
  const res = await fetch(`/api/admin/startups/${id}`, { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? 'Failed to load startup');
  }
  return (await res.json() as { startup: AdminStartupDetail }).startup;
}

async function deleteStartup(id: string): Promise<void> {
  const res = await fetch(`/api/admin/startups/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? 'Delete failed');
  }
}

export function AdminStartupsManager({ initial }: { initial: AdminStartupView[] }) {
  const t = useTranslations('admin.startupsManager');
  const tStage = useTranslations('startup.profileForm');
  const locale = useLocale() as Locale;
  const [startups, setStartups] = useState(initial);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>(ALL);

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminStartupDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [deletingStartup, setDeletingStartup] = useState<AdminStartupView | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return startups.filter((s) => {
      if (status !== ALL && s.status !== status) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.industry.toLowerCase().includes(q) ||
        (s.founderName ?? '').toLowerCase().includes(q) ||
        (s.founderEmail ?? '').toLowerCase().includes(q)
      );
    });
  }, [startups, query, status]);

  function openView(id: string) {
    setViewingId(id);
    setDetail(null);
    setDetailErr(null);
    setDetailLoading(true);
    fetchDetail(id)
      .then((d) => setDetail(d))
      .catch((err) => setDetailErr(err instanceof Error ? err.message : 'Failed to load startup'))
      .finally(() => setDetailLoading(false));
  }

  async function confirmDelete() {
    if (!deletingStartup) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      await deleteStartup(deletingStartup.id);
      setStartups((list) => list.filter((s) => s.id !== deletingStartup.id));
      setDeletingStartup(null);
    } catch (err) {
      setDeleteErr(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t('searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-9"
            aria-label={t('searchPlaceholder')}
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue placeholder={t('statusFilter')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            <SelectItem value="DRAFT">{t('statusDraft')}</SelectItem>
            <SelectItem value="ACTIVE">{t('statusActive')}</SelectItem>
            <SelectItem value="CLOSED">{t('statusClosed')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} {t('of')} {startups.length} {t('startups')}
      </p>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <InlineEmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colStartup')}</TableHead>
                    <TableHead>{t('colFounder')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('colIndustry')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('colFundingGoal')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('colCreated')}</TableHead>
                    <TableHead className="w-12" aria-label={t('colActions')} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <StartupLogo logoUrl={s.logoUrl} name={s.name} size={32} />
                          <div className="font-medium">{s.name}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{s.founderName ?? '—'}</div>
                        <div className="text-xs text-muted-foreground">{s.founderEmail ?? '—'}</div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {s.industry}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm tabular-nums text-muted-foreground">
                        {formatCurrency(s.fundingGoal, locale)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[s.status]}>
                          {t(`status${s.status.charAt(0)}${s.status.slice(1).toLowerCase()}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(s.createdAt, locale)}
                      </TableCell>
                      <TableCell className="text-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={t('colActions')}>
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openView(s.id)}>
                              <Eye />
                              {t('view')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => { setDeletingStartup(s); setDeleteErr(null); }}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 />
                              {t('delete')}
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

      {/* View detail dialog */}
      <Dialog open={viewingId !== null} onOpenChange={(o) => { if (!o) setViewingId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail?.name ?? t('viewTitle')}</DialogTitle>
          </DialogHeader>
          {detailLoading && <p className="text-sm text-muted-foreground">{t('loading')}</p>}
          {detailErr && <p className="text-sm text-destructive">{detailErr}</p>}
          {detail && !detailLoading && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-3">
                <StartupLogo logoUrl={detail.logoUrl} name={detail.name} size={48} />
                <div>
                  <div className="font-medium">{detail.name}</div>
                  <Badge variant={statusVariant[detail.status]} className="mt-1">
                    {t(`status${detail.status.charAt(0)}${detail.status.slice(1).toLowerCase()}`)}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
                <div>
                  <p className="text-xs text-muted-foreground">{t('colFounder')}</p>
                  <p className="mt-0.5 font-medium">{detail.founderName ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">{detail.founderEmail ?? '—'}</p>
                  {detail.founderPhone && (
                    <p className="text-xs text-muted-foreground">{detail.founderPhone}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('colIndustry')}</p>
                  <p className="mt-0.5 font-medium">{detail.industry}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('colFundingGoal')}</p>
                  <p className="mt-0.5 font-medium tabular-nums">{formatCurrency(detail.fundingGoal, locale)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('equityOffered')}</p>
                  <p className="mt-0.5 font-medium">{detail.equityOffered}%</p>
                </div>
                {detail.valuation != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t('valuation')}</p>
                    <p className="mt-0.5 font-medium tabular-nums">{formatCurrency(detail.valuation, locale)}</p>
                  </div>
                )}
                {detail.maturityStage && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t('maturityStage')}</p>
                    <p className="mt-0.5 font-medium">
                      {tStage(`stage${detail.maturityStage as StartupMaturityStage}`)}
                    </p>
                  </div>
                )}
              </div>

              <div className="border-t border-border/60 pt-3">
                <p className="text-xs text-muted-foreground">{t('description')}</p>
                <p className="mt-1 whitespace-pre-line">{detail.description}</p>
              </div>

              {(detail.pitchDeckUrl || detail.websiteUrl) && (
                <div className="flex flex-wrap gap-3 border-t border-border/60 pt-3">
                  {detail.pitchDeckUrl && (
                    <a
                      href={detail.pitchDeckUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      <FileText className="size-3.5" />
                      {t('viewPitchDeck')}
                    </a>
                  )}
                  {detail.websiteUrl && (
                    <a
                      href={detail.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      <Globe className="size-3.5" />
                      {detail.websiteUrl.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Hard-delete confirmation dialog */}
      <Dialog
        open={deletingStartup !== null}
        onOpenChange={(o) => { if (!o) { setDeletingStartup(null); setDeleteErr(null); } }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteDialogTitle')}</DialogTitle>
            <DialogDescription>
              {deletingStartup && (
                <>
                  {t('deleteDialogDescription', { name: deletingStartup.name })}
                  <br /><br />
                  {t('deleteDialogNote')}
                  <strong className="block mt-2 text-destructive">{t('deleteDialogWarning')}</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {deleteErr && <p className="text-xs text-destructive">{deleteErr}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingStartup(null)} disabled={deleteBusy}>
              {t('deleteCancel')}
            </Button>
            <Button variant="destructive" loading={deleteBusy} onClick={confirmDelete}>
              {t('deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
