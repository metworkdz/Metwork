/**
 * Demo data for dashboards whose real backends don't exist yet.
 *
 * Each export is shaped to match (or be assignable to) the corresponding
 * type in `@/types/domain`. When the real backend lands, replace the
 * call sites with the appropriate `service.list*()` call and delete this
 * file — every consumer should "just compile" against real data.
 */
import type {
  Booking,
  Event as PlatformEvent,
  Program,
  Space,
  Startup,
} from '@/types/domain';

/* ─────────────────────────── Bookings ─────────────────────────── */

export const demoEntrepreneurBookings: Booking[] = [
  {
    id: 'bk_1',
    userId: 'u_demo',
    spaceId: 'sp_oran_hub',
    programId: null,
    startsAt: '2026-05-04T09:00:00Z',
    endsAt: '2026-05-04T17:00:00Z',
    totalAmount: 3500,
    status: 'CONFIRMED',
  },
  {
    id: 'bk_2',
    userId: 'u_demo',
    spaceId: null,
    programId: 'pg_design_thinking',
    startsAt: '2026-05-12T14:00:00Z',
    endsAt: '2026-05-12T18:00:00Z',
    totalAmount: 6000,
    status: 'PENDING',
  },
  {
    id: 'bk_3',
    userId: 'u_demo',
    spaceId: 'sp_algiers_loft',
    programId: null,
    startsAt: '2026-04-21T10:00:00Z',
    endsAt: '2026-04-21T14:00:00Z',
    totalAmount: 1800,
    status: 'COMPLETED',
  },
];

/** Booking rows decorated with display fields the real API will return joined in. */
export interface BookingDisplayRow extends Booking {
  title: string;
  vendor: string;
  city: string;
  kind: 'SPACE' | 'PROGRAM';
}

export const demoEntrepreneurBookingsDisplay: BookingDisplayRow[] = [
  { ...demoEntrepreneurBookings[0]!, title: 'Hot desk — full day', vendor: 'Oran Startup Hub', city: 'Oran', kind: 'SPACE' },
  { ...demoEntrepreneurBookings[1]!, title: 'Design Thinking workshop', vendor: 'Algiers Innovation Lab', city: 'Algiers', kind: 'PROGRAM' },
  { ...demoEntrepreneurBookings[2]!, title: 'Meeting room — 4h', vendor: 'CasaLoft Algiers', city: 'Algiers', kind: 'SPACE' },
];

/* ─────────────────────────── Investor marketplace ─────────────────────────── */

export const demoStartups: Startup[] = [
  {
    id: 'st_1',
    founderId: 'u_a',
    founderName: 'Yacine Brahimi',
    name: 'Tarjim',
    tagline: 'Real-time Darija ↔ MSA translation for media teams.',
    pitch: 'AI translation pipeline tuned to Algerian dialects, used by newsrooms in Algiers and Constantine.',
    stage: 'SEED',
    sector: 'AI / Media',
    city: 'Algiers',
    logoUrl: null,
    fundingAsk: 12_000_000,
    valuation: 80_000_000,
    isListed: true,
  },
  {
    id: 'st_2',
    founderId: 'u_b',
    founderName: 'Nora Kaci',
    name: 'Salam Health',
    tagline: 'Tele-consultations for primary care across the Maghreb.',
    pitch: 'Licensed in Algeria, expanding to Tunisia. 12k monthly active patients, 280 doctors onboarded.',
    stage: 'PRE_SEED',
    sector: 'HealthTech',
    city: 'Oran',
    logoUrl: null,
    fundingAsk: 6_500_000,
    valuation: null,
    isListed: true,
  },
  {
    id: 'st_3',
    founderId: 'u_c',
    founderName: 'Karim Belkacem',
    name: 'GreenRoute DZ',
    tagline: 'Last-mile electric delivery for SMEs in coastal cities.',
    pitch: 'Fleet of 40 e-bikes, partnerships with three logistics platforms, 18% MoM revenue growth.',
    stage: 'SEED',
    sector: 'Logistics',
    city: 'Algiers',
    logoUrl: null,
    fundingAsk: 25_000_000,
    valuation: 120_000_000,
    isListed: true,
  },
  {
    id: 'st_4',
    founderId: 'u_d',
    founderName: 'Sara Bensalah',
    name: 'Mektoub',
    tagline: 'Marketplace for traditional Algerian artisans.',
    pitch: '600+ verified artisans, GMV up 4x YoY, expanding payments to wallet + cash on delivery.',
    stage: 'IDEA',
    sector: 'E-commerce',
    city: 'Constantine',
    logoUrl: null,
    fundingAsk: 3_000_000,
    valuation: null,
    isListed: true,
  },
];

/* ─────────────────────────── Investor meeting requests ─────────────────────────── */

