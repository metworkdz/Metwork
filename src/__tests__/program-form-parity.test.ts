/**
 * One program form, two surfaces.
 *
 * The incubator dashboard and the consultant portal keep their own markup —
 * different design systems, different auth — but everything that decides what a
 * program IS now comes from `@/lib/program-form`. These tests are the thing
 * that keeps them honest, because the two had already drifted in three ways
 * nobody would find by reading either file alone:
 *
 *   1. The portal never sent onlinePrice / cashPrice, so a consultant could not
 *      charge a different price for cash even though the API accepted it.
 *   2. The incubator form never checked date ORDER, and neither does its route
 *      (the consultant's route does), so an incubator could publish a program
 *      whose deadline fell after its start date — closed the day it appeared.
 *   3. The portal anchored dates at MIDNIGHT local, which in Algeria (UTC+1) is
 *      23:00 the previous day in UTC. Every consultant program was stored, and
 *      rendered, one day early.
 *
 * The payload test is the load-bearing one: it asserts the shared builder emits
 * every field BOTH API schemas accept, so a field can never again exist on the
 * server and be missing from a form.
 */
import { describe, it, expect } from 'vitest';

import {
  PROGRAM_TYPES,
  dateInputToIso,
  emptyProgramForm,
  programFormFromRecord,
  programFormToPayload,
  togglePaymentMethod,
  validateProgramForm,
  type ProgramFormValues,
} from '@/lib/program-form';

/** A filled-in form, the way a host would leave it before pressing save. */
function filled(over: Partial<ProgramFormValues> = {}): ProgramFormValues {
  return {
    ...emptyProgramForm(),
    title: 'Devenir un Community Manager',
    description: 'Trois jours pour piloter des réseaux sociaux qui performent.',
    type: 'TRAINING',
    city: 'Oran',
    price: '23000',
    seatsTotal: '13',
    deadline: '2026-09-28',
    startDate: '2026-09-29',
    endDate: '2026-10-01',
    ...over,
  };
}

/* ═════════════ The payload is the contract with both routes ═════════════ */

describe('programFormToPayload', () => {
  /**
   * Every key both `/api/incubator/programs` and `/api/consultant/programs`
   * accept. Kept here by hand ON PURPOSE: adding a field to the routes and not
   * to the form is exactly the bug this file exists to catch, so the list has
   * to be written down somewhere a test can fail against.
   */
  const API_FIELDS = [
    'title', 'description', 'type', 'city', 'imageUrls',
    'price', 'onlinePrice', 'cashPrice',
    'seatsTotal', 'deadline', 'startDate', 'startTime', 'endTime', 'endDate',
    'acceptedPaymentMethods', 'cashDepositType', 'cashDepositValue',
  ] as const;

  it('emits every field the two API schemas accept', () => {
    const payload = programFormToPayload(filled());
    for (const field of API_FIELDS) {
      expect(payload, `payload is missing "${field}"`).toHaveProperty(field);
    }
  });

  it('carries the split prices — the field the portal used to drop', () => {
    const payload = programFormToPayload(filled({ onlinePrice: '23000', cashPrice: '25000' }));
    expect(payload.onlinePrice).toBe(23_000);
    expect(payload.cashPrice).toBe(25_000);
  });

  it('sends null, not 0, when a split price is left blank', () => {
    // null means "no separate rate, fall back to price". A 0 here would
    // advertise a free program on whichever rail was left empty.
    const payload = programFormToPayload(filled({ onlinePrice: '', cashPrice: '' }));
    expect(payload.onlinePrice).toBeNull();
    expect(payload.cashPrice).toBeNull();
  });

  it('keeps a deliberate 0 price', () => {
    const payload = programFormToPayload(filled({ cashPrice: '0' }));
    expect(payload.cashPrice).toBe(0);
  });

  it('clears the deposit when cash is not accepted', () => {
    const payload = programFormToPayload(
      filled({ acceptedPaymentMethods: ['ONLINE'], cashDepositValue: '10' }),
    );
    expect(payload.cashDepositType).toBeNull();
    expect(payload.cashDepositValue).toBeNull();
  });

  it('reads a blank deposit as no deposit, not as a missing answer', () => {
    const payload = programFormToPayload(filled({ cashDepositValue: '' }));
    expect(payload.cashDepositValue).toBe(0);
  });

  it('sends null for an unpublished start or end time', () => {
    const payload = programFormToPayload(filled({ startTime: '', endTime: '' }));
    expect(payload.startTime).toBeNull();
    expect(payload.endTime).toBeNull();
  });

  it('trims what the host typed', () => {
    const payload = programFormToPayload(filled({ title: '  Formation  ', city: ' Oran ' }));
    expect(payload.title).toBe('Formation');
    expect(payload.city).toBe('Oran');
  });
});

/* ═══════════════════ Dates anchor at noon, not midnight ═══════════════════ */

describe('dateInputToIso', () => {
  it('keeps the day the host picked, whatever the timezone', () => {
    // The portal used to anchor at midnight local. In Algeria (UTC+1) that is
    // 23:00 the PREVIOUS day in UTC, so 29 September was stored as the 28th and
    // rendered as the 28th on the public page.
    expect(dateInputToIso('2026-09-29').slice(0, 10)).toBe('2026-09-29');
    expect(dateInputToIso('2026-01-01').slice(0, 10)).toBe('2026-01-01');
    expect(dateInputToIso('2026-12-31').slice(0, 10)).toBe('2026-12-31');
  });

  it('survives the round trip back into the form', () => {
    const iso = dateInputToIso('2026-09-29');
    expect(programFormFromRecord({ startDate: iso }).startDate).toBe('2026-09-29');
  });
});

