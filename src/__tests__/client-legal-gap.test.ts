import { describe, it, expect } from 'vitest';
import { clientLegalGap } from '@/lib/client-legal-gap';

describe('clientLegalGap', () => {
  it('flags a company with neither RC nor NIF', () => {
    expect(clientLegalGap({ clientType: 'COMPANY', fullName: 'X' })).toBe('COMPANY_NO_LEGAL');
    expect(clientLegalGap({ clientType: 'COMPANY', fullName: 'X', nif: '0011' })).toBeNull();
  });
  it('flags a company-looking name filed as an individual or with no type (booking-created)', () => {
    expect(clientLegalGap({ fullName: 'Sarl Mdm Express' })).toBe('LOOKS_LIKE_COMPANY');
    expect(clientLegalGap({ clientType: 'INDIVIDUAL', fullName: 'EURL Metwork' })).toBe('LOOKS_LIKE_COMPANY');
    expect(clientLegalGap({ clientType: 'INDIVIDUAL', fullName: 'S.A.R.L Atlas' })).toBe('LOOKS_LIKE_COMPANY');
  });
  it('leaves a real person alone', () => {
    expect(clientLegalGap({ clientType: 'INDIVIDUAL', fullName: 'SELADJI Nassim' })).toBeNull();
    expect(clientLegalGap({ fullName: 'Sarah Benali' })).toBeNull();
  });
});