export type MeetingStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED';

export interface DemoMeetingRequest {
  id: string;
  startupId: string;
  startupName: string;
  founderName: string;
  requestedAt: string;
  preferredAt: string;
  status: MeetingStatus;
  message: string;
}

export const demoMeetingRequests: DemoMeetingRequest[] = [
  {
    id: 'mr_1',
    startupId: 'st_1',
    startupName: 'Tarjim',
    founderName: 'Yacine Brahimi',
    requestedAt: '2026-04-28T08:30:00Z',
    preferredAt: '2026-05-06T10:00:00Z',
    status: 'PENDING',
    message: 'Interested in your seed round. Could we go through traction and burn?',
  },
  {
    id: 'mr_2',
    startupId: 'st_3',
    startupName: 'GreenRoute DZ',
    founderName: 'Karim Belkacem',
    requestedAt: '2026-04-25T14:10:00Z',
    preferredAt: '2026-05-02T15:00:00Z',
    status: 'ACCEPTED',
    message: 'Confirmed for Saturday — happy to walk through unit economics.',
  },
  {
    id: 'mr_3',
    startupId: 'st_4',
    startupName: 'Mektoub',
    founderName: 'Sara Bensalah',
    requestedAt: '2026-04-22T16:45:00Z',
    preferredAt: '2026-04-30T09:00:00Z',
    status: 'DECLINED',
    message: 'Pre-revenue — not a fit for our current thesis.',
  },
];

/* ─────────────────────────── Public spaces marketplace ─────────────────────────── */

/**
 * Public-facing inventory shown on /spaces. Covers all four categories
 * across Algeria's main cities. The shape matches the real `Space` type
 * exactly so swapping in `await spacesService.list()` is a one-line edit.
 */
