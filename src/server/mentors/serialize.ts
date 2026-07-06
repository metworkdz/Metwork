/**
 * Server → client DTO for mentors. The on-disk shape and the wire shape
 * happen to be identical today; this seam exists so they can drift later
 * (e.g. if we add internal fields like createdBy or status) without
 * breaking the API.
 */
import type { MentorRecord } from '@/server/db/store';
import type { Mentor } from '@/types/mentor';

export function toMentorDto(m: MentorRecord): Mentor {
  return {
    id: m.id,
    fullName: m.fullName,
    position: m.position,
    imageUrl: m.imageUrl,
    slug: m.slug,
    bio: m.bio,
    linkedinUrl: m.linkedinUrl,
    email: m.email ?? null,
    // City is PUBLIC (shown pre-booking for in-person sessions). Phone and the
    // exact in-person address are PRIVATE — see `toMentorPrivateDto`.
    city: m.city ?? null,
    consultationFee: m.consultationFee,
    createdAt: m.createdAt,
    weeklyAvailability: m.weeklyAvailability ?? [],
    blockedDates: m.blockedDates ?? [],
    availabilityTimezone: m.availabilityTimezone ?? 'Africa/Algiers',
    defaultMeetingMode: m.defaultMeetingMode,
    defaultMeetingLink: m.defaultMeetingLink ?? null,
    // Booking policy — public-safe. PII (the PIN hash), the consultant phone,
    // and the exact in-person address are NEVER serialized here.
    minNoticeHours: m.minNoticeHours ?? null,
    bufferMinutes: m.bufferMinutes ?? null,
    topics: m.topics ?? [],
    ratePer30: m.ratePer30 ?? null,
    ratePer60: m.ratePer60 ?? null,
    freeIntroEnabled: m.freeIntroEnabled ?? false,
  };
}

/**
 * Consultant-self / admin DTO: the public mentor shape PLUS the private contact
 * fields (phone) and in-person defaults (address + Google Maps link). Use ONLY
 * on authenticated consultant-self (`/api/consultant/*`) and admin endpoints —
 * NEVER on the public `/api/mentors` routes, which must keep using `toMentorDto`.
 */
export function toMentorPrivateDto(m: MentorRecord): Mentor {
  return {
    ...toMentorDto(m),
    phone: m.phone ?? null,
    defaultMeetingAddress: m.defaultMeetingAddress ?? null,
    defaultMeetingMapsLink: m.defaultMeetingMapsLink ?? null,
    // Approval gate — absent ⇒ APPROVED (legacy admin-added mentors).
    approvalStatus: m.approvalStatus ?? 'APPROVED',
    approvalRejectionReason: m.approvalRejectionReason ?? null,
    cvUrl: m.cvUrl ?? null,
  };
}
