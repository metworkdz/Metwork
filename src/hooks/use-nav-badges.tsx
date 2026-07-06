'use client';

/**
 * Nav activity badges — client state.
 *
 * SSR CONTRACT (no hydration mismatch): the provider is seeded with counts
 * computed SERVER-SIDE in the dashboard layout, so the server render and the
 * first client paint always agree. Revalidation (focus + 60s interval) only
 * runs in effects, after hydration.
 *
 * NON-BLOCKING: every fetch failure is swallowed — the last known counts (or
 * none) keep rendering; a broken badge feed can never crash the dashboard.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from '@/i18n/routing';
import { apiClient } from '@/lib/api-client';

export type NavBadgeMap = Record<string, number>;

interface NavBadgesContextValue {
  badges: NavBadgeMap;
}

/** Safe default — components outside the provider simply show no badges. */
const NavBadgesContext = createContext<NavBadgesContextValue>({ badges: {} });

const REVALIDATE_INTERVAL_MS = 60_000;

interface NavBadgesProviderProps {
  /** Server-computed initial counts (SSR seed — must match first paint). */
  initialBadges: NavBadgeMap;
  /** Nav keys registered for this role — routes that participate in mark-seen. */
  navKeys: string[];
  children: ReactNode;
}

export function NavBadgesProvider({ initialBadges, navKeys, children }: NavBadgesProviderProps) {
  const [badges, setBadges] = useState<NavBadgeMap>(initialBadges);
  const pathname = usePathname();
  // Keep navKeys in a ref: it's a fresh array each server render but its
  // contents are static per role — effects shouldn't re-run over identity.
  const navKeysRef = useRef(navKeys);
  navKeysRef.current = navKeys;

  const refresh = useCallback(async () => {
    try {
      const res = await apiClient.get<{ badges: NavBadgeMap }>('/nav-badges');
      setBadges(res.badges ?? {});
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

  // Auto mark-seen: when the route enters a registered nav surface, stamp the
  // per-user lastSeen (the feature's only write) then recompute counts —
  // "since last seen" badges drop to 0, status-based badges stay honest.
  useEffect(() => {
    const match = navKeysRef.current.find(
      (k) => pathname === k || pathname.startsWith(`${k}/`),
    );
    if (!match) return;
    void apiClient
      .post('/nav-badges', { navKey: match })
      .then(() => refresh())
      .catch(() => {
        // Non-critical — the badge just lingers until the next successful pass.
      });
  }, [pathname, refresh]);

  return <NavBadgesContext.Provider value={{ badges }}>{children}</NavBadgesContext.Provider>;
}

/** Read the current badge map. `{}` outside a provider — never throws. */
export function useNavBadges(): NavBadgesContextValue {
  return useContext(NavBadgesContext);
}
