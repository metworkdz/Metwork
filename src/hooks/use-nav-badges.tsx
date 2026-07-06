'use client';

/**
 * Nav activity badges — client state over the notification-counts API.
 *
 * SSR CONTRACT (no hydration mismatch): the provider is seeded with counts
 * computed SERVER-SIDE in the dashboard layout, so the server render and the
 * first client paint always agree. Revalidation (focus + 60s interval) only
 * runs in effects, after hydration.
 *
 * NON-BLOCKING: every fetch failure is swallowed — the last known counts (or
 * none) keep rendering; a broken count feed can never crash the dashboard.
 *
 * The engine speaks stable SOURCE KEYS ('approvals', 'users', …); the nav
 * components consume HREF-keyed badges. The provider receives the role's
 * `{ key, href }` pairs from the server and translates.
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

export type NotificationCounts = Record<string, number>;

/** A role's registered source, as passed down by the dashboard layout. */
export interface BadgeSourceRef {
  key: string;
  href: string;
}

interface NavBadgesContextValue {
  /** Badge counts keyed by nav href (what the nav components consume). */
  badges: Record<string, number>;
}

/** Safe default — components outside the provider simply show no badges. */
const NavBadgesContext = createContext<NavBadgesContextValue>({ badges: {} });

const REVALIDATE_INTERVAL_MS = 60_000;

interface NavBadgesProviderProps {
  /** Server-computed initial counts, keyed by SOURCE KEY (SSR seed). */
  initialCounts: NotificationCounts;
  /** The role's registered sources (key ↔ nav href). */
  sources: BadgeSourceRef[];
  children: ReactNode;
}

export function NavBadgesProvider({ initialCounts, sources, children }: NavBadgesProviderProps) {
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

  // Revalidate on window focus and on a slow interval.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const id = setInterval(() => void refresh(), REVALIDATE_INTERVAL_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(id);
    };
  }, [refresh]);

  // Auto mark-seen: when the route enters a registered surface, stamp the
  // per-user seen state (the feature's only write) then recompute counts —
  // 'view' sources drop to 0, 'pending' sources stay honest.
  useEffect(() => {
    const match = sourcesRef.current.find(
      (s) => pathname === s.href || pathname.startsWith(`${s.href}/`),
    );
    if (!match) return;
    void apiClient
      .post('/notifications/seen', { key: match.key })
      .then(() => refresh())
      .catch(() => {
        // Non-critical — the badge just lingers until the next successful pass.
      });
  }, [pathname, refresh]);

  // Translate source-keyed counts into href-keyed badges for the nav UI.
  const badges = useMemo(() => {
    const byHref: Record<string, number> = {};
    for (const s of sources) byHref[s.href] = counts[s.key] ?? 0;
    return byHref;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sources is static per role
  }, [counts]);

  return <NavBadgesContext.Provider value={{ badges }}>{children}</NavBadgesContext.Provider>;
}

/** Read the current badge map (href-keyed). `{}` outside a provider. */
export function useNavBadges(): NavBadgesContextValue {
  return useContext(NavBadgesContext);
}
