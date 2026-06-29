/**
 * Shared domain types — frontend mirrors of backend models.
 * Kept in sync manually (or via codegen against the backend OpenAPI spec).
 */

export type Locale = 'en' | 'fr' | 'ar';

export interface Money {
  amount: number;
  currency: 'DZD';
}

/** Accepted client payment methods on a booking. */
export type PaymentMethod = 'ONLINE' | 'CASH';

/**
 * Cash-deposit kind for listings that accept CASH. PERCENT → value is 1–100
 * (percent of total); FIXED → value is an integer-DZD amount. Paid online by
 * card; the remaining balance is settled in cash with the incubator.
 */
export type CashDepositType = 'FIXED' | 'PERCENT';

export type SpaceCategory = 'COWORKING' | 'PRIVATE_OFFICE' | 'TRAINING_ROOM' | 'DOMICILIATION';

export interface Space {
  id: string;
  incubatorId: string;
  incubatorName: string;
  name: string;
  description: string;
  category: SpaceCategory;
  city: string;
  imageUrl: string | null;
  /** Ordered gallery; imageUrls[0] is the cover (kept in sync with imageUrl). Backfilled from imageUrl for legacy records. */
  imageUrls?: string[];
  pricePerHour: number | null;
  pricePerDay: number | null;
  pricePerMonth: number | null;
  /** Optional flat half-day price + incubator-configured window ("HH:MM"). */
  pricePerHalfDay?: number | null;
  halfDayStart?: string;
  halfDayEnd?: string;
  /** Optional CASH-booking per-unit prices; fall back to pricePer* when absent. */
  cashPricePerHour?: number | null;
  cashPricePerHalfDay?: number | null;
  cashPricePerDay?: number | null;
  cashPricePerMonth?: number | null;
  capacity: number;
  amenities: string[];
  rating: number | null;
  reviewCount: number;
  /** Accepted client payment methods. Defaults to ['ONLINE','CASH'] for demo spaces. */
  acceptedPaymentMethods: PaymentMethod[];
  /** Cash deposit config — present only when CASH is accepted. */
  cashDepositType?: CashDepositType;
  cashDepositValue?: number;
  /** Days of week this space is open. 0=Sun…6=Sat. Defaults to Mon–Fri. */
  workingDays: number[];
  /** Opening time "HH:MM" 24h. Defaults to "09:00". */
  openingTime: string;
  /** Closing time "HH:MM" 24h. Defaults to "18:00". */
  closingTime: string;
  /** PartnerMembershipRecord.id when this space is enrolled. */
  partnerMembershipId?: string | null;
  /** True when the space accepts Network Pass bookings. */
  isPartnerInNetwork?: boolean;
  /**
   * Per-space duration discounts (e.g. 3+ days → 10% off). Surfaced so the
   * booking form can preview the server-applied discount. Empty/absent = none.
   */
  durationDiscounts?: { unit: 'HOUR' | 'DAY'; minQty: number; percent: number }[];

  // ─── Category-specific extensions (additive & optional) ────────────────
  /** COWORKING: individually named/numbered desks, each independently bookable. */
  deskNames?: string[];
  /** PRIVATE_OFFICE: gallery + metadata for the single bookable office unit. */
  officePhotos?: string[];
  officeSize?: number | null;
  officeFloor?: string | null;
  officeAmenities?: string[];
  /** DOMICILIATION: total number of address slots offered (null when unset). */
  domiciliationSlots?: number | null;
}

export type ProgramType = 'INCUBATION' | 'ACCELERATION' | 'TRAINING' | 'BOOTCAMP' | 'WORKSHOP';

export interface Program {
  id: string;
  incubatorId: string;
  incubatorName: string;
  title: string;
  description: string;
  type: ProgramType;
  city: string;
  imageUrl: string | null;
  /** Ordered gallery; imageUrls[0] is the cover (kept in sync with imageUrl). Backfilled from imageUrl for legacy records. */
  imageUrls?: string[];
  price: number;
  /** Optional split pricing; fall back to `price` when absent. */
  onlinePrice?: number | null;
  cashPrice?: number | null;
  seatsTotal: number;
  seatsTaken: number;
  deadline: string;
  startDate: string;
  endDate: string;
  acceptedPaymentMethods: PaymentMethod[];
  /** Cash deposit config — present only when CASH is accepted. */
  cashDepositType?: CashDepositType;
  cashDepositValue?: number;
  /** URL slug for the public detail page. May be absent on legacy records. */
  slug?: string | null;
}

export interface Event {
  id: string;
  incubatorId: string;
  incubatorName: string;
  title: string;
  description: string;
  city: string;
  imageUrl: string | null;
  /** Ordered gallery; imageUrls[0] is the cover (kept in sync with imageUrl). Backfilled from imageUrl for legacy records. */
  imageUrls?: string[];
  price: number;
  /** Optional split pricing; fall back to `price` when absent. */
  onlinePrice?: number | null;
  cashPrice?: number | null;
  isOnline: boolean;
  capacity: number;
  attendeeCount: number;
  eventDate: string;
  acceptedPaymentMethods: PaymentMethod[];
  /** Cash deposit config — present only when CASH is accepted. */
  cashDepositType?: CashDepositType;
  cashDepositValue?: number;
  /** URL slug for the public detail page. May be absent on legacy records. */
  slug?: string | null;
}

/* ─────────────────────────── Registration system ─────────────────────────── */

export type RegistrationFieldType =
  | 'SHORT_TEXT'
  | 'LONG_TEXT'
  | 'DROPDOWN'
  | 'MULTIPLE_CHOICE'
  | 'CHECKBOX'
  | 'PHONE'
  | 'EMAIL'
  | 'URL';

export interface RegistrationFormField {
  id: string;
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  label: string;
  type: RegistrationFieldType;
  options: string[] | null;
  required: boolean;
  order: number;
}

export type RegistrationStatus = 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED';

export interface Registration {
  id: string;
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  incubatorId: string;
  userId: string | null;
  fullName: string;
  email: string;
  phone: string;
  answers: Array<{ fieldId: string; value: string | string[] }>;
  status: RegistrationStatus;
  clientId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StartupStage = 'IDEA' | 'PRE_SEED' | 'SEED' | 'SERIES_A' | 'GROWTH';

export interface Startup {
  id: string;
  founderId: string;
  founderName: string;
  name: string;
  tagline: string;
  pitch: string;
  stage: StartupStage;
  sector: string;
  city: string;
  logoUrl: string | null;
  fundingAsk: number;
  valuation: number | null;
  isListed: boolean;
}

export type BookingStatus =
  | 'PENDING'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'REFUNDED';

export interface Booking {
  id: string;
  userId: string;
  spaceId: string | null;
  programId: string | null;
  startsAt: string;
  endsAt: string;
  totalAmount: number;
  status: BookingStatus;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
