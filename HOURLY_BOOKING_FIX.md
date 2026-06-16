# Hourly space booking — root cause & fix

**Date:** 2026-06-16
**Scope:** `src/components/features/spaces/space-booking-form.tsx` + `i18n/{en,fr,ar}` (client-only; **no server changes**)

## Symptom

Hourly space bookings were broken — most visibly **as a guest**. A guest who
selected "hourly" was silently charged the **full-day rate**, and the hourly
option could not be kept selected on listings that offer both an hourly and a
daily rate (the common WeWork/Regus case).

## Root cause

It was **not** a missing payload, a null price, or a schema rejection. Guest
payloads correctly carried `startsAt`/`endsAt`/`unit`, and the card schema
accepts them.

The bug was the silent **7-hour auto-convert** effect in the booking form:

```ts
// old space-booking-form.tsx
useEffect(() => {
  if (unit !== 'HOUR') return;
  ...
  const diffMins = parseTime(endTime) - parseTime(startTime);
  if (diffMins > MAX_HOURLY_MINUTES) {        // 420 = 7h
    if (hasDayUnit) setUnit('DAY');           // ← silent flip to DAY
    else setEndTime(maxHourlyEndTime);
  }
}, [...]);
```

The form's default times are the space's **full working span**
(`startTime = openingTime` 09:00, `endTime = closingTime` 18:00). On a space that
offers **both** hourly and daily pricing:

1. On mount `unit = 'HOUR'`, times = 09:00–18:00 → `diffMins = 540 > 420` → the
   effect immediately flips `unit` to `DAY`.
2. If the user then picks "Hourly" again, the times are *still* the full-day span,
   so the effect fires on the next render and **flips it straight back to DAY**.

**Result:** a space offering hourly + daily could never stay in Hourly mode; the
booking silently went through as a full-day booking at the day rate. For a guest
(whose only path is the card checkout) this surfaced as being charged the full
day price for what they selected as hourly.

Spaces that offer **only** hourly (`hasDayUnit === false`) took the `else` branch
(hard-cap at 7h) and limped along — which is why the break only showed on the
common hourly **+** daily listing.

## Fix

Removed the silent auto-convert and replaced it with an **explicit booking-mode
toggle** (Hourly / Full day / Monthly) plus an **explicit, customer-visible**
"7 hours or more is billed as a full day" rule.

- **Mode toggle** (`Booking type`): segmented control derived from the rates the
  space actually offers. Switching mode seeds a valid default window:
  - **Hourly** → a 1-hour slot from opening (`open → open+1h`), single-day.
  - **Full day / Monthly** → the full opening–closing span (the scheduler also
    pins these).
- **No more revert loop:** `unit` state never auto-changes. The ≥7h rule is
  expressed as a derived `effectiveUnit` used **only** for pricing + the submitted
  unit — the UI stays in Hourly mode:

  ```ts
  const hourlyMinutes = unit === 'HOUR' && validRange ? parseTime(endTime) - parseTime(startTime) : 0;
  const billedAsDay   = unit === 'HOUR' && hasDayUnit && hourlyMinutes >= MAX_HOURLY_MINUTES;
  const effectiveUnit = billedAsDay ? 'DAY' : unit;
  ```
- **Explicit message:** the hint "7 hours or more is billed as a full day" is
  shown in Hourly mode, and a matching note appears in the price summary when the
  rule actually fires. With no day rate we never invent one — the end-time picker
  already caps the hourly window at 7h.
- **Live price preview:** Hourly = `pricePerHour × hours`; Full day =
  `pricePerDay`; reflects the ≥7h→day switch. Server still recomputes on submit.
- Both guest (`/api/bookings/card`) and registered (`/api/bookings`) calls now
  send `effectiveUnit` through the **same** `startsAt`/`endsAt` + overlap path.

### Why no server change / why this is safe (server-authoritative money)

Pricing was already server-authoritative per `unit`
(`unitPrice(space, unit) × computeQuantity()`), and working-hours + overlap +
capacity validation are untouched. The mode toggle only selects which
already-validated unit/price applies. The client can never underpay: sending the
"wrong" unit only ever raises the charge, and the ≥7h→day conversion is
customer-favorable (day rate ≤ 7×hourly). No DB fields added.

## How to test

Use the seeded local space `qa-space-id-001` (Hour 500 / Day 3,000, open 09:00–18:00,
Mon–Fri) with `USE_LOCAL_DB=true`.

| Scenario | Steps | Expected |
|---|---|---|
| Guest hourly | Open space → Continue as guest → Hourly, 09:00–11:00, fill contact, Pay | `POST /api/bookings/card` → 201 `{token, payPath}`; booking `unit=HOUR, quantity=2, totalAmount=1000` |
| Guest full day | Toggle **Full day** | Price `3,000 DZD × 1 day`; full-day hint shown |
| Mode stays selected | Full day → Hourly | Stays on **Hourly** (no auto-revert), resets to 500 DZD/1hr |
| ≥7h → full day | Hourly, end 16:00 (7h) | Stays Hourly UI; price `3,000 DZD × 1 day`; "billed as a full day" note |
| Registered hourly | Logged-in `POST /api/bookings` HOUR 09:00–11:00 | priced `required=1000` (500×2), wallet path (not day rate) |
| Overlap rejected | Book a window overlapping an active booking | `OVERLAP_CONFLICT` |
| Outside working hours | 07:00–08:00 | `OUTSIDE_WORKING_HOURS` |
| Not a working day | Saturday | `NOT_A_WORKING_DAY` |
| end ≤ start | endsAt ≤ startsAt | `VALIDATION_ERROR` (schema) + client blocks submit |

All of the above were verified live against the local dev server, plus
`npm run test` (37/37) and `npx tsc --noEmit` (0 new errors).
