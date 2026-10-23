import type { SignupRole } from '@/types/auth';

/**
 * Audience signup pages (/join/<slug>) — the URL slug for each self-signup
 * role. One shared `SignupForm` engine renders every page; only the role and
 * the copy differ. Consultants keep their own portal signup.
 */
export const JOIN_SLUGS = {
  entrepreneur: 'ENTREPRENEUR',
  freelancer:   'FREELANCER',
  investor:     'INVESTOR',
  space:        'INCUBATOR',
} as const satisfies Record<string, SignupRole>;

export type JoinSlug = keyof typeof JOIN_SLUGS;

export function isJoinSlug(value: string): value is JoinSlug {
  return Object.prototype.hasOwnProperty.call(JOIN_SLUGS, value);
}
