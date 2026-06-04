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

/**
 * Admin availability payload. `superRefine` enforces the business rules the
 * basic field validators can't express: end > start, no overlapping ranges
 * within a weekday, no duplicate weekday entries, and a real IANA timezone.
 */
export const mentorAvailabilitySchema = z
  .object({
    weeklyAvailability: z.array(weeklyDaySchema).max(7),
    blockedDates: z.array(isoDate).max(366),
    availabilityTimezone: z.string().min(1).max(64).optional(),
  })
  .superRefine((val, ctx) => {
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
  });
export type MentorAvailabilityPatch = z.infer<typeof mentorAvailabilitySchema>;
