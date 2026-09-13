/**
 * Demo data for the consultant-portal walkthrough screenshots.
 *
 * Fills in the parts of a consultant account that have no self-service route —
 * admin approval, phone verification, past consultations and the money — for an
 * account that was ALREADY created through the real signup flow at
 * `/mentordashboard/login`. It deliberately does not create the account itself:
 * the point of the exercise is that the screenshots show the real product, and
 * a DB-inserted consultant would have skipped the real UX.
 *
 * LOCAL ONLY. Refuses to run unless USE_LOCAL_DB=true, so it cannot reach the
 * production Supabase document even by accident.
 *
 *   USE_LOCAL_DB=true npx tsx scripts/consultant-demo-account.ts --seed
 *   USE_LOCAL_DB=true npx tsx scripts/consultant-demo-account.ts --purge
 *
 * The money is NOT invented. Earnings go through the canonical mentor ledger
 * (`creditPendingEarning` → `releaseToAvailable`), so the 20 % consultation
 * commission is the same split the real settlement path applies, and the
 * withdrawal goes through `createWithdrawalRequest`, so its escrow hold behaves
 * exactly like a real one. Re-running is safe: booking ids are deterministic and
 * the ledger is idempotent by reference.
 */
import { db } from '@/server/db/store';
import { creditPendingEarning, releaseToAvailable, getMentorLedgerView } from '@/server/mentors/ledger';
import { createWithdrawalRequest } from '@/server/withdrawals/service';

const DEMO_EMAIL = 'mohamed.amine.demo+test@metwork.test';
const MODE = process.argv.includes('--purge') ? 'purge' : 'seed';

if (process.env.USE_LOCAL_DB !== 'true') {
  console.error('✘ Refusing to run: USE_LOCAL_DB is not "true".');
  console.error('  This script writes demo consultations and wallet rows. It is for the local');
  console.error('  JSON store only — never the production document.');
  process.exit(1);
}

/** Deterministic ids, so a second --seed updates rather than duplicates. */
const PAID = [
  { id: 'demo-ma-c1', client: 'Sofiane Meziane', minutes: 60, amount: 4000, daysAgo: 26, topic: 'Préparation du dossier ANADE et plan de financement.' },
  { id: 'demo-ma-c2', client: 'Lydia Bensalem', minutes: 60, amount: 4000, daysAgo: 19, topic: 'Revue du business plan avant le comité d’investissement.' },
  { id: 'demo-ma-c3', client: 'Karim Ould Ali', minutes: 30, amount: 2000, daysAgo: 12, topic: 'Question rapide sur la structuration du capital.' },
  { id: 'demo-ma-c4', client: 'Nassima Gharbi', minutes: 60, amount: 4000, daysAgo: 8, topic: 'Modèle financier à trois ans pour une marketplace.' },
  { id: 'demo-ma-c5', client: 'Yanis Aït Larbi', minutes: 30, amount: 2000, daysAgo: 5, topic: 'Choix du statut juridique de la startup.' },
  { id: 'demo-ma-c6', client: 'Amel Zerrouki', minutes: 60, amount: 4000, daysAgo: 2, topic: 'Stratégie de levée de fonds seed en Algérie.' },
];

/** Two upcoming free discovery calls — the profile advertises one. */
const UPCOMING = [
  { id: 'demo-ma-u1', client: 'Ryad Belkacemi', minutes: 30, inDays: 2, topic: 'Premier échange — projet de plateforme logistique.' },
  { id: 'demo-ma-u2', client: 'Imene Tounsi', minutes: 30, inDays: 4, topic: 'Premier échange — application de santé.' },
];

const WITHDRAWAL_AMOUNT = 6000;

