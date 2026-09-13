/**
 * The bugs found on the program registration flow, checked on every OTHER
 * surface that sells something: events, spaces, consultations and
 * consultant-owned programs.
 *
 * The program work fixed shared code, so most of these are regression guards
 * proving the fix reached the other surfaces. Two are genuinely new:
 *
 *   • A paid EVENT reached a payment step for a logged-out visitor, but guest
 *     checkout is programs-only (`guestCheckoutAllowedFor`) — so they filled
 *     the whole form and hit a 401. The page now asks for a sign-in up front.
 *   • A cash SPACE reservation was priced at the ONLINE rate, because
 *     `createSpaceBooking` was the one `unitPrice` caller not passing a mode.
 *
 *   npx playwright test --project=cross-surface-parity --workers=1
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  guestContext,
  createEvent,
  createProgram,
  createSpace,
  setRegistrationForm,
  cardIntent,
  settleCard,
  submitRegistration,
  findBookingByRef,
  findBookingByPayToken,
  registrationsFor,
  readLocalDb,
  clientRef,
  isoFromNow,
} from './_helpers';
import { mintConsultantContext } from './_consult-helpers';

const ONLINE_PRICE = 22_000;
const CASH_PRICE = 24_000;

test.describe.configure({ mode: 'serial' });

let inc: APIRequestContext;
let guest: APIRequestContext;

test.beforeAll(async () => {
  inc = await roleContext('incubator');
  guest = await guestContext();
});

test.afterAll(async () => {
  await inc.dispose();
  await guest.dispose();
});

function customer(tag: string) {
  return {
    fullName: `QA ${tag}`,
    email: `qa.parity.${tag}.${Date.now()}@metwork.test`,
    phone: '+213700112233',
  };
}

/* ═══════════════════════════════ EVENTS ═══════════════════════════════ */

test.describe('Events', () => {
  test('a paid event resolves the online/cash split, like a program', async () => {
    const event = await createEvent(inc, { price: CASH_PRICE, capacity: 10 });
    // The create route accepts the split; assert the server honours it per surface.
    await inc.patch(`/api/incubator/events/${event.id}`, {
      data: {
        onlinePrice: ONLINE_PRICE,
        cashPrice: CASH_PRICE,
        acceptedPaymentMethods: ['ONLINE', 'CASH'],
        cashDepositType: 'PERCENT',
        cashDepositValue: 25,
      },
    });

    // A logged-in member is required for events, so use one.
    const member = await roleContext('builder');
    try {
      const onlineRef = clientRef('ev-online');
      const online = await cardIntent(member, {
        target: { itemKind: 'EVENT', eventId: event.id },
        paymentMode: 'ONLINE_FULL',
        customer: customer('ev-online'),
        clientReference: onlineRef,
      });
      expect(online.status(), await online.text()).toBe(201);
      const onlineIntent = findBookingByPayToken((await online.json()).token as string)!;

      const cashRef = clientRef('ev-cash');
      const cash = await cardIntent(member, {
        target: { itemKind: 'EVENT', eventId: event.id },
        paymentMode: 'CASH_DEPOSIT',
        customer: customer('ev-cash'),
        clientReference: cashRef,
      });
      expect(cash.status(), await cash.text()).toBe(201);
      const cashIntent = findBookingByPayToken((await cash.json()).token as string)!;

      // A membership discount may apply on top for a tiered member, so compare
      // the two surfaces against each other rather than to absolute figures.
      expect(onlineIntent.totalAmount!).toBeLessThan(cashIntent.totalAmount!);
      expect(cashIntent.cashRemainingAmount!).toBeGreaterThan(0);
    } finally {
      await member.dispose();
    }
  });

  test('a paid event cannot be registered for free', async () => {
    const event = await createEvent(inc, { price: 5_000, capacity: 10 });
    const res = await submitRegistration(guest, 'EVENT', event.id, `ev.free.${Date.now()}@metwork.test`);
    expect(res.status()).toBe(422);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe('PAYMENT_REQUIRED');
    expect(registrationsFor(event.id)).toHaveLength(0);
  });

  test('a FREE event still registers with no payment', async () => {
    const event = await createEvent(inc, { price: 0, capacity: 10 });
    const res = await submitRegistration(guest, 'EVENT', event.id, `ev.ok.${Date.now()}@metwork.test`);
    expect(res.status(), await res.text()).toBe(201);
    expect(registrationsFor(event.id)).toHaveLength(1);
  });

  test('a guest is refused an event card intent — the page must not offer one', async () => {
    // Guest checkout is programs-only. This is the rule the event page now
    // surfaces UP FRONT instead of walking someone to a 401 at the last step.
    const event = await createEvent(inc, { price: 5_000, capacity: 10 });
    const res = await cardIntent(guest, {
      target: { itemKind: 'EVENT', eventId: event.id },
      paymentMode: 'ONLINE_FULL',
      customer: customer('ev-guest'),
      clientReference: clientRef('ev-guest'),
    });
    expect(res.status()).toBe(401);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe('LOGIN_REQUIRED');
    expect(readLocalDb().bookings.filter((b) => b.itemId === event.id)).toHaveLength(0);
  });

  test('a paid event registration carries its answers through the checkout', async () => {
    const event = await createEvent(inc, { price: 5_000, capacity: 10 });
    const fields = await setRegistrationForm(inc, 'EVENT', event.id, [
      { label: 'Company', type: 'SHORT_TEXT', required: true },
    ]);

    const member = await roleContext('builder');
    try {
      const ref = clientRef('ev-answers');
      const res = await cardIntent(member, {
        target: { itemKind: 'EVENT', eventId: event.id },
        paymentMode: 'ONLINE_FULL',
        customer: customer('ev-answers'),
        clientReference: ref,
        registrationAnswers: [{ fieldId: fields[0]!.id, value: 'Atelier Verte' }],
      });
      expect(res.status(), await res.text()).toBe(201);
      // No seat and no registration until the money lands.
      expect(registrationsFor(event.id)).toHaveLength(0);

      await settleCard(member, (await res.json()).token as string);

      const regs = registrationsFor(event.id);
      expect(regs).toHaveLength(1);
      expect(regs[0]!.answers[0]!.value).toBe('Atelier Verte');
      expect(regs[0]!.bookingId).toBe(findBookingByRef(ref)!.id);
    } finally {
      await member.dispose();
    }
  });

  test('a paid event applicant cannot skip a required question', async () => {
    const event = await createEvent(inc, { price: 5_000, capacity: 10 });
    await setRegistrationForm(inc, 'EVENT', event.id, [
      { label: 'Company', type: 'SHORT_TEXT', required: true },
    ]);
    const member = await roleContext('builder');
    try {
      const res = await cardIntent(member, {
        target: { itemKind: 'EVENT', eventId: event.id },
        paymentMode: 'ONLINE_FULL',
        customer: customer('ev-missing'),
        clientReference: clientRef('ev-missing'),
        registrationAnswers: [],
      });
      expect(res.status()).toBe(422);
      expect(((await res.json()) as { error?: { code?: string } }).error?.code)
        .toBe('MISSING_REQUIRED_FIELD');
    } finally {
      await member.dispose();
    }
  });
});

