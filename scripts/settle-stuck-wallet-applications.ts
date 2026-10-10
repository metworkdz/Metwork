/**
 * Settle program / event applications that were PAID from the wallet but left
 * PENDING in escrow.
 *
 * WHY THIS EXISTS
 * Until the fix in `settleWalletApplicationDraft` (src/server/bookings/service.ts),
 * a wallet application debited the client and wrote the booking PENDING, waiting
 * for the incubator to press Confirm — a button the bookings page no longer
 * shows. The money never reached the incubator, no registration row was written,
 * and the host saw an unpaid booking. Production carried one such booking
 * (« Techniques de Ventes et Négociations », 23 000 DZD, 2026-10-07).
 *
 * WHAT IT DOES, per booking — through the SAME code a new wallet payment runs:
 *   • PENDING → CONFIRMED + PAID, settledAt stamped;
 *   • credits the owning incubator net of the receiver commission
 *     (`incubator-payout.ts`, the card rail's engine);
 *   • writes the participant row, linked by bookingId;
 *   • then sends the registration confirmation and the receipt (exactly-once
 *     dispatchers; `--no-email` skips them).
 *
 * WHAT IT WILL NOT TOUCH
 *   • Anything whose wallet debit cannot be found as a COMPLETED PAYMENT of the
 *     booking's exact amount — no proof of payment, no settlement.
 *   • Cancelled or deleted bookings, and space bookings (their escrow flow is
 *     separate and still has its own confirm path).
 *
 * SAFETY
 *   • Dry run by default. `--confirm` to write. `--booking=<id>` to limit.
 *   • Re-checks every condition inside the write; idempotent (a second run
 *     finds nothing, and a payout already present for the booking is refused).
 *   • Take a snapshot first: `npx tsx scripts/backup-app-state.ts`
 *
 *   npx tsx scripts/settle-stuck-wallet-applications.ts
 *   npx tsx scripts/settle-stuck-wallet-applications.ts --confirm
 *   USE_LOCAL_DB=true LOCAL_DB_PATH=/tmp/x.json npx tsx scripts/settle-stuck-wallet-applications.ts --confirm --no-email
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// The mailer reads RESEND_API_KEY / EMAIL_FROM at call time, and a plain tsx
// run gets no Next.js env loading. Supabase credentials go through
// loadScriptEnv, which refuses a placeholder database.
const ENV = path.resolve(process.cwd(), '.env.local');
if (process.env.USE_LOCAL_DB !== 'true' && fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, '');
  }
}

import { loadScriptEnv } from './_env';

const TARGET = loadScriptEnv();

import type { db as Db, BookingRecord } from '../src/server/db/store';

type Data = Awaited<ReturnType<typeof Db.read>>;

/** Stuck = a wallet program/event application, still PENDING, provably paid. */
function isStuck(d: Data, b: BookingRecord): b is BookingRecord & { itemKind: 'PROGRAM' | 'EVENT'; userId: string } {
  if (b.paymentMethod !== 'wallet' || b.status !== 'PENDING' || b.deletedAt) return false;
  if (b.itemKind !== 'PROGRAM' && b.itemKind !== 'EVENT') return false;
  if (!b.userId) return false;
  if (b.totalAmount <= 0) return true;
  const tx = b.transactionId ? d.transactions.find((t) => t.id === b.transactionId) : undefined;
  return Boolean(
    tx && tx.type === 'PAYMENT' && tx.status === 'COMPLETED' && tx.userId === b.userId && tx.amount === -b.totalAmount,
  );
}

async function main(): Promise<void> {
  // Imported only now: static imports are hoisted above the env setup, and
  // src/lib/env.ts validates the environment the moment it is loaded.
  const { db } = await import('../src/server/db/store');
  const { settleWalletApplicationDraft } = await import('../src/server/bookings/service');
  const { dispatchReceiptIfDue } = await import('../src/server/bookings/card-payment');
  const { dispatchRegistrationConfirmationIfDue } = await import('../src/server/registrations/service');

  const confirm = process.argv.includes('--confirm');
  const noEmail = process.argv.includes('--no-email');
  const only = process.argv.find((a) => a.startsWith('--booking='))?.slice('--booking='.length);

  console.log(
    `\n→ ${TARGET.kind === 'local' ? 'LOCAL JSON store' : 'SUPABASE'}: ${TARGET.label}` +
      `  (${confirm ? 'WILL WRITE' : 'dry run'}${confirm && !noEmail ? ' + emails' : ''})`,
  );

  const data = await db.read();
  const stuck = data.bookings.filter((b) => isStuck(data, b) && (!only || b.id === only));

  console.log(`\nStuck wallet applications: ${stuck.length}`);
  for (const b of stuck) {
    const user = data.users.find((u) => u.id === b.userId);
    console.log(
      `  • ${b.id}  ${b.itemKind}  « ${b.itemName} »  ${b.totalAmount} DZD  ` +
        `${user?.fullName ?? '?'} <${user?.email ?? '?'}>  paid ${b.createdAt}`,
    );
  }
  if (!confirm || stuck.length === 0) {
    if (!confirm && stuck.length) console.log('\nDry run — nothing written. Re-run with --confirm.');
    return;
  }

  const ids = stuck.map((b) => b.id);
  const settled = await db.update<string[]>((d) => {
    const done: string[] = [];
    const now = new Date().toISOString();
    for (const id of ids) {
      const b = d.bookings.find((x) => x.id === id);
      // Every condition again, inside the lock — and never a second payout.
      if (!b || !isStuck(d, b)) continue;
      if (d.transactions.some((t) => t.reference === `payout-${b.id}`)) continue;
      settleWalletApplicationDraft(d, b, b.userId, now);
      done.push(b.id);
    }
    return done;
  });

  console.log(`\nSettled: ${settled.length}`);
  const after = await db.read();
  for (const id of settled) {
    const b = after.bookings.find((x) => x.id === id)!;
    const reg = after.registrations.find((r) => r.bookingId === id);
    console.log(
      `  ✓ ${id}  status=${b.status} paymentStatus=${b.paymentStatus} ` +
        `commission=${b.commissionAmount ?? 0}  registration=${reg?.id ?? 'none'}`,
    );
    if (!noEmail) {
      await dispatchRegistrationConfirmationIfDue(id);
      await dispatchReceiptIfDue(id);
      const sent = (await db.read()).bookings.find((x) => x.id === id);
      const regSent = (await db.read()).registrations.find((r) => r.bookingId === id);
      console.log(
        `    confirmation ${regSent?.confirmationSentAt ? 'dispatched' : 'NOT dispatched'}, ` +
          `receipt ${sent?.finalReceiptSentAt ? 'dispatched' : 'NOT dispatched'}`,
      );
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('✘', err);
    process.exit(1);
  },
);
