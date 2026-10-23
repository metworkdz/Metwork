import { describe, it, expect } from 'vitest';
import { signupSchema } from '@/lib/validators';
import { SIGNUP_ROLE_FIELDS } from '@/config/signup-roles';
import { SIGNUP_ROLES, USER_ROLES } from '@/types/auth';

const base = {
  fullName: 'Amine Kaci',
  email: 'amine@example.dz',
  phone: '+213550000000',
  city: '16',
  password: 'Str0ng!Passw0rd',
  confirmPassword: 'Str0ng!Passw0rd',
  acceptTerms: true,
  acceptPrivacy: true,
};

describe('signup role config', () => {
  it('has exactly one entry per self-signup role', () => {
    expect(Object.keys(SIGNUP_ROLE_FIELDS).sort()).toEqual([...SIGNUP_ROLES].sort());
  });

  it('keeps the field matrix the form had before the refactor', () => {
    expect(SIGNUP_ROLE_FIELDS.ENTREPRENEUR).toEqual({ organization: false, linkedin: false, sex: true });
    expect(SIGNUP_ROLE_FIELDS.INVESTOR).toEqual({ organization: false, linkedin: true, sex: true });
    expect(SIGNUP_ROLE_FIELDS.INCUBATOR).toEqual({ organization: true, linkedin: false, sex: false });
  });

  it('still requires an organisation kind for providers only', () => {
    const incubator = signupSchema.safeParse({ ...base, role: 'INCUBATOR' });
    expect(incubator.success).toBe(false);
    expect(incubator.error?.issues.some((i) => i.message === 'businessTypeRequired')).toBe(true);

    expect(signupSchema.safeParse({ ...base, role: 'INCUBATOR', businessType: 'COWORKING_SPACE' }).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, role: 'ENTREPRENEUR' }).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, role: 'INVESTOR' }).success).toBe(true);
  });

  it('does not let anyone self-sign-up as a freelancer or admin yet', () => {
    expect(USER_ROLES).toContain('FREELANCER');
    expect(signupSchema.safeParse({ ...base, role: 'FREELANCER' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, role: 'ADMIN' }).success).toBe(false);
  });
});