/* ═══════════════════════════════ SPACES ═══════════════════════════════ */

test.describe('Spaces', () => {
  test('a cash space booking is priced from the CASH rate, not the online one', async () => {
    const space = await createSpace(inc, {
      pricePerHour: 1_000,
      pricePerDay: 6_000,
      capacity: 10,
      workingDays: [0, 1, 2, 3, 4, 5, 6],
      openingTime: '00:00',
      closingTime: '23:59',
      acceptedPaymentMethods: ['ONLINE', 'CASH'],
      cashDepositType: 'PERCENT',
      cashDepositValue: 50,
    });
    // Set a cash premium the online rate does not have.
    const patched = await inc.patch(`/api/incubator/spaces/${space.id}`, {
      data: { cashPricePerHour: 1_400, cashPricePerDay: 8_000 },
    });
    expect(patched.status(), await patched.text()).toBe(200);

    const member = await roleContext('builder');
    try {
      const day = isoFromNow(20).slice(0, 10);
      const startsAt = `${day}T09:00:00.000Z`;
      const endsAt = `${day}T11:00:00.000Z`; // 2 hours

      const onlineRef = clientRef('sp-online');
      const online = await cardIntent(member, {
        target: { itemKind: 'SPACE', spaceId: space.id, unit: 'HOUR', startsAt, endsAt },
        paymentMode: 'ONLINE_FULL',
        customer: customer('sp-online'),
        clientReference: onlineRef,
      });
      expect(online.status(), await online.text()).toBe(201);
      const onlineTotal = findBookingByPayToken((await online.json()).token as string)!.totalAmount!;

      const cashRef = clientRef('sp-cash');
      const cash = await cardIntent(member, {
        // A different window so the two do not collide on availability.
        target: {
          itemKind: 'SPACE', spaceId: space.id, unit: 'HOUR',
          startsAt: `${day}T14:00:00.000Z`, endsAt: `${day}T16:00:00.000Z`,
        },
        paymentMode: 'CASH_DEPOSIT',
        customer: customer('sp-cash'),
        clientReference: cashRef,
      });
      expect(cash.status(), await cash.text()).toBe(201);
      const cashTotal = findBookingByPayToken((await cash.json()).token as string)!.totalAmount!;

      // 2 × 1 000 online vs 2 × 1 400 cash, before any membership discount.
      expect(cashTotal).toBeGreaterThan(onlineTotal);
    } finally {
      await member.dispose();
    }
  });

  test('a guest is refused a space card intent', async () => {
    const space = await createSpace(inc, { capacity: 5 });
    const res = await cardIntent(guest, {
      target: {
        itemKind: 'SPACE', spaceId: space.id, unit: 'DAY',
        startsAt: isoFromNow(20), endsAt: isoFromNow(21),
      },
      paymentMode: 'ONLINE_FULL',
      customer: customer('sp-guest'),
      clientReference: clientRef('sp-guest'),
    });
    expect(res.status()).toBe(401);
  });
});

