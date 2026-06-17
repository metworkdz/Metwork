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
  /** Per-session fee in DZD. 0 or absent = free. */
  consultationFee?: number;
  createdAt: string;

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
}

export interface MentorInput {
  fullName: string;
  position: string;
  imageUrl: string;
  bio?: string | null;
  linkedinUrl?: string | null;
  email?: string | null;
  consultationFee?: number;
}

export interface UploadedFile {
  url: string;
  filename: string;
  size: number;
}
