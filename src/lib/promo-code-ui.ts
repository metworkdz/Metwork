/**
 * Client-safe helpers for the promo-code screens (admin + incubator).
 * Nothing here touches the store — it only reads shapes the API already returned.
 */

/** The slice of a promo code the incubator screens render. */
export interface ScopedPromoCode {
  id: string;
  code: string;
  discountPercent: number;
  usedCount: number;
  usageLimit: number | null;
  expiresAt: string | null;
  isActive: boolean;
  scope?: { programIds: string[]; spaceIds: string[] } | null;
}

export type PromoStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'LIMIT_REACHED';

/** One definition of "is this code live", shared by every screen that shows a badge. */
export function promoStatus(
  p: Pick<ScopedPromoCode, 'isActive' | 'expiresAt' | 'usageLimit' | 'usedCount'>,
  now: number = Date.now(),
): PromoStatus {
  if (!p.isActive) return 'INACTIVE';
  if (p.expiresAt && Date.parse(p.expiresAt) <= now) return 'EXPIRED';
  if (p.usageLimit !== null && p.usedCount >= p.usageLimit) return 'LIMIT_REACHED';
  return 'ACTIVE';
}

/** ISO instant → the local `YYYY-MM-DDTHH:mm` a datetime-local input expects. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Same rule the API enforces; checked client-side only to spare a round trip. */
export const PROMO_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/i;

/** Trim a stored record to what the screens render — no legacy mirrored fields, no owner id. */
export function toScopedPromoCode(r: {
  id: string; code: string; discountPercent: number; usedCount: number; usageLimit: number | null;
  expiresAt: string | null; isActive: boolean; scope?: ScopedPromoCode['scope'];
}): ScopedPromoCode {
  return {
    id: r.id,
    code: r.code,
    discountPercent: r.discountPercent,
    usedCount: r.usedCount ?? 0,
    usageLimit: r.usageLimit ?? null,
    expiresAt: r.expiresAt ?? null,
    isActive: r.isActive,
    scope: r.scope ?? null,
  };
}