/* ══════════════════════ CONSULTANT-OWNED PROGRAMS ══════════════════════ */

test.describe('Consultant programs', () => {
  test('a new consultant program is seeded with the default application questions', async () => {
    // Incubator programs seeded the default question set on create; consultant
    // programs did not, so their public page asked for a name and a card and
    // nothing else. The two populations share one registration system.
    const { ctx: consultant } = await mintConsultantContext();
    try {
      const created = await consultant.post('/api/consultant/programs', {
        data: {
          title: `QA Consultant Seeded ${Date.now()}`,
          description: 'Automated e2e parity fixture. Safe to delete.',
          type: 'WORKSHOP',
          city: 'Alger',
          price: 0,
          acceptedPaymentMethods: ['ONLINE'],
          seatsTotal: 10,
          deadline: isoFromNow(30),
          startDate: isoFromNow(40),
          endDate: isoFromNow(70),
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const program = (await created.json()) as { id: string };

      // The portal seeds the form client-side after create; drive the same API.
      const seeded = await consultant.post('/api/consultant/registration-form', {
        data: {
          entityType: 'PROGRAM',
          entityId: program.id,
          fields: [
            {
              label: 'Startup / project name',
              labelKey: 'startupName',
              type: 'SHORT_TEXT',
              options: null,
              optionKeys: null,
              required: true,
              order: 0,
            },
          ],
        },
      });
      expect(seeded.status(), await seeded.text()).toBeLessThan(300);

      // The i18n key must survive the round trip, or the public page freezes
      // the question in the consultant's language.
      const stored = readLocalDb().registrationFormFields?.find((f) => f.entityId === program.id);
      expect(stored).toBeTruthy();
      expect((stored as { labelKey?: string }).labelKey).toBe('startupName');
    } finally {
      await consultant.dispose();
    }
  });

  test('a paid consultant program refuses a free registration, like an incubator one', async () => {
    const { ctx: consultant } = await mintConsultantContext();
    try {
      const created = await consultant.post('/api/consultant/programs', {
        data: {
          title: `QA Consultant Paid ${Date.now()}`,
          description: 'Automated e2e parity fixture. Safe to delete.',
          type: 'WORKSHOP',
          city: 'Alger',
          price: CASH_PRICE,
          onlinePrice: ONLINE_PRICE,
          cashPrice: CASH_PRICE,
          acceptedPaymentMethods: ['ONLINE'],
          seatsTotal: 10,
          deadline: isoFromNow(30),
          startDate: isoFromNow(40),
          endDate: isoFromNow(70),
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const program = (await created.json()) as { id: string };

      const free = await submitRegistration(
        guest, 'PROGRAM', program.id, `cp.free.${Date.now()}@metwork.test`,
      );
      expect(free.status()).toBe(422);
      expect(((await free.json()) as { error?: { code?: string } }).error?.code)
        .toBe('PAYMENT_REQUIRED');

      // And a guest CAN pay for it — consultant programs are still programs.
      const ref = clientRef('cp-pay');
      const paid = await cardIntent(guest, {
        target: { itemKind: 'PROGRAM', programId: program.id },
        paymentMode: 'ONLINE_FULL',
        customer: customer('cp-pay'),
        clientReference: ref,
        registrationAnswers: [],
      });
      expect(paid.status(), await paid.text()).toBe(201);
      // Priced from the ONLINE surface, exactly like an incubator program.
      expect(findBookingByPayToken((await paid.json()).token as string)!.totalAmount)
        .toBe(ONLINE_PRICE);
    } finally {
      await consultant.dispose();
    }
  });
});

/* ═══════════════════ THE PROGRAM FLOW STILL WORKS ═══════════════════ */

test('regression — an incubator program is unaffected by all of the above', async () => {
  const program = await createProgram(inc, {
    price: CASH_PRICE,
    onlinePrice: ONLINE_PRICE,
    cashPrice: CASH_PRICE,
    seatsTotal: 5,
    acceptedPaymentMethods: ['ONLINE', 'CASH'],
    cashDepositType: 'PERCENT',
    cashDepositValue: 25,
  });
  const ref = clientRef('prog-regression');
  const res = await cardIntent(guest, {
    target: { itemKind: 'PROGRAM', programId: program.id },
    paymentMode: 'ONLINE_FULL',
    customer: customer('prog-regression'),
    clientReference: ref,
    registrationAnswers: [],
  });
  expect(res.status(), await res.text()).toBe(201);
  await settleCard(guest, (await res.json()).token as string);
  expect(findBookingByRef(ref)!.totalAmount).toBe(ONLINE_PRICE);
  expect(findBookingByRef(ref)!.status).toBe('CONFIRMED');
});