export const demoPublicSpaces: Space[] = [
  {
    id: 'sp_oran_hub',
    incubatorId: 'inc_oran_hub',
    incubatorName: 'Oran Startup Hub',
    name: 'Open coworking — main floor',
    description:
      'Bright 600 m² coworking floor in central Oran. Forty hot desks, fibre-optic internet, four call booths, and a barista-run café. Doors open from 8am to 11pm seven days a week.',
    category: 'COWORKING',
    city: 'Oran',
    imageUrl: null,
    pricePerHour: 400,
    pricePerDay: 2500,
    pricePerMonth: 35_000,
    capacity: 40,
    amenities: ['Fibre internet', 'Call booths', 'Barista café', 'Printing', '24/7 security'],
    rating: 4.6,
    reviewCount: 128,
  },
  {
    id: 'sp_oran_office_6',
    incubatorId: 'inc_oran_hub',
    incubatorName: 'Oran Startup Hub',
    name: 'Private office — 6 seats',
    description:
      'Lockable team room with whiteboard wall, smart TV, and ergonomic chairs. Ideal for a small founding team or a remote satellite.',
    category: 'PRIVATE_OFFICE',
    city: 'Oran',
    imageUrl: null,
    pricePerHour: null,
    pricePerDay: null,
    pricePerMonth: 95_000,
    capacity: 6,
    amenities: ['Whiteboard', 'Smart TV', 'Lockable', '24/7 access', 'Coffee'],
    rating: 4.9,
    reviewCount: 32,
  },
  {
    id: 'sp_oran_training_30',
    incubatorId: 'inc_oran_hub',
    incubatorName: 'Oran Startup Hub',
    name: 'Training room — 30 seats',
    description:
      'Theatre-layout training room with HD projector, wireless mic, and live-stream rig. Great for workshops, demo days, and bootcamps.',
    category: 'TRAINING_ROOM',
    city: 'Oran',
    imageUrl: null,
    pricePerHour: 3_500,
    pricePerDay: 18_000,
    pricePerMonth: null,
    capacity: 30,
    amenities: ['HD projector', 'Wireless mic', 'Live-stream', 'Catering on request'],
    rating: 4.7,
    reviewCount: 41,
  },
  {
    id: 'sp_algiers_loft',
    incubatorId: 'inc_casaloft',
    incubatorName: 'CasaLoft Algiers',
    name: 'Hydra coworking loft',
    description:
      "Industrial-style loft in Hydra with terrace and meeting rooms. Members include design studios, fintech founders, and a small VC fund.",
    category: 'COWORKING',
    city: 'Algiers',
    imageUrl: null,
    pricePerHour: 600,
    pricePerDay: 3_500,
    pricePerMonth: 42_000,
    capacity: 55,
    amenities: ['Terrace', 'Meeting rooms', 'Fibre internet', 'Bike parking'],
    rating: 4.8,
    reviewCount: 96,
  },
  {
    id: 'sp_algiers_meeting_4h',
    incubatorId: 'inc_casaloft',
    incubatorName: 'CasaLoft Algiers',
    name: 'Meeting room — 4 seats',
    description:
      'Glass-walled meeting room for fundraising calls and small interviews. Booking includes coffee + still water.',
    category: 'PRIVATE_OFFICE',
    city: 'Algiers',
    imageUrl: null,
    pricePerHour: 1_200,
    pricePerDay: 6_500,
    pricePerMonth: null,
    capacity: 4,
    amenities: ['Glass-walled', 'Smart TV', 'Coffee', 'Still water'],
    rating: 4.5,
    reviewCount: 22,
  },
  {
    id: 'sp_algiers_address',
    incubatorId: 'inc_casaloft',
    incubatorName: 'CasaLoft Algiers',
    name: 'Business domiciliation — Hydra',
    description:
      'Use a registered Algiers address for your company, with mail handling and weekly forwarding. Includes one day of meeting-room access per month.',
    category: 'DOMICILIATION',
    city: 'Algiers',
    imageUrl: null,
    pricePerHour: null,
    pricePerDay: null,
    pricePerMonth: 8_000,
    capacity: 1,
    amenities: ['Registered address', 'Mail handling', 'Weekly forwarding', '1 day room/mo'],
    rating: 4.4,
    reviewCount: 17,
  },
  {
    id: 'sp_constantine_floor',
    incubatorId: 'inc_const_techpark',
    incubatorName: 'Constantine Tech Park',
    name: 'Eastern coworking floor',
    description:
      'Three floors of coworking in the heart of Constantine. Quiet zones, phone booths, and a rooftop café.',
    category: 'COWORKING',
    city: 'Constantine',
    imageUrl: null,
    pricePerHour: 350,
    pricePerDay: 2_000,
    pricePerMonth: 28_000,
    capacity: 60,
    amenities: ['Quiet zones', 'Rooftop café', 'Phone booths', 'Showers'],
    rating: 4.5,
    reviewCount: 73,
  },
  {
    id: 'sp_constantine_training',
    incubatorId: 'inc_const_techpark',
    incubatorName: 'Constantine Tech Park',
    name: 'Bootcamp room — 50 seats',
    description:
      'Tiered training room equipped for multi-day bootcamps. Includes live-translation booths.',
    category: 'TRAINING_ROOM',
    city: 'Constantine',
    imageUrl: null,
    pricePerHour: 4_200,
    pricePerDay: 22_000,
    pricePerMonth: null,
    capacity: 50,
    amenities: ['Tiered seating', 'Translation booths', 'Catering'],
    rating: 4.6,
    reviewCount: 18,
  },
  {
    id: 'sp_setif_makerspace',
    incubatorId: 'inc_setif_maker',
    incubatorName: 'Sétif Maker Space',
    name: 'Hardware coworking',
    description:
      'Coworking optimized for hardware founders: 3D printers, CNC, and a soldering bench shared by members.',
    category: 'COWORKING',
    city: 'Sétif',
    imageUrl: null,
    pricePerHour: 300,
    pricePerDay: 1_800,
    pricePerMonth: 24_000,
    capacity: 25,
    amenities: ['3D printer', 'CNC', 'Soldering bench', 'Lockers'],
    rating: 4.3,
    reviewCount: 26,
  },
  {
    id: 'sp_annaba_office',
    incubatorId: 'inc_annaba_port',
    incubatorName: 'Annaba Port Innovation',
    name: 'Private office — 10 seats',
    description:
      'Sea-view office in Annaba port complex. Suited for an established team needing to scale.',
    category: 'PRIVATE_OFFICE',
    city: 'Annaba',
    imageUrl: null,
    pricePerHour: null,
    pricePerDay: null,
    pricePerMonth: 140_000,
    capacity: 10,
    amenities: ['Sea view', 'Lockable', '24/7 access', 'Parking'],
    rating: 4.7,
    reviewCount: 11,
  },
  {
    id: 'sp_blida_address',
    incubatorId: 'inc_blida_hub',
    incubatorName: 'Blida Business Hub',
    name: 'Business address — Blida',
    description:
      'Affordable Blida domiciliation for companies registering near the Mitidja agro-tech corridor.',
    category: 'DOMICILIATION',
    city: 'Blida',
    imageUrl: null,
    pricePerHour: null,
    pricePerDay: null,
    pricePerMonth: 6_500,
    capacity: 1,
    amenities: ['Registered address', 'Mail handling'],
    rating: null,
    reviewCount: 0,
  },
  {
    id: 'sp_tizi_workshop',
    incubatorId: 'inc_tizi_lab',
    incubatorName: 'Tizi Ouzou Lab',
    name: 'Workshop room — 15 seats',
    description:
      'Quiet workshop room with U-shape seating, projector, and snack bar.',
    category: 'TRAINING_ROOM',
    city: 'Tizi Ouzou',
    imageUrl: null,
    pricePerHour: 2_200,
    pricePerDay: 11_000,
    pricePerMonth: null,
    capacity: 15,
    amenities: ['Projector', 'Snack bar', 'AC'],
    rating: 4.4,
    reviewCount: 9,
  },
];

