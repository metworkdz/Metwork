# Space Availability & Duration Discounts

Airbnb-style date blocking, capacity-aware mixed-mode occupancy, and per-space
duration discounts for coworking spots, meeting rooms, and training rooms.

Phase 1 of a two-phase plan. (Phase 2 — explicit half-day pricing — is deferred;
weekly pricing is already expressible through the duration-discount engine below.)

---

## 1. Schema (additive, backward-compatible)

Both new fields on `SpaceRecord` (`src/server/db/store.ts`) are optional and
default to "none", so the `{ ...empty, ...parsed }` load merge keeps working for
existing records.

```ts
interface SpaceRecord {
  // … existing …
  /** Full-day blocks (legacy, still authoritative). */
  unavailableDates?: string[];
  /** Blackouts: whole-day when from/to absent, else a time range on that date. */
  blackouts?: { date: string; from?: string; to?: string }[];
  /** Duration discounts, e.g. { unit:'DAY', minQty:3, percent:10 } = 3+ days → 10% off. */
  durationDiscounts?: { unit: 'HOUR' | 'DAY'; minQty: number; percent: number }[];
}
```

`durationDiscounts` is surfaced on the domain `Space` (`src/types/domain.ts` +
`space-catalog.ts`) so the booking form can preview the server-applied discount.

---

## 2. The shared validator — `src/server/bookings/availability.ts`

ONE function, called from EVERY booking-creation path so the rules can never
diverge:

```ts
checkSpaceAvailability({ space, bookings, spaceId, unit, startsAt, endsAt, ignoreBookingId? })
  → { ok: true }
  | { ok: false; reason: 'DATE_UNAVAILABLE'; blockedDates }
  | { ok: false; reason: 'OVERLAP_CONFLICT'; conflictingBookingId }   // capacity 1
  | { ok: false; reason: 'CAPACITY_EXCEEDED'; capacity; taken }        // capacity > 1
```

It is pure & synchronous (takes a bookings snapshot, never touches the store), so
each caller runs it inside its own `db.update` critical section.

### Rules it enforces

1. **Blackouts** — a date in `unavailableDates`, a whole-day `blackouts` entry, or
   a time-range `blackouts` entry the window overlaps → `DATE_UNAVAILABLE`.
   Blocks EVERYONE, including the incubator's own manual bookings. No bypass — the
   incubator must unblock the date first.

2. **Capacity-aware occupancy (mixed-mode).** Each active booking occupies ONE
   capacity unit. A full-day booking (`unit` DAY/MONTH) occupies its unit for the
   WHOLE calendar day(s) it covers; an hourly booking only for its time window. A
   request is allowed iff peak concurrency over its window stays below capacity.
   - **capacity 1** (training room, private office): any overlap → `OVERLAP_CONFLICT`.
     This reproduces the "one mode per day" rule exactly — a 9–12 hourly booking
     blocks a full-day booking, a full-day booking blocks everything, and the
     remaining 12–17 hours stay hourly-bookable.
   - **capacity N** (coworking, N desks): up to N concurrent bookings; the
     (N+1)-th overlapping booking → `CAPACITY_EXCEEDED`. One day-booking on Jun 5
     leaves 4 of 5 desks; a month-from-Jun-5 booking still fits.

`PENDING_PAYMENT` / `CANCELLED` / `REFUNDED` bookings hold no seat and are ignored
(matches the existing card-intent seat model).

> Working-hours validation stays separate (`validateWorkingHours`) — its
> `OUTSIDE_WORKING_HOURS` / `NOT_A_WORKING_DAY` messages are distinct.

### Discount helpers (same file)

```ts
bestDurationDiscountPercent(rules, unit, quantity) → percent 0–100  // HOUR→HOUR, DAY/MONTH→DAY, highest wins
applyDiscountPercent(amount, percent) → rounded integer DZD
```

---

## 3. Enforcement points (all share the validator)

| Path | File | What changed |
|------|------|--------------|
| Wallet / cash-reserve / network-pass | `service.ts` `createSpaceBooking` | pre-lock + in-lock `checkSpaceAvailability`; duration discount applied to price |
| Card intent | `card-payment.ts` `resolveTarget` + intent lock | shared check; duration discount in server total |
| Card **settlement** | `card-payment.ts` `applyCardSettlement` | binding re-check (now also re-checks blackouts → a date blocked after payment voids the booking as `SLOT_TAKEN`, manual refund) |
| Manual booking A | `POST /api/incubator/bookings` | replaced inline overlap with shared check |
| Manual booking B | `POST /api/incubator/manual-bookings` | added shared check (was unchecked); normalizes date-only input to a real window |