function iso(daysFromNow: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function findMentorId(): Promise<string | null> {
  const data = await db.read();
  return (data.mentors ?? []).find((m) => m.email === DEMO_EMAIL)?.id ?? null;
}

async function seed(mentorId: string): Promise<void> {
  // ── 1. The bits an admin would normally do ───────────────────────────────
  await db.update((d) => {
    const mentor = (d.mentors ?? []).find((m) => m.id === mentorId);
    if (!mentor) return;
    mentor.approvalStatus = 'APPROVED';
    mentor.publiclyListed = true;
    // Verifying for real would send an SMS to the number on the account.
    mentor.phoneVerified = true;
  });
  console.log('✔ approved + phone marked verified');

  // ── 2. Consultations ─────────────────────────────────────────────────────
  await db.update((d) => {
    if (!Array.isArray(d.mentorBookings)) d.mentorBookings = [];
    const rows = d.mentorBookings;
    const put = (row: Record<string, unknown>) => {
      const at = rows.findIndex((b) => b.id === row.id);
      if (at >= 0) rows[at] = { ...rows[at], ...row } as unknown as (typeof rows)[number];
      else rows.push(row as unknown as (typeof rows)[number]);
    };

    for (const c of PAID) {
      const scheduled = iso(-c.daysAgo, 10);
      put({
        id: c.id,
        mentorId,
        userId: null,
        userName: c.client,
        userEmail: `${c.client.toLowerCase().replace(/[^a-z]+/g, '.')}@example.dz`,
        userPhone: '+213555111222',
        message: c.topic,
        status: 'COMPLETED',
        adminNote: null,
        consultationDate: scheduled.slice(0, 10),
        consultationTime: '10:00',
        durationMinutes: c.minutes,
        scheduledAt: scheduled,
        chargeType: 'PAID',
        amountCharged: c.amount,
        consultantShareBase: c.amount,
        tierDiscountAmount: 0,
        promoDiscountAmount: 0,
        appliedPromoCode: null,
        promoDiscountPercent: 0,
        source: 'guest',
        guestLocale: 'fr',
        instantBook: true,
        paymentStatus: 'PAID',
        meetingMode: 'ONLINE',
        meetingLink: 'https://meet.google.com/mohamed-amine-metwork',
        meetingAddress: null,
        meetingMapsLink: null,
        createdAt: iso(-c.daysAgo - 3, 9),
        updatedAt: scheduled,
        completedAt: scheduled,
      });
    }

    for (const u of UPCOMING) {
      const scheduled = iso(u.inDays, 9);
      put({
        id: u.id,
        mentorId,
        userId: null,
        userName: u.client,
        userEmail: `${u.client.toLowerCase().replace(/[^a-z]+/g, '.')}@example.dz`,
        userPhone: '+213555111333',
        message: u.topic,
        status: 'READY',
        adminNote: null,
        consultationDate: scheduled.slice(0, 10),
        consultationTime: '09:00',
        durationMinutes: u.minutes,
        scheduledAt: scheduled,
        // Free discovery call — the profile offers one, and it keeps these
        // upcoming sessions out of the revenue figures.
        chargeType: 'FREE_QUOTA',
        amountCharged: 0,
        source: 'guest',
        guestLocale: 'fr',
        instantBook: true,
        paymentStatus: 'PAID',
        meetingMode: 'ONLINE',
        meetingLink: 'https://meet.google.com/mohamed-amine-metwork',
        createdAt: iso(-1, 15),
        updatedAt: iso(-1, 15),
      });
    }
  });
  console.log(`✔ ${PAID.length} completed consultations + ${UPCOMING.length} upcoming free intros`);

  // ── 3. Money, through the real ledger ────────────────────────────────────
  for (const c of PAID) {
    await creditPendingEarning({ mentorId, bookingId: c.id, grossAmount: c.amount });
    // A consultation's credit is held until the session completes; these are
    // all past sessions, so release them the same way the real flow does.
    await releaseToAvailable({ mentorId, bookingId: c.id });
  }
  // The ledger stamps every row with "now". An earnings history where all
  // eight entries share one timestamp reads as fabricated the moment anyone
  // looks at it, so each row is dated to the session it came from.
  await db.update((d) => {
    const when = new Map(PAID.map((c) => [c.id, iso(-c.daysAgo, 10)]));
    for (const t of d.mentorLedgerTxns ?? []) {
      if (t.mentorId !== mentorId) continue;
      const at = when.get(t.bookingId ?? '');
      if (!at) continue;
      t.createdAt = at;
      if (t.completedAt) t.completedAt = at;
    }
  });

  const view = await getMentorLedgerView(mentorId);
  console.log(`✔ ledger: available ${view.wallet.availableBalance} · pending ${view.wallet.pendingBalance} DZD`);

  // ── 4. One pending withdrawal ────────────────────────────────────────────
  const existing = (await db.read()).mentorWithdrawals?.find(
    (w) => w.mentorId === mentorId && w.status === 'PENDING',
  );
  if (existing) {
    console.log(`• withdrawal already pending (${existing.amount} DZD) — left alone`);
  } else {
    const res = await createWithdrawalRequest({
      targetType: 'mentor',
      targetId: mentorId,
      amount: WITHDRAWAL_AMOUNT,
      method: 'bank_transfer',
    });
    console.log(res.ok ? `✔ withdrawal requested: ${WITHDRAWAL_AMOUNT} DZD` : `✘ withdrawal failed: ${res.reason}`);
  }

  const after = await getMentorLedgerView(mentorId);
  const gross = PAID.reduce((s, c) => s + c.amount, 0);
  console.log('');
  console.log(`  brut        ${gross} DZD`);
  console.log(`  commission  ${gross - after.txns.filter((t) => t.type === 'EARNING' || t.type === 'REVERSAL').reduce((s, t) => s + t.amount, 0)} DZD`);
  console.log(`  disponible  ${after.wallet.availableBalance} DZD`);
  console.log(`  en attente  ${after.wallet.pendingBalance} DZD`);
}

async function purge(mentorId: string): Promise<void> {
  const ids = new Set([...PAID, ...UPCOMING].map((x) => x.id));
  await db.update((d) => {
    d.mentors = (d.mentors ?? []).filter((m) => m.id !== mentorId);
    d.mentorBookings = (d.mentorBookings ?? []).filter((b) => b.mentorId !== mentorId && !ids.has(b.id));
    d.mentorWallets = (d.mentorWallets ?? []).filter((w) => w.mentorId !== mentorId);
    d.mentorLedgerTxns = (d.mentorLedgerTxns ?? []).filter((t) => t.mentorId !== mentorId);
    d.mentorSessions = (d.mentorSessions ?? []).filter((s) => s.mentorId !== mentorId);
    // Consultant payouts live in their own collection, parallel to the
    // userId-keyed `withdrawalRequests` — see `requestMentorWithdrawal`.
    d.mentorWithdrawals = (d.mentorWithdrawals ?? []).filter((w) => w.mentorId !== mentorId);
    d.otps = (d.otps ?? []).filter((o) => !String(o.userId ?? '').includes(mentorId) && o.userId !== DEMO_EMAIL);
  });
  console.log(`✔ purged the demo consultant and everything attached to it (${mentorId})`);
}

async function main(): Promise<void> {
  const mentorId = await findMentorId();
  if (!mentorId) {
    console.error(`✘ No consultant with ${DEMO_EMAIL} in the local store.`);
    console.error('  Sign up first at http://localhost:3000/mentordashboard/login (the code is');
    console.error('  printed to the dev-server console when Resend is unconfigured).');
    process.exit(1);
  }
  console.log(`${MODE === 'seed' ? 'Seeding' : 'Purging'} ${DEMO_EMAIL} → ${mentorId}`);
  if (MODE === 'seed') await seed(mentorId);
  else await purge(mentorId);
}

void main();