/* ─────────────────────────── Public programs marketplace ─────────────────────────── */

/**
 * Public-facing programs inventory shown on /programs. Spans multiple
 * incubators, types, and price points.
 */
export const demoPublicPrograms: Program[] = [
  {
    id: 'pg_oran_acc4',
    incubatorId: 'inc_oran_hub',
    incubatorName: 'Oran Startup Hub',
    title: 'Growth Accelerator — Cohort 4',
    description:
      "Twelve weeks for seed-stage Algerian founders. Weekly 1:1s with operators, a tightly-curated investor network, and a final demo day in front of regional VCs. Past cohorts have raised over 80M DZD collectively.",
    type: 'ACCELERATION',
    city: 'Oran',
    imageUrl: null,
    price: 0,
    seatsTotal: 12,
    seatsTaken: 9,
    deadline: '2026-05-25',
    startDate: '2026-06-02',
    endDate: '2026-08-25',
  },
  {
    id: 'pg_oran_dt',
    incubatorId: 'inc_oran_hub',
    incubatorName: 'Oran Startup Hub',
    title: 'Design Thinking sprint',
    description:
      'A two-day workshop covering discovery, ideation and prototyping. You leave with a tested concept and a customer interview deck.',
    type: 'WORKSHOP',
    city: 'Oran',
    imageUrl: null,
    price: 6000,
    seatsTotal: 20,
    seatsTaken: 14,
    deadline: '2026-05-08',
    startDate: '2026-05-12',
    endDate: '2026-05-13',
  },
  {
    id: 'pg_algiers_inc',
    incubatorId: 'inc_casaloft',
    incubatorName: 'CasaLoft Algiers',
    title: 'Pre-seed Incubation — Spring',
    description:
      'Six-month residential incubation for first-time founders. Includes office space, mentorship, fundraising prep, and a 500K DZD non-dilutive grant for top picks.',
    type: 'INCUBATION',
    city: 'Algiers',
    imageUrl: null,
    price: 0,
    seatsTotal: 8,
    seatsTaken: 5,
    deadline: '2026-05-31',
    startDate: '2026-06-15',
    endDate: '2026-12-15',
  },
  {
    id: 'pg_algiers_fr',
    incubatorId: 'inc_casaloft',
    incubatorName: 'CasaLoft Algiers',
    title: 'Fundraising bootcamp',
    description:
      'A four-week intensive on cap-table design, pitch craft, and term-sheet negotiation, taught by founders who have closed Algerian seed rounds.',
    type: 'BOOTCAMP',
    city: 'Algiers',
    imageUrl: null,
    price: 12000,
    seatsTotal: 25,
    seatsTaken: 18,
    deadline: '2026-05-20',
    startDate: '2026-05-26',
    endDate: '2026-06-23',
  },
  {
    id: 'pg_const_train',
    incubatorId: 'inc_const_techpark',
    incubatorName: 'Constantine Tech Park',
    title: 'Product Management foundations',
    description:
      'Five evenings covering discovery, prioritization, and shipping. Suited for early operators stepping into a PM role.',
    type: 'TRAINING',
    city: 'Constantine',
    imageUrl: null,
    price: 4500,
    seatsTotal: 30,
    seatsTaken: 11,
    deadline: '2026-05-18',
    startDate: '2026-05-25',
    endDate: '2026-05-29',
  },
  {
    id: 'pg_setif_hw',
    incubatorId: 'inc_setif_maker',
    incubatorName: 'Sétif Maker Space',
    title: 'Hardware founders bootcamp',
    description:
      'Three weekends of CAD, prototyping, and supply-chain basics. Every team ships a working prototype by the final demo.',
    type: 'BOOTCAMP',
    city: 'Sétif',
    imageUrl: null,
    price: 9000,
    seatsTotal: 15,
    seatsTaken: 6,
    deadline: '2026-06-05',
    startDate: '2026-06-13',
    endDate: '2026-06-28',
  },
  {
    id: 'pg_annaba_acc',
    incubatorId: 'inc_annaba_port',
    incubatorName: 'Annaba Port Innovation',
    title: 'Maritime & logistics accelerator',
    description:
      'Sixteen-week vertical accelerator for founders building in shipping, logistics, and port-side commerce. Co-led with the Annaba Port Authority.',
    type: 'ACCELERATION',
    city: 'Annaba',
    imageUrl: null,
    price: 0,
    seatsTotal: 10,
    seatsTaken: 4,
    deadline: '2026-06-15',
    startDate: '2026-07-01',
    endDate: '2026-10-21',
  },
  {
    id: 'pg_tizi_ws',
    incubatorId: 'inc_tizi_lab',
    incubatorName: 'Tizi Ouzou Lab',
    title: 'No-code MVP weekend',
    description:
      'A weekend sprint where you ship a no-code MVP with mentors on hand for product, growth, and copy review.',
    type: 'WORKSHOP',
    city: 'Tizi Ouzou',
    imageUrl: null,
    price: 3500,
    seatsTotal: 18,
    seatsTaken: 7,
    deadline: '2026-05-15',
    startDate: '2026-05-17',
    endDate: '2026-05-18',
  },
];

