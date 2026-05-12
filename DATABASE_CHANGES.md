# Database Changes — Network Passes & Partner Program

**Date:** 2026-05-12
**Touched file:** `src/server/db/store.ts` (+1 client DTO: `src/types/booking.ts`)
**Migration class:** Non-destructive, backward-compatible, no schema migration tool required.

---

## 1. What Changed and Why

Metwork stores all application state as a single JSONB document in Supabase
(`app_state` table, id = 1). The persistence layer is `src/server/db/store.ts`,
which defines a `DbShape` interface and an `empty` seed. New "tables" are
added by adding a key to `DbShape` and to `empty`.

This change introduces the data model for two new features:

- **Entrepreneur Network Passes** — Builder / Founder members get a monthly
  allowance of credits redeemable at any partner space. Each redemption is
  a `NetworkVisitRecord` and the partner space is paid out per visit.
- **Partner Membership Program** — Incubator-owned spaces can opt in to the
  program. They can then issue discounted-membership promo codes (one-time)
  and accept network pass bookings in exchange for a per-visit payout.

### Five new top-level collections (zero-row at startup)

| Key on `DbShape` | Record type | Purpose |
|---|---|---|
| `networkVisits` | `NetworkVisitRecord` | One row per pass redemption — backs the monthly payout batch. |
| `partnerMemberships` | `PartnerMembershipRecord` | One row per Space enrolled in the Partner Program. |
| `partnerPromoCodes` | `PartnerPromoCodeRecord` | Single-use discount codes for Builder/Founder. |
| `partnerPromoCodeBatches` | `PartnerPromoCodeBatchRecord` | Manifest for bulk code generation (1–10 000 per batch). |
| `userPartnerAffiliations` | `UserPartnerAffiliationRecord` | Immutable record of which partner referred each user. |

### Extensions to existing records

**`UserRecord`** — every new field is **optional** for backward compatibility:

- `membershipTier?: 'EXPLORER' | 'BUILDER' | 'FOUNDER'` (defaults to `'EXPLORER'` when reading)
- `membershipStartDate?`, `membershipRenewalDate?` (ISO strings)
- `networkCredits?`, `networkCreditsMax?`, `networkCreditsResetDate?` (ints / ISO)
- `affiliatedPartnerId?`, `membershipDiscountReceived?`
- `networkPassesUsedThisMonth?`, `networkSpacesVisited?: string[]`, `lastNetworkVisit?`

**`SpaceRecord`** — partner-program hooks:

- `partnerMembershipId?: string | null` — link to enrolment record
- `isPartnerInNetwork?: boolean` — denormalised flag for the public spaces filter

**`BookingRecord`** — payment-method union widened:

- `paymentMethod` changed from `'wallet' | 'manual'` to the new exported type
  `BookingPaymentMethod = 'wallet' | 'manual' | 'NETWORK_PASS' | 'PROGRAM' | 'PARTNER_DISCOUNT'`.
- New optional `networkVisitId?: string | null` — links pass-paid bookings to their visit row.

The client DTO (`src/types/booking.ts`) mirrors the widened union via
`BookingPaymentMethodDto` so server and client stay in lockstep.

---

## 2. Migration Strategy

There is no SQL migration. The Supabase store performs schema reconciliation
on every read via:

```ts
cache = { ...empty, ...parsed };
```

This means:

- On the **next read** after deployment, every legacy record in `app_state`
  receives the five new top-level arrays defaulted to `[]`.
- Legacy `UserRecord` rows continue to work; the new fields are `undefined`
  and code must read with defaults (e.g. `user.membershipTier ?? 'EXPLORER'`).
- Legacy `BookingRecord` rows with `paymentMethod: 'wallet' | 'manual'` are
  type-compatible with the new union — narrowed checks (`=== 'wallet'`) still
  type-check correctly.
- Legacy `SpaceRecord` rows have `partnerMembershipId === undefined`, i.e.
  not enrolled. `isPartnerInNetwork` defaults to falsy.

### Backfill recipe (run-once, in application layer)

Because all new fields are optional, no backfill is strictly required on
deploy day. When the Network Pass feature is enabled, run this one-off
script (server action / admin route) to populate the credit fields:

```ts
const allowance = (tier: MembershipTier) =>
  tier === 'FOUNDER' ? 10 : tier === 'BUILDER' ? 3 : 0;

await db.update((d) => {
  const firstOfNextMonth = /* compute next 1st UTC */;
  for (const u of d.users) {
    if (u.membershipTier === undefined) {
      // Derive from membershipCode where possible, else EXPLORER.
      u.membershipTier = resolveTier(u.membershipCode);
    }
    if (u.networkCreditsMax === undefined) {
      u.networkCreditsMax = allowance(u.membershipTier);
      u.networkCredits = u.networkCreditsMax;
      u.networkCreditsResetDate = firstOfNextMonth;
      u.networkPassesUsedThisMonth = 0;
      u.networkSpacesVisited = [];
    }
  }
});
```

Same pattern for SpaceRecord (`isPartnerInNetwork = false`) — but this is
naturally falsy already, so the only reason to backfill is observability.

---

## 3. New Queries Enabled

