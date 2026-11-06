/**
 * Learning paths sold as bundles (owner decision 2026-11-02): the admin
 * builds a path from published courses and sets one price. Each mentor earns
 * their share of their course's FULL list price — Metwork absorbs the bundle
 * discount, as it does the Premium one.
 *
 * Buying a bundle creates one enrollment per course, each carrying its part of
 * the price by list-price weight, so the usual per-course refund rule applies.
 * A course the buyer already owns is not charged: the price scales down by its
 * list-price weight. The bundle price is not combined with the Premium
 * discount; the referral discount (first purchase) does apply.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type AcademyBundleItem, type AcademyBundleRecord, type AcademyOrderRecord } from '@/server/db/store';
import {
  ACADEMY_MAX_PRICE_DZD,
  ACADEMY_MIN_COURSE_PRICE_DZD,
  allocateBundle,
  canBuyAcademy,
  mentorShareRate,
} from '@/lib/academy';
import { isLocalizedText, resolveText, type LocalizedText } from '@/lib/localized-text';
import { slugify, uniqueSlug } from '@/lib/slugify';
import { getAcademyPricing } from './settings';
import { activeEnrollment, afterOrderSettled, openCardCheckout, payOrderFromWalletInDraft, type Buyer } from './orders';
import { applyReferralToOrder } from './referral';
import { listPublicCourses, type PublicCourseCard } from './catalog';

type StoreData = Awaited<ReturnType<typeof db.read>>;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const localized = (max: number) =>
  z.custom<LocalizedText>((v) => isLocalizedText(v) && Object.values(v as unknown as Record<string, unknown>).every((x) => typeof x !== 'string' || x.length <= max), { message: 'Invalid localized text' });

export const bundleInputSchema = z.object({
  title: localized(120),
  description: localized(3000).nullable().default(null),
  courseIds: z.array(z.string().regex(ID_RE)).min(2).max(12),
  priceDzd: z.number().int(),
});
export type BundleInput = z.infer<typeof bundleInputSchema>;

export type BundleError = 'NOT_FOUND' | 'COURSE_NOT_PUBLISHED' | 'PRICE_INVALID' | 'PRICE_BELOW_SHARES' | 'DUPLICATE_COURSE';

/** What the mentors would earn on one sale, at today's shares — the floor of a bundle price. */
function mentorsTotal(d: StoreData, courseIds: string[], defaultRate: Parameters<typeof mentorShareRate>[1]): number {
  let total = 0;
  for (const id of courseIds) {
    const c = d.academyCourses?.find((x) => x.id === id);
    if (!c) continue;
    for (const mid of c.mentorIds) total += (c.priceDzd / (c.mentorIds.length || 1)) * mentorShareRate(d.mentors.find((m) => m.id === mid), defaultRate);
  }
  return Math.ceil(total);
}

async function checkBundle(input: BundleInput): Promise<BundleError | null> {
  if (new Set(input.courseIds).size !== input.courseIds.length) return 'DUPLICATE_COURSE';
  const [d, pricing] = await Promise.all([db.read(), getAcademyPricing()]);
  const courses = input.courseIds.map((id) => d.academyCourses?.find((c) => c.id === id));
  if (courses.some((c) => !c || c.status !== 'PUBLISHED')) return 'COURSE_NOT_PUBLISHED';
  const listTotal = courses.reduce((s, c) => s + (c?.priceDzd ?? 0), 0);
  if (input.priceDzd < ACADEMY_MIN_COURSE_PRICE_DZD || input.priceDzd > Math.min(listTotal, ACADEMY_MAX_PRICE_DZD)) return 'PRICE_INVALID';
  // Metwork absorbs the discount, but never sells below what it owes the mentors.
  if (input.priceDzd < mentorsTotal(d, input.courseIds, pricing)) return 'PRICE_BELOW_SHARES';
  return null;
}

