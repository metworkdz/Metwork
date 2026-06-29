/**
 * Cleanup for the spaces-granularity e2e suite.
 *
 * Removes every artifact the suite (and its fixtures) created from the shared
 * JSON document, so re-runs start clean and the QA db isn't polluted. Operates
 * directly on the local DB file (the server's source of truth in USE_LOCAL_DB
 * mode) — the same file `readLocalDb()` reads — because not every record type
 * has a delete API.
 *
 *   npx playwright test tests/cleanup/spaces-granularity.cleanup.ts
 *
 * Filters (all narrow to test-only data):
 *   • spaces       — name contains "Test " AND owned by the test incubator
 *   • deskBookings — any whose spaceId is one of those test spaces
 *   • domiciliation requests — email endsWith "@metwork-test.dz"
 *   • bookings     — for a test space, OR clientPhone "+213555123456", OR a
 *                    13-digit timestamp in the clientName
 *   • clients      — email endsWith "@metwork-test.dz" (courtesy; not counted)
 */
import { test } from '@playwright/test';
import * as fs from 'node:fs';

const TEST_INCUBATOR_ID = 'qa-incubator-profile-id';
const TEST_PHONE = '+213555123456';
const TEST_EMAIL_DOMAIN = '@metwork-test.dz';

test('cleanup — remove spaces-granularity test data', async () => {
  const p = process.env.LOCAL_DB_PATH ?? '.local-db.json';
  const db = JSON.parse(fs.readFileSync(p, 'utf8')) as {
    spaces?: Array<{ id: string; name: string; incubatorId: string }>;
    deskBookings?: Array<{ spaceId: string }>;
    domiciliationRequests?: Array<{ email: string }>;
    bookings?: Array<{ itemId?: string; clientName?: string | null; clientPhone?: string | null }>;
    clients?: Array<{ email?: string }>;
  };

  const spaces = db.spaces ?? [];
  const testSpaceIds = new Set(
    spaces
      .filter((s) => s.name.includes('Test ') && s.incubatorId === TEST_INCUBATOR_ID)
      .map((s) => s.id),
  );

  // 1) spaces
  const spacesBefore = spaces.length;
  db.spaces = spaces.filter((s) => !testSpaceIds.has(s.id));
  const deletedSpaces = spacesBefore - db.spaces.length;

  // 2) desk bookings for those spaces
  const desk = db.deskBookings ?? [];
  db.deskBookings = desk.filter((d) => !testSpaceIds.has(d.spaceId));
  const deletedDesks = desk.length - db.deskBookings.length;

  // 3) domiciliation requests by test email domain
  const dom = db.domiciliationRequests ?? [];
  db.domiciliationRequests = dom.filter((r) => !(r.email ?? '').endsWith(TEST_EMAIL_DOMAIN));
  const deletedDom = dom.length - db.domiciliationRequests.length;

  // 4) bookings — test space, test phone, or timestamped client name
  const bookings = db.bookings ?? [];
  const isTestBooking = (b: { itemId?: string; clientName?: string | null; clientPhone?: string | null }) =>
    (b.itemId != null && testSpaceIds.has(b.itemId)) ||
    b.clientPhone === TEST_PHONE ||
    (b.clientName != null && /\d{13}/.test(b.clientName));
  db.bookings = bookings.filter((b) => !isTestBooking(b));
  const deletedBookings = bookings.length - db.bookings.length;

  // 5) clients (courtesy — not in the count line)
  const clients = db.clients ?? [];
  db.clients = clients.filter((c) => !(c.email ?? '').endsWith(TEST_EMAIL_DOMAIN));
  const deletedClients = clients.length - db.clients.length;

  fs.writeFileSync(p, JSON.stringify(db, null, 2), 'utf8');

  console.log(
    `Cleanup complete — deleted ${deletedSpaces} spaces, ${deletedDesks} desk bookings, ` +
    `${deletedDom} domiciliation requests, ${deletedBookings} manual booking records` +
    (deletedClients ? ` (+${deletedClients} test clients)` : ''),
  );
});
