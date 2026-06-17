/**
 * Seed test accounts for Playwright e2e testing.
 *
 * Run: USE_LOCAL_DB=true npx tsx scripts/seed-test-users.ts
 *
 * Creates 5 accounts (admin, incubator, builder, founder, explorer) by
 * writing directly to the local JSON DB — no OTP required.
 */

// Set env BEFORE any imports so env.ts validation passes.
process.env.USE_LOCAL_DB = 'true';
// NODE_ENV is typed read-only by @types/node; cast to a writable view to default it.
(process.env as Record<string, string | undefined>).NODE_ENV ??= 'development';
process.env.SUPABASE_URL ??= 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-not-used-in-local-mode';
process.env.AUTH_SECRET ??= 'local-dev-secret-at-least-32-characters-long-padding-here';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_API_URL ??= 'http://localhost:3000/api';
process.env.API_INTERNAL_URL ??= 'http://localhost:3000/api';

import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/server/auth/password';
import { db } from '../src/server/db/store';

const NOW = new Date().toISOString();

// ─── Incubator space / spaces data ───────────────────────────────────────────
const INCUBATOR_ID = 'qa-incubator-user-id';
const SPACE_ID = 'qa-space-id-001';

const TEST_USERS = [
  {
    id: 'qa-admin-id',
    email: 'test.admin@metwork.test',
    password: 'TestAdmin2026!',
    fullName: 'QA Admin',
    role: 'ADMIN' as const,
    membershipCode: null,
    membershipTier: 'EXPLORER' as const,
  },
  {
    id: INCUBATOR_ID,
    email: 'test.incubator@metwork.test',
    password: 'TestIncubator2026!',
    fullName: 'QA Incubator Hub',
    role: 'INCUBATOR' as const,
    membershipCode: null,
    membershipTier: 'EXPLORER' as const,
  },
  {
    id: 'qa-builder-id',
    email: 'test.builder@metwork.test',
    password: 'TestBuilder2026!',
    fullName: 'QA Builder Entrepreneur',
    role: 'ENTREPRENEUR' as const,
    membershipCode: 'BUILDER',
    membershipTier: 'BUILDER' as const,
    networkCredits: 3,
    networkCreditsMax: 3,
  },
  {
    id: 'qa-founder-id',
    email: 'test.founder@metwork.test',
    password: 'TestFounder2026!',
    fullName: 'QA Founder Entrepreneur',
    role: 'ENTREPRENEUR' as const,
    membershipCode: 'FOUNDER',
    membershipTier: 'FOUNDER' as const,
    networkCredits: 10,
    networkCreditsMax: 10,
  },
  {
    id: 'qa-explorer-id',
    email: 'test.explorer@metwork.test',
    password: 'TestExplorer2026!',
    fullName: 'QA Explorer Entrepreneur',
    role: 'ENTREPRENEUR' as const,
    membershipCode: null,
    membershipTier: 'EXPLORER' as const,
    networkCredits: 0,
    networkCreditsMax: 0,
  },
];

async function seed() {
  console.log('🌱 Seeding test accounts into local DB...\n');

  const hashes = await Promise.all(
    TEST_USERS.map((u) => hashPassword(u.password)),
  );

  await db.update((d) => {
    // Remove any previously seeded QA accounts to make this idempotent.
    const qaIds = new Set(TEST_USERS.map((u) => u.id));
    d.users = d.users.filter((u) => !qaIds.has(u.id));

    for (let i = 0; i < TEST_USERS.length; i++) {
      const u = TEST_USERS[i]!;
      d.users.push({
        id: u.id,
        email: u.email,
        passwordHash: hashes[i]!,
        fullName: u.fullName,
        phone: `+2130700000${String(i).padStart(3, '0')}`,
        city: 'Alger',
        role: u.role,
        status: 'ACTIVE',
        phoneVerified: true,
        emailVerified: true,
        membershipCode: u.membershipCode ?? null,
        membershipTier: u.membershipTier,
        networkCredits: u.networkCredits ?? 0,
        networkCreditsMax: u.networkCreditsMax ?? 0,
        avatarUrl: null,
        locale: 'fr',
        createdAt: NOW,
        updatedAt: NOW,
      });
    }

    // Ensure incubator record exists in d.incubators (the correct DB field).
    if (!d.incubators) d.incubators = [];
    d.incubators = d.incubators.filter((i) => i.id !== 'qa-incubator-profile-id');
    d.incubators.push({
      id: 'qa-incubator-profile-id',
      managerId: INCUBATOR_ID,
      name: 'QA Incubator Hub',
      description: 'Espace de test QA automatisé',
      city: 'Alger',
      address: '10 Rue des Tests, Alger',
      email: 'test.incubator@metwork.test',
      phone: '+213070000001',
      website: null,
      logoUrl: null,
      subscriptionCode: 'COMMISSION',
      subscriptionTier: 'COMMISSION',
      subscriptionStatus: 'ACTIVE',
      status: 'ACTIVE',
      createdAt: NOW,
      updatedAt: NOW,
    } as any);

    // Ensure at least one coworking space exists for booking tests.
    if (!d.spaces) d.spaces = [];
    // Remove stale space entry to force re-create with correct incubatorId.
    d.spaces = d.spaces.filter((s: any) => s.id !== SPACE_ID);
    if (!d.spaces.find((s: any) => s.id === SPACE_ID)) {
      d.spaces.push({
        id: SPACE_ID,
        incubatorId: 'qa-incubator-profile-id',
        incubatorName: 'QA Incubator Hub',
        name: 'QA Coworking Space',
        description: 'Espace de coworking pour tests automatisés',
        category: 'COWORKING',
        capacity: 20,
        pricePerHour: 500,
        pricePerDay: 3000,
        pricePerMonth: null,
        imageUrl: null,
        city: 'Alger',
        amenities: ['wifi', 'parking'],
        acceptedPaymentMethods: ['ONLINE', 'CASH'],
        workingDays: [1, 2, 3, 4, 5],
        openingTime: '09:00',
        closingTime: '18:00',
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      } as any);
    }

    // Ensure at least one mentor exists for consultation tests.
    if (!d.mentors) d.mentors = [];
    const QA_MENTOR_ID = 'qa-mentor-id';
    if (!d.mentors.find((m: any) => m.id === QA_MENTOR_ID)) {
      d.mentors.push({
        id: QA_MENTOR_ID,
        fullName: 'QA Mentor Expert',
        title: 'Expert Test',
        bio: 'Mentor de test pour les agents QA automatisés.',
        expertise: ['Startup', 'Tech'],
        consultationFee: 5000,
        consultationAvailable: true,
        email: 'qa.mentor@metwork.test',
        phone: null,
        linkedinUrl: 'https://linkedin.com/in/qa-mentor',
        avatarUrl: null,
        city: 'Alger',
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      } as any);
    }
  });

  console.log('✅ Test accounts created:\n');
  for (const u of TEST_USERS) {
    console.log(`  ${u.role.padEnd(14)} ${u.email}  /  ${u.password}`);
  }
  console.log('\n✅ Incubator profile created');
  console.log('✅ Coworking space created (QA Coworking Space)');
  console.log('✅ Mentor created (QA Mentor Expert)');
  console.log('\n📂 DB file: .local-db.json');
  console.log('🚀 Now run: npm run dev');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