export async function createBundle(input: BundleInput): Promise<{ ok: true; bundle: AcademyBundleRecord } | { ok: false; code: BundleError }> {
  const err = await checkBundle(input);
  if (err) return { ok: false, code: err };
  const now = new Date().toISOString();
  const bundle = await db.update((d) => {
    if (!Array.isArray(d.academyBundles)) d.academyBundles = [];
    const b: AcademyBundleRecord = {
      id: randomUUID(),
      slug: uniqueSlug(slugify(resolveText(input.title, input.title.source)) || 'parcours', d.academyBundles.map((x) => x.slug)),
      title: input.title,
      description: input.description,
      courseIds: input.courseIds,
      priceDzd: input.priceDzd,
      status: 'DRAFT',
      createdAt: now,
      updatedAt: now,
    };
    d.academyBundles.push(b);
    return b;
  });
  return { ok: true, bundle };
}

export async function updateBundle(id: string, input: BundleInput & { status: AcademyBundleRecord['status'] }): Promise<{ ok: true; bundle: AcademyBundleRecord } | { ok: false; code: BundleError }> {
  // An archived bundle can be edited freely; anything else must still be sellable.
  if (input.status !== 'ARCHIVED') {
    const err = await checkBundle(input);
    if (err) return { ok: false, code: err };
  }
  const bundle = await db.update((d) => {
    const b = d.academyBundles?.find((x) => x.id === id);
    if (!b) return null;
    Object.assign(b, { title: input.title, description: input.description, courseIds: input.courseIds, priceDzd: input.priceDzd, status: input.status, updatedAt: new Date().toISOString() });
    return b;
  });
  return bundle ? { ok: true, bundle } : { ok: false, code: 'NOT_FOUND' };
}

