'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: string;
}

const POLL_INTERVAL_MS = 60_000;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

/**
 * The lazy sweep's only trigger: `GET /api/metworkcrm/notifications` both
 * generates new notifications (product spec §4.16, Prompt 7) and returns
 * them, so this poll IS the mechanism — see `services/notifications.ts`.
 */
export function NotificationBell() {
  const router = useRouter();
  const pathname = usePathname();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/metworkcrm/notifications');
      if (!res.ok) return;
      const data = (await res.json()) as { rows: NotificationRow[]; unreadCount: number };
      setRows(data.rows);
      setUnreadCount(data.unreadCount);
    } catch {
      // Silent — the bell just doesn't update this cycle, next poll retries.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function onRowClick(row: NotificationRow) {
    setOpen(false);
    if (!row.read) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, read: true } : r)));
      setUnreadCount((n) => Math.max(0, n - 1));
      fetch(`/api/metworkcrm/notifications/${row.id}`, { method: 'PATCH' }).catch(() => {});
    }
    if (row.href) router.push(row.href);
  }

  async function onMarkAllRead() {
    setRows((prev) => prev.map((r) => ({ ...r, read: true })));
    setUnreadCount(0);
    try {
      await fetch('/api/metworkcrm/notifications/read-all', { method: 'POST' });
    } catch {
      load();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex size-10 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-[var(--crm-black)]"
        aria-label="Notifications"
      >
        <Bell className="size-5" aria-hidden />
        {unreadCount > 0 ? (
          <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--crm-green)] text-[0.625rem] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-80 max-h-[70vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1.5 shadow-lg">
          <div className="flex items-center justify-between px-4 py-1.5">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-neutral-400">Notifications</p>
            {unreadCount > 0 ? (
              <button type="button" onClick={onMarkAllRead} className="text-xs font-medium text-[var(--crm-green)] hover:underline">
                Tout marquer comme lu
              </button>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-neutral-400">Aucune notification.</p>
          ) : (
            rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onRowClick(row)}
                className={cn(
                  'flex w-full items-start gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-neutral-50',
                  !row.read && 'bg-[var(--crm-green)]/[0.04]',
                )}
              >
                <span
                  className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', !row.read ? 'bg-[var(--crm-green)]' : 'bg-transparent')}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[var(--crm-black)]">{row.title}</span>
                  {row.body ? <span className="block truncate text-xs text-neutral-500">{row.body}</span> : null}
                  <span className="block text-[0.6875rem] text-neutral-400">{timeAgo(row.createdAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
