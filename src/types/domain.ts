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
  pricePerHour: number | null;
  pricePerDay: number | null;
  pricePerMonth: number | null;
  capacity: number;
  amenities: string[];
  rating: number | null;
  reviewCount: number;
  /** Accepted client payment methods. Defaults to ['ONLINE','CASH'] for demo spaces. */
  acceptedPaymentMethods: PaymentMethod[];
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
  price: number;
  seatsTotal: number;
  seatsTaken: number;
  deadline: string;
  startDate: string;
  endDate: string;
  acceptedPaymentMethods: PaymentMethod[];
}

export interface Event {
  id: string;
  incubatorId: string;
  incubatorName: string;
  title: string;
  description: string;
  city: string;
  imageUrl: string | null;
  price: number;
  isOnline: boolean;
  capacity: number;
  attendeeCount: number;
  eventDate: string;
  acceptedPaymentMethods: PaymentMethod[];
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
