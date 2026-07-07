'use client';

/**
 * Notification counts — client state over the P1 counts API
 * (`GET /api/notifications/counts`, `POST /api/notifications/seen`).
 *
 * SSR CONTRACT (no hydration mismatch): the provider is seeded with counts
 * computed SERVER-SIDE in the dashboard layout, so the server render and the
 * first client paint always agree. Revalidation only runs in effects, after
 * hydration.
 *
 * REVALIDATION: on window focus and on route change. An optional light
 * interval is available via `intervalMs` but is OFF by default.
 *
 * NON-BLOCKING: every fetch failure is swallowed — the last known counts (or
 * none) keep rendering; a broken count feed can never crash the dashboard.
 *
 * The engine speaks stable SOURCE KEYS ('approvals', 'users', …); the nav
 * components consume HREF-keyed badges. The provider receives the role's
 * `{ key, href, mode }` refs from the server and translates.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from '@/i18n/routing';
import { apiClient } from '@/lib/api-client';
import type { SourceMode } from '@/server/notifications/activity-sources';

export type NotificationCounts = Record<string, number>;

/** A role's registered source, as passed down by the dashboard layout. */
export interface BadgeSourceRef {
  key: string;
  href: string;
  mode: SourceMode;
}

interface NotificationCountsContextValue {
  /** Raw counts keyed by SOURCE KEY. */
  counts: NotificationCounts;
  /** Badge counts keyed by nav HREF (what the nav components consume). */
  badges: Record<string, number>;
  /**
   * Mark a source seen: optimistically zeroes a 'view' badge, then persists
   * via `POST /api/notifications/seen` and reconciles. Pending sources are
   * not zeroed (visiting the page doesn't resolve their actionable items).
   */
  markSeen: (key: string) => void;
}

/** Safe default — components outside the provider simply show no badges. */
const NotificationCountsContext = createContext<NotificationCountsContextValue>({
  counts: {},
  badges: {},
  markSeen: () => {},
});

interface NotificationCountsProviderProps {
  /** Server-computed initial counts, keyed by SOURCE KEY (SSR seed). */
  initialCounts: NotificationCounts;
  /** The role's registered sources (key ↔ nav href ↔ mode). */
  sources: BadgeSourceRef[];
  /** Optional background revalidation interval in ms. Omit/0 ⇒ OFF (default). */
  intervalMs?: number;
  children: ReactNode;
}

export function NotificationCountsProvider({
  initialCounts,
  sources,
  intervalMs = 0,
  children,
}: NotificationCountsProviderProps) {
  const [counts, setCounts] = useState<NotificationCounts>(initialCounts);
  const pathname = usePathname();
  // Keep sources in a ref: it's a fresh array each server render but its
  // contents are static per role — effects shouldn't re-run over identity.
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const refresh = useCallback(async () => {
    try {
      const res = await apiClient.get<{ counts: NotificationCounts }>('/notifications/counts');
      setCounts(res.counts ?? {});
    } catch {
      // Degrade gracefully — keep whatever we had.
    }
  }, []);

  const markSeen = useCallback(
    (key: string) => {
      const source = sourcesRef.current.find((s) => s.key === key);
      // Optimistically clear 'view' badges so the UI feels instant. 'pending'
      // sources are status-based — zeroing would flash a false 0, so skip.
      if (source?.mode === 'view') {
        setCounts((c) => ({ ...c, [key]: 0 }));
      }
      void apiClient
        .post('/notifications/seen', { key })
        .then(() => refresh())
        .catch(() => {
          // Non-critical — next successful refresh restores the truth.
        });
    },
    [refresh],
  );

  // Revalidate on window focus (+ optional light interval, default OFF).
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const id = intervalMs > 0 ? setInterval(() => void refresh(), intervalMs) : undefined;
    return () => {
      window.removeEventListener('focus', onFocus);
      if (id) clearInterval(id);
    };
  }, [refresh, intervalMs]);

  // Revalidate on route change. When the new route owns a source, mark it seen
  // (the feature's only write) so 'view' badges clear; otherwise just refresh.
  useEffect(() => {
    const match = sourcesRef.current.find(
      (s) => pathname === s.href || pathname.startsWith(`${s.href}/`),
    );
    if (match) markSeen(match.key);
    else void refresh();
  }, [pathname, markSeen, refresh]);

  // Translate source-keyed counts into href-keyed badges for the nav UI.
  const badges = useMemo(() => {
    const byHref: Record<string, number> = {};
    for (const s of sourcesRef.current) byHref[s.href] = counts[s.key] ?? 0;
    return byHref;
  }, [counts]);

  const value = useMemo(
    () => ({ counts, badges, markSeen }),
    [counts, badges, markSeen],
  );

  return (
    <NotificationCountsContext.Provider value={value}>
      {children}
    </NotificationCountsContext.Provider>
  );
}

/** Read notification counts + badges + markSeen. Safe defaults outside a provider. */
export function useNotificationCounts(): NotificationCountsContextValue {
  return useContext(NotificationCountsContext);
}
