import type { PlatformSettingsRecord } from '@/server/db/store';

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettingsRecord = {
  appName:         'Metwork',
  maintenanceMode: false,
  signupsEnabled:  true,
  paymentsEnabled: true,
  updatedAt:       new Date(0).toISOString(),
};

/** Default commission rules seeded on first load */
export const DEFAULT_COMMISSION_RULES = [
  {
    id:              'rule_investment',
    name:            'Investment commission',
    transactionType: 'INVESTMENT',
    rate:            0.07,
    description:     'Platform fee on each confirmed investment transaction (7%).',
    isActive:        true,
    updatedAt:       new Date(0).toISOString(),
  },
  {
    id:              'rule_booking',
    name:            'Incubator booking commission',
    transactionType: 'PAYMENT',
    rate:            0.20,
    description:     'Metwork cut from space / program bookings when the incubator is on the COMMISSION plan (20%).',
    isActive:        true,
    updatedAt:       new Date(0).toISOString(),
  },
  {
    id:              'rule_topup',
    name:            'Top-up processing fee',
    transactionType: 'TOP_UP',
    rate:            0.015,
    description:     'Payment gateway processing fee passed through to users on wallet top-ups (1.5%).',
    isActive:        false,
    updatedAt:       new Date(0).toISOString(),
  },
  {
    id:              'rule_mentor_consultation',
    name:            'Mentor consultation commission',
    transactionType: 'MENTOR_CONSULTATION',
    rate:            0.30,
    description:     'Platform commission on paid mentor consultations (30%). Mentors receive the remaining 70%.',
    isActive:        true,
    updatedAt:       new Date(0).toISOString(),
  },
] as const;
