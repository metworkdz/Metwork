/**
 * Startup Academy settings — the Pass price, the discounts, the mentors'
 * default share and the certificate stamp. ONE reader (`getAcademySettings`)
 * so every price on every page comes from the same numbers.
 *
 * Absent settings read as ACADEMY_DEFAULTS; nothing is written on read.
 */
import { db, type AcademyFieldRecord, type AcademySettingsRecord } from '@/server/db/store';
import { appendAuditLog } from '@/server/audit/service';
import {
  ACADEMY_DEFAULTS,
  ACADEMY_DEFAULT_FIELDS,
  ACADEMY_MAX_PRICE_DZD,
  isValidRate,
  type AcademyPricing,
} from '@/lib/academy';

export function defaultAcademySettings(): AcademySettingsRecord {
  return { ...ACADEMY_DEFAULTS, certificateStampUrl: null, updatedAt: new Date(0).toISOString(), updatedBy: null };
}

/** Stored settings over the defaults, so a field added later still has a value. */
function withDefaults(stored: Partial<AcademySettingsRecord> | null | undefined): AcademySettingsRecord {
  const base = defaultAcademySettings();
  if (!stored) return base;
  return {
    passMonthlyPriceDzd: isValidPrice(stored.passMonthlyPriceDzd) ? stored.passMonthlyPriceDzd : base.passMonthlyPriceDzd,
    passAnnualDiscountRate: isValidRate(stored.passAnnualDiscountRate) ? stored.passAnnualDiscountRate : base.passAnnualDiscountRate,
    premiumDiscountRate: isValidRate(stored.premiumDiscountRate) ? stored.premiumDiscountRate : base.premiumDiscountRate,
    defaultMentorShareRate: isValidRate(stored.defaultMentorShareRate) ? stored.defaultMentorShareRate : base.defaultMentorShareRate,
    certificateStampUrl: typeof stored.certificateStampUrl === 'string' && stored.certificateStampUrl ? stored.certificateStampUrl : null,
    addendumTemplate: typeof stored.addendumTemplate === 'string' && stored.addendumTemplate.trim() ? stored.addendumTemplate : null,
    updatedAt: stored.updatedAt ?? base.updatedAt,
    updatedBy: stored.updatedBy ?? null,
  };
}

function isValidPrice(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= ACADEMY_MAX_PRICE_DZD;
}

export async function getAcademySettings(): Promise<AcademySettingsRecord> {
  const d = await db.read();
  return withDefaults(d.academySettings);
}

export async function getAcademyPricing(): Promise<AcademyPricing> {
  const s = await getAcademySettings();
  return {
    passMonthlyPriceDzd: s.passMonthlyPriceDzd,
    passAnnualDiscountRate: s.passAnnualDiscountRate,
    premiumDiscountRate: s.premiumDiscountRate,
    defaultMentorShareRate: s.defaultMentorShareRate,
  };
}

export type AcademySettingsPatch = Partial<Pick<AcademySettingsRecord,
  'passMonthlyPriceDzd' | 'passAnnualDiscountRate' | 'premiumDiscountRate' | 'defaultMentorShareRate' | 'certificateStampUrl' | 'addendumTemplate'>>;

export type UpdateSettingsResult =
  | { ok: true; settings: AcademySettingsRecord }
  | { ok: false; code: 'INVALID_PRICE' | 'INVALID_RATE' | 'INVALID_STAMP_URL' };

/** The stamp is drawn into certificate PDFs, whose image fetcher only reads Cloudinary. */
function isCloudinaryUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname === 'res.cloudinary.com';
  } catch { return false; }
}

/**
 * Change the settings. New prices and shares apply to purchases and statements
 * made after the save; sales already made keep the numbers frozen on them.
 */
export async function updateAcademySettings(
  patch: AcademySettingsPatch,
  admin: { id: string; email: string },
): Promise<UpdateSettingsResult> {
  // Validate everything before touching the store: db.update has no rollback.
  if (patch.passMonthlyPriceDzd !== undefined && !isValidPrice(patch.passMonthlyPriceDzd)) return { ok: false, code: 'INVALID_PRICE' };
  for (const k of ['passAnnualDiscountRate', 'premiumDiscountRate', 'defaultMentorShareRate'] as const) {
    if (patch[k] !== undefined && !isValidRate(patch[k])) return { ok: false, code: 'INVALID_RATE' };
  }
  if (patch.certificateStampUrl !== undefined && patch.certificateStampUrl !== null && !isCloudinaryUrl(patch.certificateStampUrl)) {
    return { ok: false, code: 'INVALID_STAMP_URL' };
  }

  const before = await getAcademySettings();
  const settings = await db.update((d) => {
    const next: AcademySettingsRecord = {
      ...withDefaults(d.academySettings),
      ...patch,
      updatedAt: new Date().toISOString(),
      updatedBy: admin.id,
    };
    d.academySettings = next;
    return next;
  });

  void appendAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'ACADEMY_SETTINGS_UPDATED',
    targetType: 'ACADEMY_SETTINGS',
    targetId: 'academy',
    details: { before: pickPatched(before, patch), after: pickPatched(settings, patch) },
  });
  return { ok: true, settings };
}

function pickPatched(s: AcademySettingsRecord, patch: AcademySettingsPatch): Record<string, unknown> {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, s[k as keyof AcademySettingsRecord]]));
}

export type SetShareResult = { ok: true } | { ok: false; code: 'INVALID_RATE' | 'MENTOR_NOT_FOUND' };

/** Set (or clear with null) one mentor's share override. */
export async function setMentorAcademyShare(
  mentorId: string,
  rate: number | null,
  admin: { id: string; email: string },
): Promise<SetShareResult> {
  if (rate !== null && !isValidRate(rate)) return { ok: false, code: 'INVALID_RATE' };
  const previous = await db.update((d) => {
    const m = d.mentors.find((x) => x.id === mentorId);
    if (!m) return undefined;
    const prev = m.academyShareRate ?? null;
    m.academyShareRate = rate;
    return { prev };
  });
  if (!previous) return { ok: false, code: 'MENTOR_NOT_FOUND' };
  void appendAuditLog({
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'ACADEMY_MENTOR_SHARE_UPDATED',
    targetType: 'MENTOR',
    targetId: mentorId,
    details: { before: previous.prev, after: rate },
  });
  return { ok: true };
}

/* ─────────────────────────── Fields ─────────────────────────── */

export function defaultAcademyFields(): AcademyFieldRecord[] {
  return ACADEMY_DEFAULT_FIELDS.map((id, i) => ({ id, label: null, order: i, hidden: false }));
}

/** Fields in display order. The built-in list until an admin saves their own. */
export async function listAcademyFields(opts: { includeHidden?: boolean } = {}): Promise<AcademyFieldRecord[]> {
  const d = await db.read();
  const stored = Array.isArray(d.academyFields) && d.academyFields.length ? d.academyFields : defaultAcademyFields();
  return [...stored]
    .filter((f) => opts.includeHidden || !f.hidden)
    .sort((a, b) => a.order - b.order);
}
