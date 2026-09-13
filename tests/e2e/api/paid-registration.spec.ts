/**
 * API-driven e2e: the PAID public registration link.
 *
 * This is the launch suite for the platform's first paid training. It exists
 * because two defects would each have cost real money on day one:
 *
 *   • The link an incubator hands out (`/programs/{slug}`) registered anyone
 *     for FREE. A 22 000 DZD training took the seat, emailed "registration
 *     confirmed", and never charged a dinar.
 *   • Split pricing (22 000 by card / 24 000 in cash) was resolved by the card
 *     path only. Every display and the whole wallet path read the base `price`,
 *     so the amount shown and the amount charged disagreed in both directions.
 *
 * Everything here asserts MONEY and SEATS from server state — never a UI
 * message. Mock provider in SYNC mode. SERIAL (workers:1): the suite shares one
 * dev server and one JSON document, and every test moves money.
 *
 *   npx playwright test --project=paid-registration --workers=1
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  roleContext,
  guestContext,
  createProgram,
  setRegistrationForm,
  cardIntent,
  settleCard,
  payCard,
  submitRegistration,
  findBookingByRef,
  findBookingByPayToken,
  registrationsFor,
  programStatus,
  readLocalDb,
  clientRef,
  xff,
} from './_helpers';

/** The exact scenario reported from the field. */
const ONLINE_PRICE = 22_000;
const CASH_PRICE = 24_000;
/** 25 % of the cash total, paid online by card; the rest on site. */
const DEPOSIT_PERCENT = 25;
const CASH_DEPOSIT = 6_000;
const CASH_ON_SITE = 18_000;
/** Platform payer fee, added on top of the online portion (2 % default). */
const PAYER_FEE_RATE = 0.02;

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
    email: `qa.paidreg.${tag}.${Date.now()}@metwork.test`,
    phone: '+213700112233',
  };
}

/** A split-priced training that accepts both surfaces, with an application form. */
async function splitPricedTraining(opts: { seatsTotal?: number; deadlineDays?: number } = {}) {
  const program = await createProgram(inc, {
    title: `QA Paid Training ${Date.now()}`,
    type: 'TRAINING',
    price: CASH_PRICE,
    onlinePrice: ONLINE_PRICE,
    cashPrice: CASH_PRICE,
    seatsTotal: opts.seatsTotal ?? 5,
    deadlineDays: opts.deadlineDays ?? 30,
    acceptedPaymentMethods: ['ONLINE', 'CASH'],
    cashDepositType: 'PERCENT',
    cashDepositValue: DEPOSIT_PERCENT,
  });
  const fields = await setRegistrationForm(inc, 'PROGRAM', program.id, [
    { label: 'Startup / project name', type: 'SHORT_TEXT', required: true },
    { label: 'Stage', type: 'DROPDOWN', options: ['Idea', 'MVP'], required: true },
    { label: 'Website', type: 'URL', required: false },
  ]);
  return { program, fields };
}

function fullAnswers(fields: Array<{ id: string; label: string }>) {
  return [
    { fieldId: fields[0]!.id, value: 'Atelier Verte' },
    { fieldId: fields[1]!.id, value: 'Idea' },
    { fieldId: fields[2]!.id, value: 'https://atelier-verte.dz' },
  ];
}

/* ═══════════════════════ T1 — guest pays the full amount by card ═══════════════════════ */

