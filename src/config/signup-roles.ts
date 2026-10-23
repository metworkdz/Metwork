import type { SignupRole } from '@/types/auth';

/**
 * Which optional signup fields each self-signup role collects.
 *
 * The ONE place that decides this: the signup form renders from it, the
 * signup schema validates against it, and the signup route uses it to drop
 * any field the role doesn't collect. Adding a role (e.g. FREELANCER with the
 * /join pages) is one entry here instead of new `role === …` checks in three
 * files. Client-safe — no server imports.
 */
export interface SignupRoleFields {
  /** Provider block: organisation kind (required), name, website, Instagram. */
  organization: boolean;
  /** LinkedIn handle or URL (optional, recommended). */
  linkedin: boolean;
  /** Sex (optional), used for ecosystem demographics. */
  sex: boolean;
}

export const SIGNUP_ROLE_FIELDS: Record<SignupRole, SignupRoleFields> = {
  ENTREPRENEUR: { organization: false, linkedin: false, sex: true },
  INVESTOR:     { organization: false, linkedin: true,  sex: true },
  INCUBATOR:    { organization: true,  linkedin: false, sex: false },
};

export function signupFieldsFor(role: SignupRole): SignupRoleFields {
  return SIGNUP_ROLE_FIELDS[role];
}