/* ─────────────────────────── Public events marketplace ─────────────────────────── */

export const demoPublicEvents: PlatformEvent[] = [
  {
    id: 'ev_pitch_may',
    incubatorId: 'inc_oran_hub',
    incubatorName: 'Oran Startup Hub',
    title: 'Pitch Night — May edition',
    description:
      'Eight startups pitch to a panel of regional investors. Open bar afterwards.',
    city: 'Oran',
    imageUrl: null,
    price: 0,
    isOnline: false,
    capacity: 120,
    attendeeCount: 84,
    eventDate: '2026-05-15T18:00:00Z',
  },
  {
    id: 'ev_office_hours',
    incubatorId: 'inc_oran_hub',
    incubatorName: 'Oran Startup Hub',
    title: 'Investor office hours',
    description:
      'One-on-one slots with three angel investors. Twenty-minute conversations, no slides.',
    city: 'Oran',
    imageUrl: null,
    price: 1500,
    isOnline: true,
    capacity: 30,
    attendeeCount: 11,
    eventDate: '2026-05-20T15:00:00Z',
  },
  {
    id: 'ev_demo_day',
    incubatorId: 'inc_casaloft',
    incubatorName: 'CasaLoft Algiers',
    title: 'CasaLoft Demo Day — Spring cohort',
    description:
      'Twelve teams from the Spring incubation present their progress. Networking dinner included.',
    city: 'Algiers',
    imageUrl: null,
    price: 0,
    isOnline: false,
    capacity: 200,
    attendeeCount: 167,
    eventDate: '2026-06-08T17:30:00Z',
  },
  {
    id: 'ev_fr_panel',
    incubatorId: 'inc_casaloft',
    incubatorName: 'CasaLoft Algiers',
    title: 'Fundraising in MENA — Panel',
    description:
      'Three GPs from regional funds discuss what they look for in Algerian seed rounds.',
    city: 'Algiers',
    imageUrl: null,
    price: 2000,
    isOnline: true,
    capacity: 100,
    attendeeCount: 42,
    eventDate: '2026-05-29T17:00:00Z',
  },
  {
    id: 'ev_const_meetup',
    incubatorId: 'inc_const_techpark',
    incubatorName: 'Constantine Tech Park',
    title: 'Eastern Founders Meetup',
    description:
      'Monthly community meetup. Three short talks, a fireside chat, and snacks.',
    city: 'Constantine',
    imageUrl: null,
    price: 0,
    isOnline: false,
    capacity: 80,
    attendeeCount: 31,
    eventDate: '2026-05-22T18:00:00Z',
  },
  {
    id: 'ev_setif_workshop',
    incubatorId: 'inc_setif_maker',
    incubatorName: 'Sétif Maker Space',
    title: '3D printing crash course',
    description:
      'Three-hour evening workshop, hands-on. Prints included to take home.',
    city: 'Sétif',
    imageUrl: null,
    price: 1200,
    isOnline: false,
    capacity: 20,
    attendeeCount: 8,
    eventDate: '2026-05-30T17:00:00Z',
  },
  {
    id: 'ev_annaba_summit',
    incubatorId: 'inc_annaba_port',
    incubatorName: 'Annaba Port Innovation',
    title: 'Maritime tech summit',
    description:
      'A half-day summit with operators from regional ports, logistics platforms, and shipping startups.',
    city: 'Annaba',
    imageUrl: null,
    price: 4500,
    isOnline: false,
    capacity: 150,
    attendeeCount: 62,
    eventDate: '2026-06-12T09:00:00Z',
  },
  {
    id: 'ev_tizi_pitch',
    incubatorId: 'inc_tizi_lab',
    incubatorName: 'Tizi Ouzou Lab',
    title: 'Local heroes pitch night',
    description:
      'Six Tizi-based startups pitch their plans for the next twelve months.',
    city: 'Tizi Ouzou',
    imageUrl: null,
    price: 0,
    isOnline: false,
    capacity: 60,
    attendeeCount: 27,
    eventDate: '2026-05-25T18:30:00Z',
  },
];

