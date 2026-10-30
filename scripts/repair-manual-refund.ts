/**
 * Record a refund that was paid BY HAND, so the books match what happened.
 *
 * WHY THIS EXISTS
 * A client of a consultant's paid program asked for a refund before the refund
 * engine existed. The consultant withdrew the sale, the admin paid the client
 * out of their own account, and the booking stayed CONFIRMED with the
 * consultant's earning and Metwork's fee still on the ledger.
 *
 * WHAT IT DOES (through the SAME code a normal refund runs)
 *   • reverses the owner's earning and marks Metwork's commission REVERSED;
 *   • frees the seat (booking REFUNDED, registration CANCELLED);
 *   • stores a refund record flagged `paidOffPlatform`: no wallet credit and no
 *     email goes to the client, because they were already paid.
 *   With `--trainer-repaid` the consultant is treated as having sent the sale
 *   amount back to Metwork outside the platform: their wallet is left alone and
 *   no debt is recorded. Without it, anything already withdrawn becomes a debt.
 *
 * SAFETY
 *   • Dry run by default: lists the paid consultant-program bookings (or the one
 *     given) with their ledger state. `--confirm` writes. Needs `--booking=<id>`.
 *   • Idempotent: a booking already refunded is refused.
 *   • Take a snapshot first: `npx tsx scripts/backup-app-state.ts`
 *
 *   npx tsx scripts/repair-manual-refund.ts                         # list candidates
 *   npx tsx scripts/repair-manual-refund.ts --booking=<id>          # inspect one
 *   npx tsx scripts/repair-manual-refund.ts --booking=<id> --trainer-repaid --confirm
 */
import { loadScriptEnv } from './_env';

const TARGET = loadScriptEnv();

async function main() {
  const args = process.argv.slice(2);
  const flag = (n: string) => args.includes(`--${n}`);
  const value = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const bookingId = value('booking');
  const confirm = flag('confirm');
  const trainerRepaid = flag('trainer-repaid');

  // Dynamic imports: env.ts validates at load, so they must come after loadScriptEnv().
  const { db } = await import('../src/server/db/store');
  const { recordOffPlatformRefund } = await import('../src/server/refunds/service');

  console.log(`Target database: ${TARGET.label} (${TARGET.kind})`);
  const d = await db.read();
  const fmt = (n: number) => `${n.toLocaleString('fr-DZ')} DZD`;

  const mentorOwned = d.bookings.filter((b) => {
    if (b.itemKind !== 'PROGRAM' || b.paymentMethod !== 'card' || !b.settledAt) return false;
    return Boolean(d.programs?.find((p) => p.id === b.itemId)?.mentorId);
  });
  const candidates = bookingId ? d.bookings.filter((b) => b.id === bookingId) : mentorOwned;
  if (candidates.length === 0) {
    console.log(bookingId ? `No booking ${bookingId}.` : 'No paid consultant-program bookings found.');
    return;
  }

  for (const b of candidates) {
    const program = d.programs?.find((p) => p.id === b.itemId);
    const mentorId = program?.mentorId ?? null;
    const mentor = (d.mentors ?? []).find((m) => m.id === mentorId);
    const wallet = (d.mentorWallets ?? []).find((w) => w.mentorId === mentorId);
    const earning = (d.mentorLedgerTxns ?? []).find((t) => t.mentorId === mentorId && t.reference === `mentor-earning-${b.id}`);
    const commission = (d.mentorLedgerTxns ?? []).find((t) => t.mentorId === mentorId && t.reference === `mentor-commission-${b.id}`);
    const withdrawals = (d.mentorWithdrawals ?? []).filter((w) => w.mentorId === mentorId);
    const refund = (d.refundRequests ?? []).find((r) => r.sourceKind === 'BOOKING' && r.sourceId === b.id);

    console.log('\n──────────────────────────────────────────');
    console.log(`Booking   ${b.id}  [${b.status}]  ${b.itemName}`);
    console.log(`Client    ${b.clientName ?? '—'} <${b.clientEmail ?? '—'}>`);
    console.log(`Paid      ${fmt(b.onlineChargeAmount ?? b.onlinePaidAmount ?? 0)}   (provider ref ${b.paymentProviderRef ?? '—'})`);
    console.log(`Consultant ${mentor?.fullName ?? '—'}`);
    console.log(`  earning ${earning ? `${fmt(earning.amount)} [${earning.status}]` : 'none'}   commission row ${commission ? `[${commission.status}]` : 'none'}`);
    console.log(`  wallet  available ${fmt(wallet?.availableBalance ?? 0)}, pending ${fmt(wallet?.pendingBalance ?? 0)}, debt ${fmt(wallet?.debtBalance ?? 0)}`);
    console.log(`  withdrawals: ${withdrawals.length === 0 ? 'none' : withdrawals.map((w) => `${fmt(w.amount)} ${w.status}`).join(', ')}`);
    console.log(`Refund record: ${refund ? `${refund.status}${refund.paidOffPlatform ? ' (paid by hand)' : ''}` : 'none'}`);
  }

  if (!bookingId) {
    console.log('\nRe-run with --booking=<id> to inspect or repair one.');
    return;
  }
  if (!confirm) {
    console.log(`\nDRY RUN. Would reverse the earning and fee ${trainerRepaid ? 'and leave the consultant wallet untouched (trainer repaid Metwork)' : 'and record any withdrawn amount as consultant debt'}. Add --confirm to write.`);
    return;
  }

  const admin = d.users.find((u) => u.role === 'ADMIN');
  if (!admin) throw new Error('No admin user found to attribute the record to.');
  const result = await recordOffPlatformRefund({
    sourceKind: 'BOOKING', sourceId: bookingId, adminId: admin.id,
    reason: 'Refund paid by hand before the refund engine existed', recoveredOffPlatform: trainerRepaid,
  });
  if (!result.ok) {
    console.error(`Refused: ${result.reason}`);
    process.exit(1);
  }
  console.log(`\nDone. Refund ${result.request.id} recorded. Reversal:`, result.request.reversal);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
