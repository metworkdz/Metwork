import { describe, it, expect } from 'vitest';
import {
  LEGAL_STATUSES,
  isLegalStatus,
  requiresCompanyForm,
  defaultTaxRegimeFor,
  acceptedDocumentsFor,
} from '@/types/legal-status';

describe('legal status model', () => {
  it('recognises only known statuses', () => {
    for (const s of LEGAL_STATUSES) expect(isLegalStatus(s)).toBe(true);
    expect(isLegalStatus('BUSINESS')).toBe(false);
    expect(isLegalStatus('auto_entrepreneur')).toBe(false);
    expect(isLegalStatus(null)).toBe(false);
  });

  it('asks for a company form only for companies', () => {
    expect(LEGAL_STATUSES.filter(requiresCompanyForm)).toEqual(['COMPANY']);
  });

  it('pre-fills IFU for individuals, REEL for companies, nothing otherwise', () => {
    expect(defaultTaxRegimeFor('AUTO_ENTREPRENEUR')).toBe('IFU');
    expect(defaultTaxRegimeFor('INDIVIDUAL_IFU')).toBe('IFU');
    expect(defaultTaxRegimeFor('COMPANY')).toBe('REEL');
    expect(defaultTaxRegimeFor('LIBERAL_PROFESSION')).toBeNull();
    expect(defaultTaxRegimeFor('ASSOCIATION')).toBeNull();
    expect(defaultTaxRegimeFor('UNREGISTERED')).toBeNull();
  });

  it('maps each registered status to the document that proves it', () => {
    expect(acceptedDocumentsFor('AUTO_ENTREPRENEUR')).toEqual(['AUTO_ENTREPRENEUR_CARD']);
    expect(acceptedDocumentsFor('INDIVIDUAL_IFU')).toEqual(['COMMERCE_REGISTER']);
    expect(acceptedDocumentsFor('COMPANY')).toEqual(['COMMERCE_REGISTER']);
    expect(acceptedDocumentsFor('UNREGISTERED')).toEqual([]);
  });
});