/* ─────────────────────────── Mentors ─────────────────────────── */

/**
 * Seed roster used the very first time the `mentors` collection is
 * created (or when the store predates this collection). Once seeded
 * the data is owned by the admin — deletions stick, no re-seeding.
 */
export interface DemoMentor {
  id: string;
  fullName: string;
  position: string;
  imageUrl: string;
  bio: string | null;
  linkedinUrl: string | null;
  createdAt: string;
}

export const demoMentors: DemoMentor[] = [
  {
    id: 'mn_amina',
    fullName: 'Amina Hamdi',
    position: 'Operating Partner — Maghreb Ventures',
    imageUrl: 'https://images.unsplash.com/photo-1573497019418-b400bb3ab074?auto=format&fit=crop&w=600&q=80',
    bio: 'Two-time founder, now backing seed-stage Algerian SaaS. Previously CRO at a regional payments startup that exited to a Pan-African acquirer.',
    linkedinUrl: 'https://www.linkedin.com/in/example-amina-hamdi/',
    createdAt: '2026-04-29T08:00:00.000Z',
  },
  {
    id: 'mn_yacine',
    fullName: 'Yacine Brahimi',
    position: 'Founder & CEO — Tarjim',
    imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80',
    bio: 'Building real-time Darija translation for newsrooms. Mentors on growth, hiring engineering teams, and selling to enterprise.',
    linkedinUrl: 'https://www.linkedin.com/in/example-yacine-brahimi/',
    createdAt: '2026-04-29T08:01:00.000Z',
  },
  {
    id: 'mn_nora',
    fullName: 'Nora Kaci',
    position: 'CMO — Salam Health',
    imageUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=600&q=80',
    bio: 'Healthcare marketer specialised in regulated patient acquisition. Led growth from 0 → 12k MAU.',
    linkedinUrl: 'https://www.linkedin.com/in/example-nora-kaci/',
    createdAt: '2026-04-29T08:02:00.000Z',
  },
  {
    id: 'mn_karim',
    fullName: 'Karim Belkacem',
    position: 'CEO — GreenRoute DZ',
    imageUrl: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=600&q=80',
    bio: 'Operator turned founder — last-mile electric delivery across coastal cities. Mentors on logistics, ops, and unit economics.',
    linkedinUrl: 'https://www.linkedin.com/in/example-karim-belkacem/',
    createdAt: '2026-04-29T08:03:00.000Z',
  },
  {
    id: 'mn_sara',
    fullName: 'Sara Bensalah',
    position: 'Founder — Mektoub',
    imageUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=80',
    bio: 'Marketplace operator for traditional Algerian artisans. Strong on community-led GTM and creator-economy plays.',
    linkedinUrl: 'https://www.linkedin.com/in/example-sara-bensalah/',
    createdAt: '2026-04-29T08:04:00.000Z',
  },
  {
    id: 'mn_riad',
    fullName: 'Riad Belaid',
    position: 'General Partner — DZ Angels',
    imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=600&q=80',
    bio: 'Angel investor with 18 cheques across the Maghreb. Helps founders prep for fundraises and bridge to MENA capital.',
    linkedinUrl: 'https://www.linkedin.com/in/example-riad-belaid/',
    createdAt: '2026-04-29T08:05:00.000Z',
  },
  {
    id: 'mn_imane',
    fullName: 'Imane Tahar',
    position: 'Head of Engineering — Casbah Labs',
    imageUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=600&q=80',
    bio: 'Scaled an engineering org from 3 to 40 in 18 months. Mentors technical founders on hiring, architecture, and ICs vs management.',
    linkedinUrl: 'https://www.linkedin.com/in/example-imane-tahar/',
    createdAt: '2026-04-29T08:06:00.000Z',
  },
  {
    id: 'mn_walid',
    fullName: 'Walid Khelifi',
    position: 'Product Lead — Fintech, ex-Yassir',
    imageUrl: 'https://images.unsplash.com/photo-1463453091185-61582044d556?auto=format&fit=crop&w=600&q=80',
    bio: 'Ex-Yassir PM. Loves consumer fintech, payments rails, and 0→1 product discovery.',
    linkedinUrl: 'https://www.linkedin.com/in/example-walid-khelifi/',
    createdAt: '2026-04-29T08:07:00.000Z',
  },
];