test('T1 — a card payer is charged the ONLINE price, not the base price', async () => {
  const { program, fields } = await splitPricedTraining();
  const ref = clientRef('t1');
  const who = customer('t1');

  const res = await cardIntent(guest, {
    target: { itemKind: 'PROGRAM', programId: program.id },
    paymentMode: 'ONLINE_FULL',
    customer: who,
    clientReference: ref,
    registrationAnswers: fullAnswers(fields),
    locale: 'fr',
  });
  expect(res.status(), await res.text()).toBe(201);
  const { token } = (await res.json()) as { token: string };

  // The intent is priced from onlinePrice — this is THE regression. Before the
  // fix every surface resolved to `price` (24 000) on the way in.
  const intent = findBookingByPayToken(token)!;
  expect(intent.totalAmount).toBe(ONLINE_PRICE);
  expect(intent.onlinePaidAmount).toBe(ONLINE_PRICE);
  expect(intent.cashRemainingAmount).toBe(0);
  expect(intent.status).toBe('PENDING_PAYMENT');

  // An unpaid intent holds NO seat and writes NO registration.
  expect(registrationsFor(program.id)).toHaveLength(0);
  expect((await programStatus(guest, program.id)).taken).toBe(0);

  await settleCard(guest, token);

  const booking = findBookingByRef(ref)!;
  expect(booking.status).toBe('CONFIRMED');
  expect(booking.paymentStatus).toBe('PAID');
  expect(booking.totalAmount).toBe(ONLINE_PRICE);
  // The buyer is charged the price PLUS the platform's payer fee, itemised on
  // the checkout page. Both numbers are frozen on the booking at intent time.
  expect(booking.payerFeeAmount).toBe(Math.round(ONLINE_PRICE * PAYER_FEE_RATE));
  expect(booking.onlineChargeAmount).toBe(ONLINE_PRICE + Math.round(ONLINE_PRICE * PAYER_FEE_RATE));

  // The application survived the round trip through the hosted checkout.
  const regs = registrationsFor(program.id);
  expect(regs).toHaveLength(1);
  expect(regs[0]!.email).toBe(who.email.toLowerCase());
  expect(regs[0]!.status).toBe('CONFIRMED');
  expect(regs[0]!.bookingId).toBe(booking.id);
  expect(regs[0]!.answers).toEqual(fullAnswers(fields));

  // Booking + registration are ONE attendee, not two.
  expect((await programStatus(guest, program.id)).taken).toBe(1);
});

/* ═══════════════════════ T2 — cash: deposit online, balance on site ═══════════════════════ */

test('T2 — a cash payer owes the CASH price: deposit by card now, balance on site', async () => {
  const { program, fields } = await splitPricedTraining();
  const ref = clientRef('t2');

  const res = await cardIntent(guest, {
    target: { itemKind: 'PROGRAM', programId: program.id },
    paymentMode: 'CASH_DEPOSIT',
    customer: customer('t2'),
    clientReference: ref,
    registrationAnswers: fullAnswers(fields),
    locale: 'fr',
  });
  expect(res.status(), await res.text()).toBe(201);
  const { token } = (await res.json()) as { token: string };

  const intent = findBookingByPayToken(token)!;
  // The cash surface is priced from cashPrice, and the deposit comes off THAT
  // total — not off the online price.
  expect(intent.totalAmount).toBe(CASH_PRICE);
  expect(intent.onlinePaidAmount).toBe(CASH_DEPOSIT);
  expect(intent.cashRemainingAmount).toBe(CASH_ON_SITE);

  await settleCard(guest, token);

  const booking = findBookingByRef(ref)!;
  expect(booking.status).toBe('CONFIRMED');
  // Seat is held, but the money is not fully in — the incubator collects the
  // balance on the day and closes it with mark-cash-paid.
  expect(booking.paymentStatus).toBe('AWAITING_CASH');
  expect(booking.cashRemainingAmount).toBe(CASH_ON_SITE);
  // The fee is charged on the ONLINE portion only, never the cash remainder.
  expect(booking.payerFeeAmount).toBe(Math.round(CASH_DEPOSIT * PAYER_FEE_RATE));

  expect(registrationsFor(program.id)).toHaveLength(1);
  expect((await programStatus(guest, program.id)).taken).toBe(1);
});

/* ═══════════════════════ T3 — the free route must refuse a paid listing ═══════════════════════ */

