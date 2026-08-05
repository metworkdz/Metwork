/** Default IANA timezone for mentor availability when none is set. */
export const DEFAULT_AVAILABILITY_TIMEZONE = 'Africa/Algiers';

/** A single bookable time range within a day. Times are "HH:MM" 24-hour, mentor's local time. */
export interface AvailabilityTimeRange {
  start: string;
  end: string;
}

/** Recurring weekly availability for one weekday. */
export interface WeeklyAvailabilityDay {
  /** 0 = Sunday, 1 = Monday … 6 = Saturday. */
  weekday: number;
  slots: AvailabilityTimeRange[];
}

/** A concrete, computed slot for a specific day. Consumed by the time-slot picker. */
export interface DaySlot {
  start: string;
  end: string;
  available: boolean;
}

/**
 * A bookable slot produced by the shared `computeBookableSlots` validator —
 * the weekly template minus existing bookings, buffer padding, the
 * min-notice window, and any active slot-lock. Carries the concrete date so a
 * caller (public booking route, consultant view, reschedule) can act on it
 * directly. Only `available` slots are safe to offer.
 */
export interface BookableSlot {
  /** "YYYY-MM-DD" in the mentor's local time. */
  date: string;
  /** "HH:MM" start (mentor local time). */
  start: string;
  /** "HH:MM" end (mentor local time). */
  end: string;
  available: boolean;
}

/** Payload accepted by the admin availability PATCH endpoint. */
export interface MentorAvailabilityInput {
  weeklyAvailability: WeeklyAvailabilityDay[];
  blockedDates: string[];
  availabilityTimezone?: string;
}

/**
 * Client-facing Mentor DTO. Returned by `GET /api/mentors` and the
 * admin CRUD endpoints.
 */
export interface Mentor {
  id: string;
  fullName: string;
  position: string;
  imageUrl: string;
  /** SEO-friendly URL slug. May be absent for mentors created before slugs existed — fall back to `id` in routes. */
  slug?: string;
  bio: string | null;
  linkedinUrl: string | null;
  /** Contact email for consultation notifications. */
  email?: string | null;
  /**
   * Consultant WhatsApp/contact phone. PRIVATE — only populated by the
   * consultant-self / admin DTO, never the public mentor list/profile.
   */
  phone?: string | null;
  /** Consultant's city — PUBLIC (shown pre-booking for in-person sessions). */
  city?: string | null;
  /** Consultation domain (e.g. "Fiscalité") — PUBLIC. Distinct from `topics` tags. */
  field?: string | null;
  /**
   * Canonical profile picture. Always populated by the serializer
   * (falls back to `imageUrl` for legacy records) — prefer this over
   * `imageUrl` in new UI.
   */
  avatarUrl?: string | null;
  /** Per-session fee in DZD. 0 or absent = free. */
  consultationFee?: number;
  createdAt: string;
  /** ISO timestamp of the last mutation. Absent on untouched legacy records. */
  updatedAt?: string;

  // ─── Availability (Airbnb-style scheduling) — all optional for back-compat ───
  /** Recurring weekly template, mentor's local time. */
  weeklyAvailability?: WeeklyAvailabilityDay[];
  /** Specific dates the mentor is unavailable (YYYY-MM-DD). Overrides the weekly template. */
  blockedDates?: string[];
  /** IANA timezone for the weekly template. Defaults to "Africa/Algiers". */
  availabilityTimezone?: string;

  /** Default session format for instant-book consultations. */
  defaultMeetingMode?: 'ONLINE' | 'OFFLINE';
  /** Default online meeting URL. Null/absent ⇒ none. */
  defaultMeetingLink?: string | null;
  /** Default in-person address (PRIVATE — consultant-self / admin DTO only). */
  defaultMeetingAddress?: string | null;
  /** Default Google Maps link for the in-person address (PRIVATE). */
  defaultMeetingMapsLink?: string | null;

  // ─── Booking policy (public-safe, all optional for back-compat) ───────────
  /** Minimum lead time (hours) before a session. Absent ⇒ validator default. */
  minNoticeHours?: number | null;
  /** Buffer padding (minutes) around each booking. Absent ⇒ validator default. */
  bufferMinutes?: number | null;
  /** Expertise tags shown on the public profile. */
  topics?: string[];
  /** Admin-assigned category ids (`MentorCategoryRecord.id`). Absent ⇒ []. */
  categoryIds?: string[];
  /** Explicit 30-minute session price (DZD). Absent ⇒ prorated from per-hour. */
  ratePer30?: number | null;
  /** Explicit 60-minute session price (DZD). Absent ⇒ prorated from per-hour. */
  ratePer60?: number | null;
  /** True if a free introductory session is offered. */
  freeIntroEnabled?: boolean | null;

  // ─── Self-signup approval (consultant-self / admin DTO only) ───
  /** Approval state. Absent ⇒ APPROVED (legacy admin-added mentors). */
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  /** Rejection reason shown to the consultant (REJECTED only). */
  approvalRejectionReason?: string | null;
  /** Uploaded CV URL (PRIVATE — consultant-self / admin DTO only). */
  cvUrl?: string | null;
  /** Record origin (PRIVATE — consultant-self / admin DTO only). Absent ⇒ 'ADMIN'. */
  source?: 'ADMIN' | 'SELF';
  /** Public-list visibility (PRIVATE DTO only; the public list is already filtered). */
  publiclyListed?: boolean;
  /** Phone verification state (PRIVATE — consultant-self / admin DTO only). */
  phoneVerified?: boolean;
}

export interface MentorInput {
  fullName: string;
  position: string;
  imageUrl: string;
  bio?: string | null;
  linkedinUrl?: string | null;
  email?: string | null;
  /** Consultant WhatsApp/contact phone. Optional in the admin form. */
  phone?: string | null;
  /** Consultant's city (public). */
  city?: string | null;
  consultationFee?: number;
  minNoticeHours?: number | null;
  bufferMinutes?: number | null;
  topics?: string[];
  /** Admin-assigned category ids (`MentorCategoryRecord.id`). */
  categoryIds?: string[];
  ratePer30?: number | null;
  ratePer60?: number | null;
  freeIntroEnabled?: boolean | null;
}

export interface UploadedFile {
  url: string;
  filename: string;
  size: number;
}
