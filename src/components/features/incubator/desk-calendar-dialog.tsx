'use client';

/**
 * Desk calendar for a single COWORKING space — a weekly grid (rows = desks,
 * columns = 7 days). Reads/writes the canonical desk endpoint
 * (`/api/incubator/spaces/:id/desks`); availability is computed server-side via
 * `src/server/spaces/availability.ts`, so this view can't disagree with the
 * booking gate.
 *
 * Click an AVAILABLE cell to block the desk for that day (offline block); click
 * a manual BLOCK to release it. Online bookings show as taken but aren't
 * editable here. Tailwind only — no calendar library.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Lock } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';

interface Cell {
  date: string;
  booked: boolean;
  bookingId: string | null;
  source: 'online' | 'offline' | null;
  clientName: string | null;
}
interface DeskRow { deskName: string; cells: Cell[] }
interface GridResponse { dates: string[]; deskNames: string[]; grid: DeskRow[] }

interface Props {
  space: { id: string; name: string; deskNames?: string[] };
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/** Local "YYYY-MM-DD" for today (calendar window start). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DeskCalendarDialog({ space, open, onOpenChange }: Props) {
  const t = useTranslations('incubator.deskCalendar');
  const locale = useLocale() as Locale;
  const intlLocale = locale === 'ar' ? 'ar' : locale === 'fr' ? 'fr' : 'en';

  const [from] = useState(todayIso());
  const [grid, setGrid] = useState<GridResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null); // `${desk}|${date}` being mutated

  const load = useCallback(
    (signal?: { cancelled: boolean }) =>
      fetch(`/api/incubator/spaces/${space.id}/desks?from=${from}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))))
        .then((data: GridResponse) => { if (!signal?.cancelled) setGrid(data); }),
    [space.id, from],
  );

  useEffect(() => {
    if (!open) return;
    const signal = { cancelled: false };
    setLoading(true);
    setError(null);
    void load(signal)
      .catch(() => { if (!signal.cancelled) setError(t('loadError')); })
      .finally(() => { if (!signal.cancelled) setLoading(false); });
    return () => { signal.cancelled = true; };
  }, [open, load, t]);

  // "Mon 23" style header from a YYYY-MM-DD string (parsed as UTC noon to dodge TZ shifts).
  const headerFor = useMemo(
    () => (date: string) => {
      const d = new Date(`${date}T12:00:00`);
      const wd = d.toLocaleDateString(intlLocale, { weekday: 'short' });
      return { wd, day: d.getDate() };
    },
    [intlLocale],
  );

  async function toggleCell(desk: string, cell: Cell) {
    // Online bookings aren't editable here.
    if (cell.booked && cell.source !== 'offline') return;
    const key = `${desk}|${cell.date}`;
    setPending(key);
    setError(null);
    try {
      const res = cell.booked
        ? await fetch(`/api/incubator/spaces/${space.id}/desks`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: cell.bookingId }),
          })
        : await fetch(`/api/incubator/spaces/${space.id}/desks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deskName: desk, date: cell.date }),
          });
      if (!res.ok) throw new Error('save');
      await load();
    } catch {
      setError(t('saveError'));
    } finally {
      setPending(null);
    }
  }

  const deskNames = grid?.deskNames ?? space.deskNames ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('title', { name: space.name })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="me-2 size-5 animate-spin" />
            {t('loading')}
          </div>
        ) : deskNames.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('noDesks')}</p>
        ) : (
          <div className="space-y-3 py-1">
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full bg-[#30a735]" />
                {t('legendAvailable')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-3" />
                {t('legendBooked')}
              </span>
            </div>

            {/* Horizontally scrollable grid */}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/40">
                    <th className="sticky start-0 z-10 bg-muted/40 px-3 py-2 text-start text-xs font-semibold text-muted-foreground">
                      {t('deskColumn')}
                    </th>
                    {(grid?.dates ?? []).map((date) => {
                      const h = headerFor(date);
                      return (
                        <th key={date} className="whitespace-nowrap px-2 py-2 text-center text-xs font-medium">
                          <span className="block capitalize text-muted-foreground">{h.wd}</span>
                          <span className="block tabular-nums">{h.day}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {(grid?.grid ?? []).map((row) => (
                    <tr key={row.deskName} className="border-t border-border">
                      <td className="sticky start-0 z-10 bg-background px-3 py-2 font-mono text-xs font-medium">
                        {row.deskName}
                      </td>
                      {row.cells.map((cell) => {
                        const key = `${row.deskName}|${cell.date}`;
                        const isPending = pending === key;
                        const editable = !cell.booked || cell.source === 'offline';
                        return (
                          <td key={cell.date} className="p-1 text-center">
                            <button
                              type="button"
                              disabled={isPending || !editable}
                              onClick={() => void toggleCell(row.deskName, cell)}
                              title={cell.clientName ?? undefined}
                              aria-label={cell.booked ? t('cellBooked') : t('cellAvailable')}
                              className={cn(
                                'flex h-9 w-full min-w-[40px] items-center justify-center rounded transition-colors',
                                cell.booked
                                  ? 'bg-gray-100 text-gray-400'
                                  : 'bg-[#30a735]/10 hover:bg-[#30a735]/20',
                                editable ? 'cursor-pointer' : 'cursor-not-allowed',
                              )}
                            >
                              {isPending ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : cell.booked ? (
                                <Lock className="size-3.5" />
                              ) : (
                                <span className="inline-block size-2 rounded-full bg-[#30a735]" />
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
