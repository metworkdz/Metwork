# Promo codes — incubator-owned codes + admin delete/edit

Status: **PLAN — awaiting approval. No code written.**
Mockup: `PROMO_CODES_MOCKUP.html`

---

## 1. What exists today (verified in code)

- One `PromoCodeRecord` list in the JSONB store (`src/server/db/store.ts:1046`). Admin-only CRUD at
  `/api/admin/promo-codes` — **PATCH only; the `[id]` route's header says DELETE is "intentionally omitted"**.
- Code uniqueness is checked against **every** record, including deactivated ones
  (`createPromoCode`, `service.ts:214`). That is exactly why a deactivated code can never be re-created.
- Codes carry only `appliesTo: ALL | MEMBERSHIP | SPACE | CONSULTATION`. **There is no notion of owner or of a specific
  program/space** — a code is platform-wide.
- Redemption goes through ONE sync validator, `validatePromoCodeSync`, called from 5 places
  (`bookings/service.ts` ×3 for SPACE/PROGRAM/EVENT, `bookings/card-payment.ts` ×1 generic, plus the early check in
  `api/bookings/route.ts`). Consultations and memberships use a different path (`lookupAnyPromoCode` + `promoAppliesTo`).
- `POST /api/promo-codes/validate` receives **only `{code, originalAmount}`** — it has no idea which program/space the
  customer is looking at.
- Nothing ever reads a promo record by id for display (bookings keep `promoCodeId`, and the only consumer is
  `consumePromoCodeSync`, which is a no-op for a missing id). **Hard delete is therefore safe.**

## 2. Where should the incubator's promo-code button live?

**Recommendation: both, but one source of truth.**

| Option | Verdict |
|---|---|
| Only in the main sidebar | Great overview, but far from the program you are working on. |
| Only inside each program | Natural for one program, but a code often covers *several* programs (a cohort, a campaign), **spaces have no per-space page at all**, and you'd have no place to see "all my codes" or spot duplicates. |
| **Sidebar page = home + a "Promo codes" tab in each program (next to Certificates / Finances)** | ✅ The tab is the same component, filtered to that program, with "New code for this program" pre-selected. Costs almost nothing extra and gives context where you need it. |

So:
- **`/dashboard/incubator/promo-codes`** (new sidebar item, between *Programs* and *Feedback*, or after *Revenue*): create, edit,
  delete, see usage, and pick **which programs and/or spaces** each code applies to.
- **Program detail → "Promo codes" tab** (after *Finances*): codes attached to this program, "+ New code for this program",
  and "Attach an existing code".
- Scope is **explicit ids**, never "all". A program created next month is not silently included.

## 3. Admin: delete + edit (Phase 0 — small, independent, ship first)

1. `DELETE /api/admin/promo-codes/[id]` — **hard delete**. The code string is freed immediately, so it can be created again.
   Safe because no reader depends on the record (see §1). Recorded with `appendAuditLog`.
2. `PATCH` extended to accept `code` (rename) and `appliesTo`, in addition to what it takes now. Rename re-runs the uniqueness check.
3. Better 409: when the colliding code is deactivated, say so ("exists but is deactivated — reactivate, edit or delete it") instead of a bare "already exists".
4. UI: **Edit** (reuses the create form in a dialog) and **Delete** (confirm dialog that shows the redemption count) next to Deactivate.

**In-flight safety:** card checkouts freeze the discounted total at intent creation and consume the code only at
settlement. Deleting the code mid-checkout does not change what that customer pays; the consume step finds nothing and
skips. Editing a discount % never touches already-frozen totals.

## 4. Incubator-owned codes (Phases 1–2)

### Data (additive, no migration — per the store's rules)
```ts
PromoCodeRecord {
  …existing…
  ownerIncubatorId?: string | null;                       // absent = platform/admin code (all legacy rows)
  scope?: { programIds: string[]; spaceIds: string[] } | null; // present on incubator codes
}
```

### Enforcement — the part that touches money, so it fails closed
- `validatePromoCodeSync` gains an `item: { kind, id }` argument. A record that has `scope` is valid **only** when
  `item.id` is in the matching list. No item context → rejected.
- All 5 call sites pass the item (card-payment already has `item.promoKind` / `item.itemId` in hand).
- `lookupAnyPromoCode` / `promoAppliesTo` (consultation quote, membership purchase) reject any scoped code, so an
  incubator code can never discount a membership or a consultation.
- The early check in `api/bookings/route.ts` becomes scope-aware as well.
- **Server-side ownership check on create/update:** every program/space id sent by the client is verified to belong to
  that incubator. Incubator A can never target B's listing, and can never read, edit or delete B's codes (404, not 403).

### Customer side
- `/api/promo-codes/validate` accepts optional `itemKind` + `itemId`; `PromoCodeInput` gets matching props; the **space
  booking form** and **program apply form** pass them. Without this the customer would see a discount in the UI that
  checkout then silently drops (the booking validators ignore a rejected code and charge full price today).
- New message: "This code isn't valid for this program/space" — deliberately generic, no leak of what it *is* valid for.

### Routes
`/api/incubator/promo-codes` (GET, POST) and `/api/incubator/promo-codes/[id]` (PATCH, DELETE), `requireApiRole(['INCUBATOR'])`,
incubator resolved from the session like the other `/api/incubator/*` routes.

### Rules for incubator codes (proposed defaults — see §6)
- At least one program or space must be selected.
- Fields: code, % (1–100), expiry, usage limit, active toggle, targets.
- Discount applies to **online payments** only (same as today for spaces; cash bookings are unchanged).
- Admin sees incubator codes in the admin page (new **Owner** column) and can deactivate/delete them as moderation.

### UI work
- Sidebar item (+ mobile "More" sheet), page, manager component, scope picker, program tab.
- en / fr / ar strings, logical Tailwind properties for RTL, mobile card list instead of table (like `programs-mobile-list`),
  16px input floor.

## 5. Tests
- Scope enforcement for PROGRAM / SPACE / EVENT / MEMBERSHIP / CONSULTATION (scoped code rejected everywhere it shouldn't work).
- Cross-incubator isolation on every route (create with foreign ids, patch, delete).
- Delete → recreate same code works; deactivate → recreate still 409 with the clearer message; rename collision.
- Delete mid-checkout: settlement still completes, consume is a no-op.
- Mutation-check the two money rules (revert → red), as done in earlier work.
- `npm run type-check`, `npm run lint`, full `vitest`.

## 6. Decisions I need from you (defaults in bold)

1. **Uniqueness:** a code string is unique among *live* codes platform-wide (**default**), so two incubators can't both hold
   `RAMADAN20` at the same time — but once one deletes it, anyone can reuse it. Alternative: unique per incubator
   (nicer for incubators, but lookups become item-aware everywhere — bigger change). I recommend the default for v1.
2. **Discount cap for incubators:** **same 1–100 % as admin** (it's their own revenue). Alternative: cap at e.g. 50 %.
3. **Usage limit:** **optional** (as admin). Alternative: required, to avoid forgotten unlimited codes.
4. **Events:** you said programs and spaces, so **events are out** for now; adding them is one more checklist.
5. **Consultant-owned programs:** **out of scope** (consultants have no incubator dashboard).
6. **Phasing:** **Phase 0 (admin delete/edit) first as its own commit**, then incubator backend + enforcement, then UI.

## 7. Known limitation worth knowing
We only store `usedCount`, not "DZD discounted". The incubator page will show uses and limit, not money given away. Tracking
the discounted amount would need a field on the booking — not in this scope unless you want it.
