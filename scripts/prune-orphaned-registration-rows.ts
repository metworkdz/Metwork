/**
 * Remove registration form fields and registrations whose program or event no
 * longer exists.
 *
 * WHY THIS EXISTS
 * Deleting a program or event used to splice the listing and stop there, so its
 * application form and its registrations were left pointing at an id that no
 * longer resolves. Nothing reads them — every dashboard query is scoped by
 * entity — so they accumulated invisibly. Production carried 11 such rows from
 * two deleted programs. The delete handlers now cascade
 * (`pruneListingChildrenSync`); this clears what they left behind.
 *
 * WHAT IT WILL NOT TOUCH
 *   • Anything belonging to a listing that still exists.
 *   • BOOKINGS and transactions, orphaned or not. Money that moved stays
 *     auditable even when the listing is gone, and a receipt already in
 *     someone's inbox must still correspond to a record. Orphaned bookings are
 *     inert — `countAttendance` is always scoped to a live listing — so they
 *     are reported here for visibility and deliberately left alone.
 *
 * SAFETY
 *   • Dry run by default. Pass `--confirm` to write.
 *   • Names the database it is about to touch, and refuses a placeholder.
 *   • Idempotent: a second run finds nothing.
 *   • Take a snapshot first: `npx tsx scripts/backup-app-state.ts`
 *
 *   npx tsx scripts/prune-orphaned-registration-rows.ts             # dry run
 *   npx tsx scripts/prune-orphaned-registration-rows.ts --confirm   # write
 *   USE_LOCAL_DB=true npx tsx scripts/prune-orphaned-registration-rows.ts
 */

// Credentials BEFORE any import that touches store.ts — see scripts/_env.ts.
import { loadScriptEnv } from './_env';

const TARGET = loadScriptEnv();

import { db } from '../src/server/db/store';

/** Group orphans by the entity they point at, so the report reads per-listing. */
function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');

  console.log(
    `\n→ ${TARGET.kind === 'local' ? 'LOCAL JSON store' : 'SUPABASE'}: ${TARGET.label}` +
      `  (${confirm ? 'WILL WRITE' : 'dry run'})`,
  );

  const data = await db.read();
  const liveProgramIds = new Set((data.programs ?? []).map((p) => p.id));
  const liveEventIds = new Set((data.events ?? []).map((e) => e.id));

  const isOrphan = (entityType: string, entityId: string): boolean =>
    entityType === 'PROGRAM' ? !liveProgramIds.has(entityId) : !liveEventIds.has(entityId);

  const orphanFields = (data.registrationFormFields ?? []).filter((f) =>
    isOrphan(f.entityType, f.entityId),
  );
  const orphanRegs = (data.registrations ?? []).filter((r) =>
    isOrphan(r.entityType, r.entityId),
  );
  // Reported for visibility only — never pruned. See the header.
  const orphanBookings = (data.bookings ?? []).filter(
    (b) =>
      (b.itemKind === 'PROGRAM' && !liveProgramIds.has(b.itemId)) ||
      (b.itemKind === 'EVENT' && !liveEventIds.has(b.itemId)),
  );

  console.log(`\nLive listings: ${liveProgramIds.size} program(s), ${liveEventIds.size} event(s)`);
  console.log(`  orphaned form fields   : ${orphanFields.length}`);
  console.log(`  orphaned registrations : ${orphanRegs.length}`);
  console.log(`  orphaned bookings      : ${orphanBookings.length}  (kept — financial record)\n`);

  for (const [entityId, rows] of groupBy(orphanFields, (f) => f.entityId)) {
    console.log(`  entity ${entityId.slice(0, 8)}… — ${rows.length} field(s)`);
    for (const f of rows.slice(0, 4)) console.log(`      · ${f.label}`);
    if (rows.length > 4) console.log(`      · …and ${rows.length - 4} more`);
  }
  for (const [entityId, rows] of groupBy(orphanRegs, (r) => r.entityId)) {
    console.log(`  entity ${entityId.slice(0, 8)}… — ${rows.length} registration(s)`);
    for (const r of rows.slice(0, 4)) console.log(`      · ${r.email}`);
  }

  const total = orphanFields.length + orphanRegs.length;
  if (total === 0) {
    console.log('\nNothing to prune.');
    return;
  }
  if (!confirm) {
    console.log('\nDRY RUN — nothing written. Re-run with --confirm to apply.');
    return;
  }

  const fieldIds = new Set(orphanFields.map((f) => f.id));
  const regIds = new Set(orphanRegs.map((r) => r.id));

  const removed = await db.update((d) => {
    // Re-derive liveness inside the lock: a listing could have been created
    // between the read and the write, and a row is only an orphan if its
    // listing is STILL missing.
    const progs = new Set((d.programs ?? []).map((p) => p.id));
    const evts = new Set((d.events ?? []).map((e) => e.id));
    const stillOrphan = (entityType: string, entityId: string): boolean =>
      entityType === 'PROGRAM' ? !progs.has(entityId) : !evts.has(entityId);

    const beforeFields = (d.registrationFormFields ?? []).length;
    d.registrationFormFields = (d.registrationFormFields ?? []).filter(
      (f) => !(fieldIds.has(f.id) && stillOrphan(f.entityType, f.entityId)),
    );
    const beforeRegs = (d.registrations ?? []).length;
    d.registrations = (d.registrations ?? []).filter(
      (r) => !(regIds.has(r.id) && stillOrphan(r.entityType, r.entityId)),
    );

    return {
      fields: beforeFields - d.registrationFormFields.length,
      registrations: beforeRegs - (d.registrations ?? []).length,
    };
  });

  console.log(
    `\n✅ Pruned ${removed.fields} form field(s) and ${removed.registrations} registration(s).` +
      ' Re-running is safe — a second pass finds nothing.',
  );
}

// Only run when invoked directly; importing must never touch the database.
if (process.argv[1]?.includes('prune-orphaned-registration-rows')) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