/* ════════════════════════════ Validation ════════════════════════════════ */

describe('validateProgramForm', () => {
  it('passes a complete program', () => {
    expect(validateProgramForm(filled())).toBeNull();
  });

  it('rejects a deadline AFTER the start date — the incubator gap', () => {
    // Neither the incubator form nor its route checked this. A program saved
    // that way is shown as closed on the day it is published.
    expect(validateProgramForm(filled({ deadline: '2026-09-30', startDate: '2026-09-29' })))
      .toBe('dateOrder');
  });

  it('rejects a program that ends before it starts', () => {
    expect(validateProgramForm(filled({ startDate: '2026-10-05', endDate: '2026-10-01' })))
      .toBe('dateOrder');
  });

  it('accepts a deadline ON the start date', () => {
    expect(validateProgramForm(filled({ deadline: '2026-09-29', startDate: '2026-09-29' })))
      .toBeNull();
  });

  it('names the first problem, in the order a host reads the form', () => {
    expect(validateProgramForm(filled({ title: 'x' }))).toBe('title');
    expect(validateProgramForm(filled({ description: 'short' }))).toBe('description');
    expect(validateProgramForm(filled({ city: '  ' }))).toBe('city');
    expect(validateProgramForm(filled({ seatsTotal: '0' }))).toBe('seats');
    expect(validateProgramForm(filled({ deadline: '' }))).toBe('dates');
  });

  it('rejects a negative price on any rail', () => {
    expect(validateProgramForm(filled({ price: '-1' }))).toBe('price');
    expect(validateProgramForm(filled({ cashPrice: '-5' }))).toBe('price');
  });

  it('rejects a percentage deposit over 100', () => {
    expect(validateProgramForm(filled({ cashDepositType: 'PERCENT', cashDepositValue: '120' })))
      .toBe('depositPercent');
  });

  it('accepts a 0 deposit — pay the whole amount on the day', () => {
    expect(validateProgramForm(filled({ cashDepositValue: '0' }))).toBeNull();
    expect(validateProgramForm(filled({ cashDepositValue: '' }))).toBeNull();
  });

  it('ignores the deposit entirely when cash is not accepted', () => {
    expect(validateProgramForm(
      filled({ acceptedPaymentMethods: ['ONLINE'], cashDepositValue: '999' }),
    )).toBeNull();
  });

  it('rejects a malformed time rather than sending it', () => {
    expect(validateProgramForm(filled({ startTime: '9am' }))).toBe('clockTime');
    expect(validateProgramForm(filled({ startTime: '09:00', endTime: '25:00' }))).toBe('clockTime');
    expect(validateProgramForm(filled({ startTime: '09:00', endTime: '17:30' }))).toBeNull();
  });
});

/* ══════════════════════ Loading a program back in ═══════════════════════ */

describe('programFormFromRecord', () => {
  it('round-trips a program through the form without changing it', () => {
    const original = filled({
      onlinePrice: '23000', cashPrice: '25000',
      startTime: '09:00', endTime: '17:00',
      cashDepositType: 'FIXED', cashDepositValue: '5000',
      imageUrls: ['https://example.dz/a.png'],
    });
    const payload = programFormToPayload(original);
    // What the API would hand back, reloaded into the form, must produce the
    // same payload again — otherwise editing a program silently changes it.
    expect(programFormToPayload(programFormFromRecord(payload))).toEqual(payload);
  });

  it('does not re-add a deposit the host removed', () => {
    // A stored program with no deposit must come back as 0, not as the 10%
    // default — reopening the form would otherwise quietly reinstate it.
    expect(programFormFromRecord({ cashDepositType: null, cashDepositValue: null }).cashDepositValue)
      .toBe('0');
  });

  it('accepts a legacy single cover image', () => {
    expect(programFormFromRecord({ imageUrl: 'https://example.dz/cover.png' }).imageUrls)
      .toEqual(['https://example.dz/cover.png']);
  });

  it('falls back to the defaults for an empty record', () => {
    // …with one deliberate exception: the deposit. A blank NEW form offers 10%
    // as a starting suggestion, but a RECORD that carries no deposit config is
    // stating that there is no deposit, and must load back as 0.
    const loaded = programFormFromRecord({});
    const fresh = emptyProgramForm();
    expect(loaded).toEqual({ ...fresh, cashDepositValue: '0' });
    expect(fresh.cashDepositValue).toBe('10');
  });
});

/* ═════════════════════════ Payment methods ══════════════════════════════ */

describe('togglePaymentMethod', () => {
  it('adds and removes', () => {
    expect(togglePaymentMethod(['ONLINE'], 'CASH')).toEqual(['ONLINE', 'CASH']);
    expect(togglePaymentMethod(['ONLINE', 'CASH'], 'CASH')).toEqual(['ONLINE']);
  });

  it('refuses to leave a program with no way to pay for it', () => {
    expect(togglePaymentMethod(['CASH'], 'CASH')).toEqual(['CASH']);
  });
});

describe('PROGRAM_TYPES', () => {
  it('matches the enum both routes validate against', () => {
    expect([...PROGRAM_TYPES].sort()).toEqual(
      ['ACCELERATION', 'BOOTCAMP', 'INCUBATION', 'TRAINING', 'WEBINAR', 'WORKSHOP'],
    );
  });
});
