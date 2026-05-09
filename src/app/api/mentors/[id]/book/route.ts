/**
 * POST /api/mentors/:id/book
 * Submit a consultation booking request for a specific mentor.
 * Requires authentication.
 *
 * Status flow:
 *   PENDING → admin reviews → APPROVED (confirmation email sent) | REJECTED
 *
 * This route only creates the PENDING request and notifies the admin.
 * Approval/rejection is handled by PATCH /api/admin/mentor-bookings/:id.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { sendConsultationRequestReceivedEmail, sendAdminConsultationNotification } from '@/server/notifications/mock';
import { validatePromoCode, promoAppliesToType } from '@/server/promo-codes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_ADVANCE_HOURS = 24;

const schema = z.object({
  name:    z.string().min(2).max(120),
  email:   z.string().email().max(200),
  phone:   z.string().min(6).max(30),
  message: z.string().min(10).max(1000),
  /** Requested date for the consultation (YYYY-MM-DD) */
  consultationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  /** Requested start time (HH:MM) */
  consultationTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  /** Duration in minutes: 30 | 60 | 90 | 120 | 150 | 180 */
  durationMinutes: z.number().int().min(30).max(180).optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id: mentorId } = await params;
  const mentor = await findMentorById(mentorId);
  if (!mentor) return jsonError(404, 'NOT_FOUND', 'Mentor not found');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Enforce 24-hour advance booking
  const scheduled = new Date(input.scheduledAt);
  const minTime = new Date(Date.now() + MIN_ADVANCE_HOURS * 60 * 60 * 1000);
  if (scheduled < minTime) {
    return jsonError(422, 'TOO_SOON', `Consultations must be booked at least ${MIN_ADVANCE_HOURS} hours in advance`);
  }

  // Validate promo code if provided
  let discountPercent = 0;
  let appliedPromoCode: string | null = null;

  if (input.promoCode) {
    const validation = await validatePromoCode(input.promoCode);
    if (!validation.valid) {
      const msgs: Record<string, string> = {
        NOT_FOUND:    'Promo code not found',
        INACTIVE:     'Promo code is no longer active',
        EXPIRED:      'Promo code has expired',
        LIMIT_REACHED:'Promo code has reached its usage limit',
      };
      return jsonError(422, 'INVALID_PROMO_CODE', msgs[validation.reason] ?? 'Invalid promo code');
    }
    if (!promoAppliesToType(validation.promoCode, 'CONSULTATION')) {
      return jsonError(422, 'INVALID_PROMO_CODE', 'This promo code does not apply to consultations');
    }
    discountPercent  = validation.discountPercent;
    appliedPromoCode = validation.promoCode.code;
  }

  const now = new Date().toISOString();
  const booking = await db.update((d) => {
    const record = {
      id:               randomUUID(),
      mentorId,
      userId:           guard.user.id,
      userName:         input.name,
      userEmail:        input.email,
      userPhone:        input.phone,
      message:          input.message,
      consultationDate: input.consultationDate ?? null,
      consultationTime: input.consultationTime ?? null,
      durationMinutes:  input.durationMinutes  ?? null,
      status:           'PENDING' as const,
      adminNote:        null,
      createdAt:        now,
      updatedAt:        now,
    };
    if (!Array.isArray(d.mentorBookings)) d.mentorBookings = [];
    d.mentorBookings.push(record);
    return record;
  });

  // 1. Tell the client their request is received and pending review (NOT a confirmation)
  const data = await db.read();
  const user = data.users.find((u) => u.id === guard.user.id);
  const lang = user?.locale === 'en' ? 'en' : 'fr';
  sendConsultationRequestReceivedEmail({ booking, mentor, lang });

  // 2. Notify the admin that a new consultation request arrived
  sendAdminConsultationNotification({ booking, mentor, lang });

  return json({ id: booking.id, status: booking.status }, { status: 201 });
}