**Money math is server-side.** Discount order in the online/card flows:
`price → duration discount → membership discount → promo code`. Manual bookings
keep the **operator-entered amount** (no auto-discount, per product decision).

---

## 4. Incubator UI

- **Availability calendar** — `space-availability-dialog.tsx`, opened per space
  from the spaces list ("Availability" action, desktop + mobile). Month grid
  (`AvailabilityCalendar` in `block` mode): tap a date to block/unblock; optional
  time-range block; fully-booked days shown read-only. Persists the full
  replacement set via `PUT /api/incubator/spaces/:id/availability`
  (`unavailableDates` + `blackouts`).
- **Duration discounts** — section in `space-form-dialog.tsx`: add/remove rows
  (unit, min qty, percent). Validated `0 < percent < 100`, `minQty > 0` on client
  and server (create + PATCH schemas).

## 5. Booking forms

- Public `space-booking-form.tsx` previews the applied duration discount in the
  live price (server remains authoritative). Blocked/fully-booked dates are
  greyed by the scheduler via the month availability endpoint, which now also
  returns `blockedDates`, `fullyBookedDates`, `partialBlackouts`, and
  `remainingByDate` (desks left per day).

---

## 6. Test steps

Automated: `src/__tests__/space-availability.test.ts` (17 cases) covers blackouts,
capacity-1 mixed-mode, capacity-5 coworking concurrency, PENDING_PAYMENT, and the
discount helper. Run: `npx vitest run src/__tests__/space-availability.test.ts`.

Manual (USE_LOCAL_DB, seeded `test.incubator@metwork.test`):
1. Block a date in the calendar → public booking on that date → `DATE_UNAVAILABLE`.
2. Same blocked date → manual booking → rejected (no bypass).
3. Unblock the date → manual booking succeeds.
4. Capacity-1 room: book hourly 9–12 → full-day rejected; another hourly 13–14 OK.
5. Capacity-1 room: book full-day → any hourly that day rejected.
6. Capacity-5 coworking: 5 day-bookings on a date → 6th rejected; other days OK.
7. Configure "3+ days → 10% off" → a 3-day booking shows/charges −10%.
8. Configure "20+ hours → 15% off" → a 20-hour booking shows/charges −15%.
9. No rule → no discount. Existing overlap still rejected.

---

## 7. Half-day plans (Phase 2)

A new `HALF_DAY` booking unit with a flat price and an **incubator-configured
window** (`halfDayStart`/`halfDayEnd`, "HH:MM"). Weekly pricing remains expressed
through the duration-discount engine (≥7-day tier); explicit half-day is the only
new plan here.

- **Schema** (`SpaceRecord`, all nullable): `pricePerHalfDay`, `cashPricePerHalfDay`,
  `halfDayStart`, `halfDayEnd`. `BookingUnit = 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH'`.
- **Pricing** (`unitPrice`/`availableUnits`/`computeQuantity`): HALF_DAY → flat
  `pricePerHalfDay` (cash falls back to it), quantity always 1. Offered only when
  `pricePerHalfDay` is set.
- **Occupancy**: a half-day occupies its real `[halfDayStart, halfDayEnd)` window
  (a sub-day footprint like HOUR), so on a **capacity-1 room a morning and an
  afternoon half-day coexist**, the remaining hours stay hourly-bookable, and a
  full-day booking still blocks the whole day. Duration discounts don't apply to a
  flat half-day (it maps to the HOUR rule bucket with quantity 1).
- **Incubator editor**: a "Per half-day" price + a "Half-day hours" start/end picker
  (shown when a half-day price is entered; validated `start < end`).
- **Public form**: a "Half day" mode books the fixed window — single-day pick, times
  read-only from the space config, flat price. The detail-page pricing list shows it.
- **Manual booking + receipts**: HALF_DAY accepted in both manual routes and labelled
  in PDF receipts.

Verified: configured 1,500 DZD half-day (09:00–13:00) → card booking persisted
`unit=HALF_DAY, quantity=1, totalAmount=1500`; booking form shows the three modes
and the "fixed window 09:00 – 13:00" hint. Tests in `space-availability.test.ts`
cover half-day pricing, AM/PM coexistence on capacity-1, and the full-day block.
