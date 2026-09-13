/**
 * The marketing email may not quote a price the checkout will not honour.
 *
 * The campaign email advertises what METWORK10 leaves to pay, which means it
 * does the discount arithmetic outside the payment engine — a duplicated
 * calculation, and duplicated calculations drift. If `validatePromoCodeSync`
 * ever changes its rounding, a mailshot quoting the old number would reach
 * thousands of inboxes before anybody noticed at the checkout page.
 *
 * These tests pin the two together, and pin the rest of the promo block to the
 * one rule that matters: never advertise a code the checkout would refuse.
 */
import { describe, it, expect } from 'vitest';

import { validatePromoCodeSync } from '@/server/promo-codes/service';
import {
  communityManagerEmailHtml,
  discountedPrice,
  type CampaignFacts,
} from '../../scripts/campaigns/community-manager-email';

const BASE: CampaignFacts = {
  registerUrl: 'https://metwork.dz/programs/formation-devenir-un-community-manager',
  dates: '29 – 30 septembre & 1er octobre',
  startTime: '09:00',
  city: 'Oran',
  trainerName: 'Naouel Salhi',
  trainerTitle: 'Social Media Specialist',
  onlinePrice: 23_000,
  cashPrice: 25_000,
  deposit: 5_000,
  seatsLeft: 12,
  deadline: '28 septembre',
  promo: { code: 'METWORK10', percent: 10, remainingUses: 10, expires: '27 septembre' },
};

/** A promo row shaped the way the admin UI writes one. */
function promoRow(percent: number) {
  return {
    id: 'promo-1', code: 'METWORK10', discountPercent: percent, appliesTo: 'ALL',
    expiresAt: null, usageLimit: null, usedCount: 0, isActive: true,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  } as never;
}

describe('discountedPrice', () => {
  it('agrees with the checkout engine, to the dinar', () => {
    for (const percent of [5, 10, 15, 20, 33, 50]) {
      for (const amount of [23_000, 25_000, 24_000, 1_000, 7_777, 19_999]) {
        const engine = validatePromoCodeSync([promoRow(percent)], 'METWORK10', amount, 'PROGRAM');
        expect(engine.valid).toBe(true);
        expect(discountedPrice(amount, percent)).toBe(engine.finalAmount);
      }
    }
  });

  it('never goes below zero', () => {
    expect(discountedPrice(23_000, 100)).toBe(0);
    expect(discountedPrice(0, 10)).toBe(0);
  });
});

describe('the promo block', () => {
  it('shows the code and what it leaves to pay on BOTH rails', () => {
    const html = communityManagerEmailHtml(BASE);
    expect(html).toContain('METWORK10');
    expect(html).toContain('CODE PROMO');
    // 23 000 − 10 % = 20 700 by card; 25 000 − 10 % = 22 500 in cash.
    const digits = html.replace(/[\s,  ]|&nbsp;/g, '');
    expect(digits).toContain('20700DZD');
    expect(digits).toContain('22500DZD');
    // The undiscounted prices still stand above it — the code is a bonus, not
    // a replacement, and a reader who loses the code must still know the price.
    expect(digits).toContain('23000DZD');
    expect(digits).toContain('25000DZD');
  });

  it('states what is LEFT of the code, not its original cap', () => {
    const html = communityManagerEmailHtml({
      ...BASE,
      promo: { ...BASE.promo!, remainingUses: 3 },
    });
    expect(html).toContain('les 3 premières inscriptions');
    expect(html).not.toContain('les 10 premières');
  });

  it('reads naturally when a single use remains', () => {
    const html = communityManagerEmailHtml({
      ...BASE,
      promo: { ...BASE.promo!, remainingUses: 1 },
    });
    expect(html).toContain('une seule inscription');
    expect(html).not.toContain('1 premières');
  });

  it('says nothing about limits when the code is unlimited and undated', () => {
    const html = communityManagerEmailHtml({
      ...BASE,
      promo: { code: 'METWORK10', percent: 10, remainingUses: null, expires: null },
    });
    expect(html).toContain('METWORK10');
    expect(html).not.toContain('premières inscriptions');
    expect(html).not.toContain("jusqu'au 27");
  });

  it('carries the code into the preheader — the line shown in the inbox list', () => {
    expect(communityManagerEmailHtml(BASE)).toContain('Code METWORK10 : −10 %.');
  });

  it('disappears entirely when there is no code to advertise', () => {
    const html = communityManagerEmailHtml({ ...BASE, promo: null });
    expect(html).not.toContain('METWORK10');
    expect(html).not.toContain('CODE PROMO');
    // …and the rest of the email is unharmed.
    expect(html).toContain('Je réserve ma place');
    expect(html).toContain('Oran');
  });

  it('does not print a cash figure when both rails cost the same', () => {
    const html = communityManagerEmailHtml({ ...BASE, cashPrice: 23_000 });
    expect(html).not.toContain('en esp&egrave;ces');
    expect(html.replace(/&nbsp;|\s/g, '')).toContain('20700DZD');
  });
});
