/**
 * Academy Pass — the pieces every other Academy module needs (access, course
 * orders, the Pass service): who holds an active Pass, and granting a paid term.
 * Kept free of imports from orders/pass so those modules never import each
 * other in a loop.
 */
import { randomUUID } from 'node:crypto';
import { computePeriodEnd } from '@/lib/billing-cycles';
import type { PassPlan } from '@/lib/academy';
import type { AcademyPassRecord, AcademyPassSliceRecord, db } from '@/server/db/store';

type StoreDraft = Parameters<Parameters<typeof db.update>[0]>[0];
type Doc = Pick<StoreDraft, 'academyPasses'>;

/** The term covering `now`, if any. */
export function activePass(d: Doc, userId: string, now = new Date()): AcademyPassRecord | null {
  const t = now.toISOString();
  return (d.academyPasses ?? []).find((p) => p.userId === userId && p.status === 'ACTIVE' && p.periodStart <= t && t < p.periodEnd) ?? null;
}

/** The last term (active or queued) — a new term starts when it ends. */
export function latestPass(d: Doc, userId: string): AcademyPassRecord | null {
  return (d.academyPasses ?? [])
    .filter((p) => p.userId === userId && p.status === 'ACTIVE')
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0] ?? null;
}

/** Month slices of a term: one for MONTHLY, twelve for ANNUAL. Amounts split to the dinar, remainder on the last. */
export function buildSlices(plan: PassPlan, start: string, end: string, listPriceDzd: number, amountDzd: number): AcademyPassSliceRecord[] {
  if (plan === 'MONTHLY') return [{ start, end, baseDzd: listPriceDzd, paidDzd: amountDzd, settledAt: null, lines: [] }];
  const slices: AcademyPassSliceRecord[] = [];
  let cursor = start;
  const baseEach = Math.floor(listPriceDzd / 12);
  const paidEach = Math.floor(amountDzd / 12);
  for (let i = 0; i < 12; i++) {
    const next = i === 11 ? end : computePeriodEnd(cursor, 'MONTHLY');
    slices.push({
      start: cursor,
      end: next,
      baseDzd: i === 11 ? listPriceDzd - baseEach * 11 : baseEach,
      paidDzd: i === 11 ? amountDzd - paidEach * 11 : paidEach,
      settledAt: null,
      lines: [],
    });
    cursor = next;
  }
  return slices;
}

export interface GrantPassInput {
  userId: string;
  plan: PassPlan;
  listPriceDzd: number;
  amountDzd: number;
  discount: 'NONE' | 'PREMIUM';
  method: AcademyPassRecord['method'];
  paymentRef: string;
  now?: Date;
  /** Monthly terms renew from the wallet by default; a gifted month never does. */
  autoRenew?: boolean;
}

/**
 * Add a paid term inside an open update. Starts now, or when the member's
 * current term ends (a second payment never wastes days). Idempotent on
 * `paymentRef`.
 */
export function grantPassInDraft(d: StoreDraft, input: GrantPassInput): AcademyPassRecord {
  if (!Array.isArray(d.academyPasses)) d.academyPasses = [];
  const existing = d.academyPasses.find((p) => p.paymentRef === input.paymentRef);
  if (existing) return existing;
  const now = (input.now ?? new Date()).toISOString();
  const latest = latestPass(d, input.userId);
  const start = latest && latest.periodEnd > now ? latest.periodEnd : now;
  const end = computePeriodEnd(start, input.plan === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY');
  // A queued term takes over renewal: the current one must not also charge.
  if (latest && latest.periodEnd > now) latest.autoRenew = false;
  const record: AcademyPassRecord = {
    id: randomUUID(),
    userId: input.userId,
    plan: input.plan,
    status: 'ACTIVE',
    autoRenew: input.autoRenew ?? input.plan === 'MONTHLY',
    periodStart: start,
    periodEnd: end,
    listPriceDzd: input.listPriceDzd,
    amountDzd: input.amountDzd,
    discount: input.discount,
    method: input.method,
    paymentRef: input.paymentRef,
    renewalReminderSentAt: null,
    slices: buildSlices(input.plan, start, end, input.listPriceDzd, input.amountDzd),
    createdAt: now,
  };
  d.academyPasses.push(record);
  return record;
}

/**
 * One month of an incubator seat for its holder, inside an open update: a
 * fixed window (the seat's month, from now if assigned mid-month), never
 * renewing. One slice whose base is the FULL monthly Pass price, so the
 * mentors' share is the Pass's (owner rule). Idempotent on `paymentRef`.
 */
export function grantSeatTermInDraft(
  d: StoreDraft,
  input: { userId: string; start: string; end: string; listPriceDzd: number; amountDzd: number; paymentRef: string; now: string },
): AcademyPassRecord {
  if (!Array.isArray(d.academyPasses)) d.academyPasses = [];
  const existing = d.academyPasses.find((p) => p.paymentRef === input.paymentRef);
  if (existing) return existing;
  const record: AcademyPassRecord = {
    id: randomUUID(),
    userId: input.userId,
    plan: 'MONTHLY',
    status: 'ACTIVE',
    autoRenew: false,
    periodStart: input.start,
    periodEnd: input.end,
    listPriceDzd: input.listPriceDzd,
    amountDzd: input.amountDzd,
    discount: 'NONE',
    method: 'SEAT',
    paymentRef: input.paymentRef,
    renewalReminderSentAt: null,
    slices: [{ start: input.start, end: input.end, baseDzd: input.listPriceDzd, paidDzd: input.amountDzd, settledAt: null, lines: [] }],
    createdAt: input.now,
  };
  d.academyPasses.push(record);
  return record;
}