Because everything lives in a single JSONB document, "indexes" are
in-memory `.filter` / `.find` / `Map` constructions. The following queries
become possible after this change — each is O(N) in the relevant collection
or O(1) with a one-shot `Map` precompute:

```ts
// Builder users referred this month
data.userPartnerAffiliations
  .filter((a) => a.referredAt.startsWith(thisMonth))
  .map((a) => data.users.find((u) => u.id === a.userId));

// Unpaid network visits older than 24 h (payout job)
data.networkVisits
  .filter((v) => v.payoutStatus === 'PENDING' && v.checkedInAt &&
                  Date.parse(v.checkedInAt) < Date.now() - 86_400_000);

// Partner spaces accepting network passes
const partnerIndex = new Map(
  data.partnerMemberships.filter((p) => p.isActive).map((p) => [p.spaceId, p]),
);
data.spaces.filter((s) => partnerIndex.get(s.id)?.acceptNetworkPasses);

// Users with credits remaining
data.users.filter((u) => (u.networkCredits ?? 0) > 0);

// Codes expiring in next 48 h (notifier job)
data.partnerPromoCodes.filter((c) =>
  !c.isUsed && Date.parse(c.validUntil) < Date.now() + 172_800_000);

// Discount cap enforcement
const pm = data.partnerMemberships.find((p) => p.id === partnerId);
const atCap = pm?.maxDiscountedMembers != null &&
              pm.discountedMembersCount >= pm.maxDiscountedMembers;
```

For partner lookups in the booking hot path, build a `Map<spaceId, partner>`
once per request (the JSONB document is already in memory via the 10 s
cache — see `src/server/db/store.ts` "In-process cache" section).

---

## 4. Performance Considerations

- **Single document** — the entire JSONB blob is loaded on first read of
  each serverless invocation. The 10 s in-process cache (`CACHE_TTL_MS`)
  amortises this across requests on the same warm instance.
- **Document size growth** — the five new collections are sized as follows
  at scale: `networkVisits` is the dominant one. At 5 000 active members ×
  3 visits/month × 12 months = 180 000 rows/year. JSON-encoded at ~250 B
  per row this is ~45 MB/year. Plan to migrate `networkVisits` to its own
  Supabase table once the JSON document exceeds ~50 MB (Postgres TOAST
  threshold is well above, but practical update latency degrades).
- **Hot path** — promo-code redemption must be O(1). Build a `Map<code, row>`
  in the redemption handler — do not `.find` per attempt.
- **Counters** — `discountedMembersCount` and `networkPassesUsedThisMonth`
  are denormalised so listing pages don't have to re-aggregate.
- **Write contention** — `db.update()` serialises through `writeQueue`,
  which already protects against last-writer-wins corruption.

---

## 5. Security Notes

- `PartnerPromoCodeRecord.code` should be **stored as a hash** in the API
  layer (e.g. HMAC-SHA256 with `AUTH_SECRET`) — the type stores `string`
  to leave the encoding choice to the issuing route. Plaintext is shown
  to the admin **once**, at generation time, then never persisted in
  plaintext anywhere.
- Plaintext codes appear in `UserPartnerAffiliationRecord.promoCodeUsed`
  intentionally — this is a redemption audit trail and the code is
  one-time anyway. If this is a concern, change the field to `codeHash`
  with no further model changes required.
- The model does **not** store subscription amounts — those remain with
  the payment provider, matching the existing `TopUpIntentRecord` pattern.

---

## 6. Validation Rules (enforced in API layer)

The store is intentionally permissive — Zod validation lives in the API
routes. The rules from the spec that route code must enforce:

1. `PartnerPromoCode.validUntil >= validFrom`
2. `PartnerPromoCodeBatch.count` ∈ [1, 10 000]
3. `PartnerMembership.discountPercentage` ∈ [1, 99]
4. At most ONE `PartnerMembershipRecord` per `spaceId` (search before insert).
5. At most ONE `UserPartnerAffiliationRecord` per `(userId, partnerId)`.
6. Network credits reset on the 1st of each month UTC — drive from a daily
   cron, not from DB triggers.
7. Promo codes auto-expire after `validUntil` — readers must check; no
   sweeper required (records stay for audit).

---

## 7. Backward Compatibility Checklist

- [x] No existing field removed.
- [x] No existing field type narrowed (only widened).
- [x] No existing index changed (there are no indexes — it's a document).
- [x] Existing bookings keep `paymentMethod: 'wallet' | 'manual'` —
      narrowed comparisons in 6 call sites still pass type-check.
- [x] Existing `UserRecord` reads work without modification; new fields are
      `undefined` and code uses `?? defaults` where it consumes them.
- [x] `cache = { ...empty, ...parsed }` populates new arrays as `[]`.
- [x] `npx tsc --noEmit` — 0 errors after change.

---

## 8. What's NOT in This Change

This PR only ships the **data model**. The following are out of scope:

- API routes (`/api/network/visits`, `/api/partner/codes/generate`, etc.).
- Cron job for monthly credit reset.
- Admin UI for partner enrolment.
- Member UI for code redemption / pass display.
- Payout batch run logic.

These will be built on top of the types defined here.