test('T3 — a paid program cannot be registered for free', async () => {
  const { program } = await splitPricedTraining();

  const res = await submitRegistration(guest, 'PROGRAM', program.id, 'freeloader@metwork.test');
  expect(res.status()).toBe(422);
  const body = (await res.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe('PAYMENT_REQUIRED');

  // Nothing recorded, no seat taken.
  expect(registrationsFor(program.id)).toHaveLength(0);
  expect((await programStatus(guest, program.id)).taken).toBe(0);
});

test('T3b — a FREE program still registers with no payment (regression)', async () => {
  const program = await createProgram(inc, {
    title: `QA Free Program ${Date.now()}`,
    price: 0,
    seatsTotal: 5,
  });

  const res = await submitRegistration(guest, 'PROGRAM', program.id, `free.${Date.now()}@metwork.test`);
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { registration: { status: string } };
  expect(body.registration.status).toBe('CONFIRMED');
  expect(registrationsFor(program.id)).toHaveLength(1);
  expect((await programStatus(guest, program.id)).taken).toBe(1);
});

/* ═══════════════════════ T4 — required questions ═══════════════════════ */

test('T4 — a paid applicant cannot skip a required question', async () => {
  const { program, fields } = await splitPricedTraining();

  const res = await cardIntent(guest, {
    target: { itemKind: 'PROGRAM', programId: program.id },
    paymentMode: 'ONLINE_FULL',
    customer: customer('t4'),
    clientReference: clientRef('t4'),
    // 'Stage' is required and missing.
    registrationAnswers: [{ fieldId: fields[0]!.id, value: 'Atelier Verte' }],
  });
  expect(res.status()).toBe(422);
  const body = (await res.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe('MISSING_REQUIRED_FIELD');

  // Refused BEFORE any intent existed — no dead booking rows left behind.
  expect(readLocalDb().bookings.filter((b) => b.itemId === program.id)).toHaveLength(0);
});

/* ═══════════════════════ T5 — idempotency ═══════════════════════ */

test('T5 — a replayed submit and a replayed settlement each move money once', async () => {
  const { program, fields } = await splitPricedTraining();
  const ref = clientRef('t5');
  const who = customer('t5');
  const body = {
    target: { itemKind: 'PROGRAM' as const, programId: program.id },
    paymentMode: 'ONLINE_FULL' as const,
    customer: who,
    clientReference: ref,
    registrationAnswers: fullAnswers(fields),
  };

  const first = await cardIntent(guest, body);
  expect(first.status()).toBe(201);
  const { token } = (await first.json()) as { token: string };

  // Same clientReference → the original intent replays instead of a second one.
  const replay = await cardIntent(guest, body);
  expect(replay.status()).toBe(200);
  expect((await replay.json()).replayed).toBe(true);
  expect(readLocalDb().bookings.filter((b) => b.itemId === program.id)).toHaveLength(1);

  await settleCard(guest, token);
  // Settle again (refresh / webhook + return): a pure no-op.
  await payCard(guest, token, 'verify');

  expect(readLocalDb().bookings.filter((b) => b.itemId === program.id)).toHaveLength(1);
  expect(registrationsFor(program.id)).toHaveLength(1);
  expect((await programStatus(guest, program.id)).taken).toBe(1);

  // And exactly one payout / commission pair reached the incubator.
  const txns = readLocalDb().transactions.filter(
    (t) => String((t as { reference?: string }).reference ?? '').endsWith(findBookingByRef(ref)!.id),
  );
  expect(txns.filter((t) => (t as { type?: string }).type === 'PAYOUT')).toHaveLength(1);
  expect(txns.filter((t) => (t as { type?: string }).type === 'COMMISSION')).toHaveLength(1);
});

/* ═══════════════════════ T6 — abandoned checkout ═══════════════════════ */

test('T6 — an abandoned checkout holds no seat and blocks nobody', async () => {
  const { program, fields } = await splitPricedTraining({ seatsTotal: 1 });

  // Someone starts paying and walks away.
  const abandoned = await cardIntent(guest, {
    target: { itemKind: 'PROGRAM', programId: program.id },
    paymentMode: 'ONLINE_FULL',
    customer: customer('t6-abandon'),
    clientReference: clientRef('t6a'),
    registrationAnswers: fullAnswers(fields),
  });
  expect(abandoned.status()).toBe(201);
  expect((await programStatus(guest, program.id)).taken).toBe(0);

  // The last seat is still available to someone who actually pays.
  const ref = clientRef('t6b');
  const real = await cardIntent(guest, {
    target: { itemKind: 'PROGRAM', programId: program.id },
    paymentMode: 'ONLINE_FULL',
    customer: customer('t6-real'),
    clientReference: ref,
    registrationAnswers: fullAnswers(fields),
  });
  const { token } = (await real.json()) as { token: string };
  await settleCard(guest, token);

  expect(findBookingByRef(ref)!.status).toBe('CONFIRMED');
  expect((await programStatus(guest, program.id)).taken).toBe(1);
  expect(registrationsFor(program.id)).toHaveLength(1);
});

/* ═══════════════════════ T7 — capacity is binding at settlement ═══════════════════════ */

test('T7 — the last seat is never sold twice', async () => {
  const { program, fields } = await splitPricedTraining({ seatsTotal: 1 });

  const refA = clientRef('t7a');
  const refB = clientRef('t7b');
  // Both start the checkout while the seat is still free — neither intent
  // holds it, exactly as designed.
  const a = await cardIntent(guest, {
    target: { itemKind: 'PROGRAM', programId: program.id },
    paymentMode: 'ONLINE_FULL',
    customer: customer('t7a'),
    clientReference: refA,
    registrationAnswers: fullAnswers(fields),
  });
  const b = await cardIntent(guest, {
    target: { itemKind: 'PROGRAM', programId: program.id },
    paymentMode: 'ONLINE_FULL',
    customer: customer('t7b'),
    clientReference: refB,
    registrationAnswers: fullAnswers(fields),
  });
  const tokenA = (await a.json()).token as string;
  const tokenB = (await b.json()).token as string;

  await settleCard(guest, tokenA);
  await settleCard(guest, tokenB);

  expect(findBookingByRef(refA)!.status).toBe('CONFIRMED');
  // The second payer is VOIDED for a manual refund rather than oversold into a
  // full cohort — a decision the operator can act on, not a silent overbooking.
  const second = findBookingByRef(refB)!;
  expect(second.status).toBe('CANCELLED');

  expect(registrationsFor(program.id)).toHaveLength(1);
  expect((await programStatus(guest, program.id)).taken).toBe(1);
});

/* ═══════════════════════ T8 — deadline ═══════════════════════ */

test('T8 — a closed program is refused before any money moves', async () => {
  const { program, fields } = await splitPricedTraining({ deadlineDays: -1 });

  const res = await cardIntent(guest, {
    target: { itemKind: 'PROGRAM', programId: program.id },
    paymentMode: 'ONLINE_FULL',
    customer: customer('t8'),
    clientReference: clientRef('t8'),
    registrationAnswers: fullAnswers(fields),
  });
  expect(res.status()).toBe(409);
  expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe('DEADLINE_PASSED');
  expect(readLocalDb().bookings.filter((b) => b.itemId === program.id)).toHaveLength(0);
});

/* ═══════════════════════ T9 — the money reaches the incubator ═══════════════════════ */

test('T9 — the incubator is credited the online amount less commission', async () => {
  const { program, fields } = await splitPricedTraining();
  const ref = clientRef('t9');

  const res = await cardIntent(guest, {
    target: { itemKind: 'PROGRAM', programId: program.id },
    paymentMode: 'ONLINE_FULL',
    customer: customer('t9'),
    clientReference: ref,
    registrationAnswers: fullAnswers(fields),
  });
  const { token } = (await res.json()) as { token: string };
  await settleCard(guest, token);

  const booking = findBookingByRef(ref)!;
  const txns = readLocalDb().transactions as Array<{ type?: string; amount?: number; reference?: string }>;
  const payout = txns.find((t) => t.reference === `payout-${booking.id}`);
  const commission = txns.find((t) => t.reference === `commission-${booking.id}`);

  // The payout is the ONLINE price — the payer fee is platform revenue and is
  // never credited to the provider.
  expect(payout?.amount).toBe(ONLINE_PRICE);
  expect(commission?.amount).toBe(-booking.commissionAmount!);
  expect(booking.commissionAmount).toBeGreaterThan(0);
  expect(booking.commissionAmount).toBeLessThanOrEqual(ONLINE_PRICE);
});

/* ═══════════════════════ T10 — rate limits fit a real cohort ═══════════════════════ */

test('T10 — a whole cohort behind one carrier IP can register; a script cannot', async () => {
  const program = await createProgram(inc, {
    title: `QA NAT Program ${Date.now()}`,
    price: 0,
    seatsTotal: 30,
  });

  // Algerian mobile carriers put many subscribers behind one NAT address. Ten
  // different people sharing it must all get through — the old 5/IP budget
  // told the sixth "too many attempts".
  const sharedIp = { 'x-forwarded-for': '197.200.5.9' };
  for (let i = 0; i < 10; i++) {
    const res = await guest.post('/api/registrations', {
      headers: sharedIp,
      data: {
        entityType: 'PROGRAM',
        entityId: program.id,
        fullName: `Cohort ${i}`,
        email: `qa.nat.${Date.now()}.${i}@metwork.test`,
        phone: '+213700112233',
        answers: [],
      },
    });
    expect(res.status(), `submission ${i} → ${res.status()}`).toBe(201);
  }

  // One address hammering the endpoint is still stopped, whatever IP it comes
  // from — that is the limit that catches a script.
  const email = `qa.bot.${Date.now()}@metwork.test`;
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) {
    const res = await guest.post('/api/registrations', {
      headers: xff(),
      data: {
        entityType: 'PROGRAM',
        entityId: program.id,
        fullName: 'Bot',
        email,
        phone: '+213700112233',
        answers: [],
      },
    });
    codes.push(res.status());
  }
  expect(codes).toContain(429);
});
