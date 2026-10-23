/**
 * Venture vocabulary — client-safe so the form and the API validate against
 * the same lists. Labels live in next-intl under `venture.*`.
 */
import type { LegalStatus } from '@/types/legal-status';

export const VENTURE_KINDS = ['STARTUP', 'COMPANY', 'AUTO_ENTREPRENEUR', 'PROJECT', 'ASSOCIATION'] as const;
export const VENTURE_STAGES = ['IDEA', 'PROTOTYPE', 'LAUNCHED', 'GROWTH'] as const;
export const VENTURE_NEEDS = ['COFOUNDER', 'FREELANCER', 'INVESTORS', 'SPACE', 'MENTOR', 'ACCOUNTANT', 'INCUBATOR'] as const;

export type VentureKind = (typeof VENTURE_KINDS)[number];

/**
 * The legal status a venture type implies when the founder hasn't said more.
 * A startup may be registered or not, so it starts unregistered and the
 * founder picks; the others follow from the type itself.
 */
export function defaultLegalStatusFor(kind: VentureKind): LegalStatus {
  switch (kind) {
    case 'COMPANY': return 'COMPANY';
    case 'AUTO_ENTREPRENEUR': return 'AUTO_ENTREPRENEUR';
    case 'ASSOCIATION': return 'ASSOCIATION';
    case 'STARTUP':
    case 'PROJECT':
      return 'UNREGISTERED';
  }
}

/** URL slug: lowercase latin letters and digits, hyphen-separated. */
export function slugifyVentureName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'venture';
}