export const demoIncubatorSpaces: Space[] = [
  {
    id: 'sp_oran_hub',
    incubatorId: 'inc_demo',
    incubatorName: 'Oran Startup Hub',
    name: 'Open coworking floor',
    description: '40 hot desks, fibre internet, private call booths.',
    category: 'COWORKING',
    city: 'Oran',
    imageUrl: null,
    pricePerHour: 400,
    pricePerDay: 2500,
    pricePerMonth: 35000,
    capacity: 40,
    amenities: ['fibre', 'meeting rooms', 'coffee'],
    rating: 4.6,
    reviewCount: 38,
  },
  {
    id: 'sp_oran_office',
    incubatorId: 'inc_demo',
    incubatorName: 'Oran Startup Hub',
    name: 'Private office — 6 seats',
    description: 'Dedicated room for a small team, with whiteboard and TV.',
    category: 'PRIVATE_OFFICE',
    city: 'Oran',
    imageUrl: null,
    pricePerHour: null,
    pricePerDay: null,
    pricePerMonth: 95000,
    capacity: 6,
    amenities: ['whiteboard', 'tv', '24/7'],
    rating: 4.8,
    reviewCount: 12,
  },
  {
    id: 'sp_oran_training',
    incubatorId: 'inc_demo',
    incubatorName: 'Oran Startup Hub',
    name: 'Training room — 30 seats',
    description: 'Theatre layout, projector, sound.',
    category: 'TRAINING_ROOM',
    city: 'Oran',
    imageUrl: null,
    pricePerHour: 3500,
    pricePerDay: 18000,
    pricePerMonth: null,
    capacity: 30,
    amenities: ['projector', 'mic', 'water'],
    rating: null,
    reviewCount: 0,
  },
];

export const demoIncubatorPrograms: Program[] = [
  {
    id: 'pg_design_thinking',
    incubatorId: 'inc_demo',
    incubatorName: 'Oran Startup Hub',
    title: 'Design Thinking sprint',
    description: 'Two-day workshop covering discovery, ideation and prototyping.',
    type: 'WORKSHOP',
    city: 'Oran',
    imageUrl: null,
    price: 6000,
    seatsTotal: 20,
    seatsTaken: 14,
    deadline: '2026-05-08',
    startDate: '2026-05-12',
    endDate: '2026-05-13',
  },
  {
    id: 'pg_growth_acc',
    incubatorId: 'inc_demo',
    incubatorName: 'Oran Startup Hub',
    title: 'Growth Accelerator — Cohort 4',
    description: '12-week intensive: GTM, fundraising, hiring.',
    type: 'ACCELERATION',
    city: 'Oran',
    imageUrl: null,
    price: 0,
    seatsTotal: 12,
    seatsTaken: 9,
    deadline: '2026-05-25',
    startDate: '2026-06-02',
    endDate: '2026-08-25',
  },
];

export const demoIncubatorEvents: PlatformEvent[] = [
  {
    id: 'ev_pitch_night',
    incubatorId: 'inc_demo',
    incubatorName: 'Oran Startup Hub',
    title: 'Pitch Night — May edition',
    description: 'Eight startups pitch to a panel of regional investors.',
    city: 'Oran',
    imageUrl: null,
    price: 0,
    isOnline: false,
    capacity: 120,
    attendeeCount: 84,
    eventDate: '2026-05-15T18:00:00Z',
  },
  {
    id: 'ev_office_hours',
    incubatorId: 'inc_demo',
    incubatorName: 'Oran Startup Hub',
    title: 'Investor office hours',
    description: 'One-on-one slots with three angel investors.',
    city: 'Oran',
    imageUrl: null,
    price: 1500,
    isOnline: true,
    capacity: 30,
    attendeeCount: 11,
    eventDate: '2026-05-20T15:00:00Z',
  },
];

/* ─────────────────────────── Incubator bookings dashboard ─────────────────────────── */

export interface IncubatorBookingRow {
  id: string;
  bookedBy: string;
  bookedByEmail: string;
  itemName: string;
  itemKind: 'SPACE' | 'PROGRAM' | 'EVENT';
  startsAt: string;
  amount: number;
  status: Booking['status'];
}

export const demoIncubatorBookings: IncubatorBookingRow[] = [
  { id: 'ib_1', bookedBy: 'Amina Hamdi', bookedByEmail: 'amina@example.com', itemName: 'Hot desk — full day', itemKind: 'SPACE', startsAt: '2026-05-04T09:00:00Z', amount: 3500, status: 'CONFIRMED' },
  { id: 'ib_2', bookedBy: 'Mehdi Ould Ali', bookedByEmail: 'mehdi@example.com', itemName: 'Design Thinking sprint', itemKind: 'PROGRAM', startsAt: '2026-05-12T14:00:00Z', amount: 6000, status: 'PENDING' },
  { id: 'ib_3', bookedBy: 'Lina Sebbar', bookedByEmail: 'lina@example.com', itemName: 'Pitch Night — May edition', itemKind: 'EVENT', startsAt: '2026-05-15T18:00:00Z', amount: 0, status: 'CONFIRMED' },
  { id: 'ib_4', bookedBy: 'Yassine Hadj', bookedByEmail: 'y.hadj@example.com', itemName: 'Private office — 6 seats', itemKind: 'SPACE', startsAt: '2026-05-01T08:00:00Z', amount: 95000, status: 'CONFIRMED' },
  { id: 'ib_5', bookedBy: 'Sofia Mansouri', bookedByEmail: 'sofia@example.com', itemName: 'Training room — 30 seats', itemKind: 'SPACE', startsAt: '2026-04-18T10:00:00Z', amount: 18000, status: 'COMPLETED' },
];