export async function listBundlesForAdmin(): Promise<AcademyBundleRecord[]> {
  return [...((await db.read()).academyBundles ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/* ─────────────────────────── Public ─────────────────────────── */

export interface PublicBundle {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceDzd: number;
  listTotalDzd: number;
  courses: PublicCourseCard[];
}

/** A bundle is sellable only while every course in it is published. */
function sellable(d: StoreData, b: AcademyBundleRecord): boolean {
  return b.status === 'PUBLISHED' && b.courseIds.every((id) => d.academyCourses?.some((c) => c.id === id && c.status === 'PUBLISHED'));
}

export async function listPublicBundles(locale: string): Promise<PublicBundle[]> {
  const [d, cards] = await Promise.all([db.read(), listPublicCourses(locale)]);
  return (d.academyBundles ?? []).filter((b) => sellable(d, b)).map((b) => {
    const courses = b.courseIds.map((id) => cards.find((c) => c.id === id)).filter((c): c is PublicCourseCard => Boolean(c));
    return {
      id: b.id,
      slug: b.slug,
      title: resolveText(b.title, locale),
      description: resolveText(b.description, locale),
      priceDzd: b.priceDzd,
      listTotalDzd: courses.reduce((s, c) => s + c.priceDzd, 0),
      courses,
    };
  });
}

export async function getPublicBundle(slug: string, locale: string): Promise<PublicBundle | null> {
  return (await listPublicBundles(locale)).find((b) => b.slug === slug) ?? null;
}

export interface BundleQuote {
  bundle: AcademyBundleRecord;
  /** Courses still to buy (owned ones are left out and not charged). */
  items: AcademyBundleItem[];
  ownedCourseIds: string[];
  listTotalDzd: number;
  amountDzd: number;
}

/** What this buyer pays for the bundle: its price, scaled down for courses they already own. */
export async function quoteBundle(user: Pick<Buyer, 'id'> | null, slug: string): Promise<{ ok: true; quote: BundleQuote } | { ok: false; code: 'BUNDLE_NOT_FOUND' | 'ALREADY_OWNED' }> {
  const [d, pricing] = await Promise.all([db.read(), getAcademyPricing()]);
  const bundle = d.academyBundles?.find((b) => b.slug === slug);
  if (!bundle || !sellable(d, bundle)) return { ok: false, code: 'BUNDLE_NOT_FOUND' };
  const courses = bundle.courseIds.map((id) => d.academyCourses!.find((c) => c.id === id)!);
  const listTotalDzd = courses.reduce((s, c) => s + c.priceDzd, 0);
  const owned = user ? courses.filter((c) => activeEnrollment(d.academyEnrollments, user.id, c.id)).map((c) => c.id) : [];
  const toBuy = courses.filter((c) => !owned.includes(c.id));
  if (!toBuy.length) return { ok: false, code: 'ALREADY_OWNED' };
  const remainingList = toBuy.reduce((s, c) => s + c.priceDzd, 0);
  const amountDzd = Math.round((bundle.priceDzd * remainingList) / listTotalDzd);
  const parts = allocateBundle(amountDzd, toBuy.map((c) => c.priceDzd));
  return {
    ok: true,
    quote: {
      bundle,
      ownedCourseIds: owned,
      listTotalDzd,
      amountDzd,
      items: toBuy.map((c, i) => ({
        courseId: c.id,
        listPriceDzd: c.priceDzd,
        amountDzd: parts[i]!,
        mentorShares: c.mentorIds.map((id) => ({ mentorId: id, rate: mentorShareRate(d.mentors.find((m) => m.id === id), pricing) })),
      })),
    },
  };
}

export type StartBundleResult =
  | { ok: true; state: 'PAID'; orderId: string }
  | { ok: true; state: 'REDIRECT'; orderId: string; redirectUrl: string }
  | { ok: false; code: 'NOT_A_BUYER' | 'BUNDLE_NOT_FOUND' | 'ALREADY_OWNED' | 'WALLET_FROZEN' | 'PROVIDER_FAILED' }
  | { ok: false; code: 'INSUFFICIENT_FUNDS'; balance: number; required: number };

export async function startBundlePurchase(input: {
  user: Buyer; bundleSlug: string; method: 'WALLET' | 'CARD'; clientReference: string; appBaseUrl: string; locale: string; referralCode?: string | null;
}): Promise<StartBundleResult> {
  const { user } = input;
  if (!canBuyAcademy(user.role)) return { ok: false, code: 'NOT_A_BUYER' };
  const d0 = await db.read();
  const replay = (d0.academyOrders ?? []).find((o) => o.userId === user.id && o.clientReference === input.clientReference);
  if (replay) {
    if (replay.status === 'PAID') return { ok: true, state: 'PAID', orderId: replay.id };
    if (replay.redirectUrl) return { ok: true, state: 'REDIRECT', orderId: replay.id, redirectUrl: replay.redirectUrl };
    return { ok: false, code: 'PROVIDER_FAILED' };
  }
  const q = await quoteBundle(user, input.bundleSlug);
  if (!q.ok) return q;
  const { quote } = q;
  const order: AcademyOrderRecord = {
    id: randomUUID(),
    kind: 'BUNDLE',
    bundleId: quote.bundle.id,
    bundleItems: quote.items,
    userId: user.id,
    courseId: '',
    clientReference: input.clientReference,
    listPriceDzd: quote.items.reduce((s, i) => s + i.listPriceDzd, 0),
    amountDzd: quote.amountDzd,
    discount: 'NONE',
    mentorShares: [],
    method: input.method,
    providerRef: null,
    redirectUrl: null,
    status: 'PENDING',
    enrollmentId: null,
    createdAt: new Date().toISOString(),
    paidAt: null,
  };
  await applyReferralToOrder(order, user, input.referralCode);
  const label = `Startup Academy — ${resolveText(quote.bundle.title, 'fr')}`;
  if (input.method === 'WALLET') {
    const result = await db.update((d) => payOrderFromWalletInDraft(d, order, label));
    if (!result.ok) return result;
    await afterOrderSettled(result.outcome);
    return { ok: true, state: 'PAID', orderId: order.id };
  }
  const card = await openCardCheckout(order, user, input.appBaseUrl, input.locale, label);
  if (!card.ok) return card;
  return card.state === 'PAID' ? { ok: true, state: 'PAID', orderId: order.id } : { ok: true, state: 'REDIRECT', orderId: order.id, redirectUrl: card.redirectUrl };
}
