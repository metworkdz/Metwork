/**
 * Server-side request schemas for mentor admin endpoints. Reused on the
 * client by importing from `@/types/mentor` (the inferred type).
 */
import { z } from 'zod';

const urlOrPath = z.string().min(1).refine(
  (v) => /^(https?:\/\/|\/)/.test(v),
  { message: 'mustBeUrlOrAbsolutePath' },
);

export const createMentorSchema = z.object({
  fullName: z.string().min(2).max(120),
  position: z.string().min(2).max(160),
  imageUrl: urlOrPath,
  bio: z.string().max(2000).optional().nullable(),
  linkedinUrl: z.string().url().max(300).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  consultationFee: z.number().int().min(0).max(1_000_000).optional(),
  // ─── Booking policy (additive, all optional/nullable) ──────────────────
  minNoticeHours: z.number().int().min(0).max(720).optional().nullable(),
  bufferMinutes: z.number().int().min(0).max(240).optional().nullable(),
  topics: z.array(z.string().min(1).max(60)).max(20).optional(),
  ratePer30: z.number().int().min(0).max(1_000_000).optional().nullable(),
  ratePer60: z.number().int().min(0).max(1_000_000).optional().nullable(),
  freeIntroEnabled: z.boolean().optional().nullable(),
});
export type CreateMentorInput = z.infer<typeof createMentorSchema>;

/** All fields optional; partial update semantics. */
export const updateMentorSchema = createMentorSchema.partial();
export type UpdateMentorInput = z.infer<typeof updateMentorSchema>;

/* ─────────────────────────── Availability ─────────────────────────── */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'invalidTime' });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalidDate' });

const timeRangeSchema = z.object({ start: hhmm, end: hhmm });

const weeklyDaySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  slots: z.array(timeRangeSchema).max(24),
});

function toMin(hhmmStr: string): number {
  const [h, m] = hhmmStr.split(':').map(Number);
  return h! * 60 + m!;
}

/** Base availability shape, shared by the admin and consultant-facing schemas. */
const availabilityObject = z.object({
  weeklyAvailability: z.array(weeklyDaySchema).max(7),
  blockedDates: z.array(isoDate).max(366),
  availabilityTimezone: z.string().min(1).max(64).optional(),
});

/**
 * The business rules the basic field validators can't express: end > start, no
 * overlapping ranges within a weekday, no duplicate weekday entries, and a real
 * IANA timezone. Extracted so the admin and consultant schemas share one source
 * of truth. Reads only the availability fields, so it is safe to apply to a
 * superset object (the consultant schema also carries notice/buffer).
 */
function refineAvailability(
  val: { weeklyAvailability: { weekday: number; slots: { start: string; end: string }[] }[]; availabilityTimezone?: string },
  ctx: z.RefinementCtx,
): void {
  const seenWeekdays = new Set<number>();
  val.weeklyAvailability.forEach((day, di) => {
    if (seenWeekdays.has(day.weekday)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weeklyAvailability', di, 'weekday'],
        message: 'duplicateWeekday',
      });
    }
    seenWeekdays.add(day.weekday);

    const intervals = day.slots.map((s, si) => ({ start: toMin(s.start), end: toMin(s.end), si }));
    for (const iv of intervals) {
      if (iv.end <= iv.start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['weeklyAvailability', di, 'slots', iv.si, 'end'],
          message: 'endBeforeStart',
        });
      }
    }
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    for (let k = 1; k < sorted.length; k++) {
      if (sorted[k]!.start < sorted[k - 1]!.end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['weeklyAvailability', di, 'slots'],
          message: 'overlap',
        });
        break;
      }
    }
  });

  if (val.availabilityTimezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: val.availabilityTimezone });
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['availabilityTimezone'],
        message: 'invalidTimezone',
      });
    }
  }
}

/** Admin availability payload. */
export const mentorAvailabilitySchema = availabilityObject.superRefine(refineAvailability);
export type MentorAvailabilityPatch = z.infer<typeof mentorAvailabilitySchema>;

/* ───────────────── Consultant self-service (PROMPT 4) ─────────────────
 * Thin schemas the consultant portal posts to. They reuse the exact same
 * field validators/rules as the admin paths — no new financial logic — and
 * route through the existing `updateMentor*` service functions. All fields
 * stay nullable/optional for back-compat.
 */

/**
 * The consultant's own availability editor: the weekly template + blocked
 * dates + timezone (same rules as admin) plus the two booking-policy knobs the
 * editor exposes (min-notice hours, buffer minutes).
 */
export const consultantAvailabilitySchema = availabilityObject
  .extend({
    minNoticeHours: z.number().int().min(0).max(720).nullable().optional(),
    bufferMinutes: z.number().int().min(0).max(240).nullable().optional(),
  })
  .superRefine(refineAvailability);
export type ConsultantAvailabilityPatch = z.infer<typeof consultantAvailabilitySchema>;

/**
 * The consultant's own profile editor: bio, expertise topics, the display-only
 * 30/60-min rates, the free-intro flag, and the instant-book meeting defaults.
 * NOTE: the live per-hour `consultationFee` is intentionally NOT editable here —
 * it stays admin-controlled because it drives what clients are actually charged.
 */
export const consultantProfileSchema = z.object({
  bio: z.string().max(2000).nullable().optional(),
  topics: z.array(z.string().min(1).max(60)).max(20).optional(),
  ratePer30: z.number().int().min(0).max(1_000_000).nullable().optional(),
  ratePer60: z.number().int().min(0).max(1_000_000).nullable().optional(),
  freeIntroEnabled: z.boolean().nullable().optional(),
  defaultMeetingMode: z.enum(['ONLINE', 'OFFLINE']).optional(),
  defaultMeetingLink: z.string().url().max(500).nullable().optional(),
});
export type ConsultantProfilePatch = z.infer<typeof consultantProfileSchema>;