/* ─────────────────────────── Incubator revenue ─────────────────────────── */

export interface RevenueBucket {
  month: string; // 'YYYY-MM'
  gross: number;
  commission: number;
  net: number;
  bookings: number;
}

export const demoRevenueBuckets: RevenueBucket[] = [
  { month: '2026-04', gross: 412000, commission: 82400, net: 329600, bookings: 41 },
  { month: '2026-03', gross: 358000, commission: 71600, net: 286400, bookings: 36 },
  { month: '2026-02', gross: 290000, commission: 58000, net: 232000, bookings: 28 },
  { month: '2026-01', gross: 215000, commission: 43000, net: 172000, bookings: 22 },
];

/* ─────────────────────────── Admin: users ─────────────────────────── */

export interface AdminUserRow {
  id: string;
  fullName: string;
  email: string;
  role: 'ENTREPRENEUR' | 'INVESTOR' | 'INCUBATOR' | 'ADMIN';
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  city: string;
  createdAt: string;
  membershipCode: string | null;
}

export const demoAdminUsers: AdminUserRow[] = [
  { id: 'u_a', fullName: 'Yacine Brahimi', email: 'yacine@tarjim.dz', role: 'ENTREPRENEUR', status: 'ACTIVE', city: 'Algiers', createdAt: '2026-02-12T10:00:00Z', membershipCode: 'STARTUP' },
  { id: 'u_b', fullName: 'Nora Kaci', email: 'nora@salamhealth.dz', role: 'ENTREPRENEUR', status: 'ACTIVE', city: 'Oran', createdAt: '2026-03-04T09:00:00Z', membershipCode: 'ENTREPRENEUR' },
  { id: 'u_e', fullName: 'Riad Belaid', email: 'riad@vc-dz.com', role: 'INVESTOR', status: 'ACTIVE', city: 'Algiers', createdAt: '2026-01-18T13:00:00Z', membershipCode: null },
  { id: 'u_f', fullName: 'Oran Startup Hub', email: 'admin@oranhub.dz', role: 'INCUBATOR', status: 'ACTIVE', city: 'Oran', createdAt: '2025-11-22T08:00:00Z', membershipCode: null },
  { id: 'u_g', fullName: 'Walid Khelifi', email: 'walid@example.com', role: 'ENTREPRENEUR', status: 'PENDING_VERIFICATION', city: 'Constantine', createdAt: '2026-04-27T18:00:00Z', membershipCode: null },
  { id: 'u_h', fullName: 'Imane Tahar', email: 'imane@example.com', role: 'ENTREPRENEUR', status: 'SUSPENDED', city: 'Annaba', createdAt: '2025-12-01T08:00:00Z', membershipCode: 'FREE' },
];

/* ─────────────────────────── Admin: pending listings ─────────────────────────── */

export interface PendingListingRow {
  id: string;
  kind: 'SPACE' | 'PROGRAM' | 'EVENT';
  title: string;
  incubator: string;
  city: string;
  submittedAt: string;
  price: number;
}

export const demoPendingListings: PendingListingRow[] = [
  { id: 'pl_1', kind: 'SPACE', title: 'Casbah Coworking — Phase 2', incubator: 'Algiers Maker Space', city: 'Algiers', submittedAt: '2026-04-28T11:00:00Z', price: 32000 },
  { id: 'pl_2', kind: 'PROGRAM', title: 'Fundraising bootcamp — June', incubator: 'Constantine Tech Park', city: 'Constantine', submittedAt: '2026-04-27T15:30:00Z', price: 12000 },
  { id: 'pl_3', kind: 'EVENT', title: 'Demo Day — June cohort', incubator: 'Oran Startup Hub', city: 'Oran', submittedAt: '2026-04-26T09:15:00Z', price: 0 },
  { id: 'pl_4', kind: 'SPACE', title: 'Private office — Hydra', incubator: 'CasaLoft Algiers', city: 'Algiers', submittedAt: '2026-04-25T10:45:00Z', price: 110000 },
];
