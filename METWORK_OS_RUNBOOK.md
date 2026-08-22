# METWORK OS CRM — Runbook

Operational reference for `/metworkcrm`: configuration, backup/restore,
migrations, and the production-readiness checklist.

Companion documents:
`METWORK_OS_PRODUCT_SPEC.md` (what it does) ·
`METWORK_OS_DATABASE_SCHEMA.md` (the 29 tables) ·
`METWORK_OS_DEVELOPMENT_RULES.md` (R-1 → R-30).

---

## 1. Environment variables

The CRM validates its own configuration in `src/server/metworkcrm/env.ts`,
deliberately **separate** from the platform's `src/lib/env.ts`. A CRM
misconfiguration therefore cannot fail platform startup, and vice versa.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `METWORKCRM_DATABASE_URL` | no | `file:.crm-local.db` | `file:…` → better-sqlite3 (dev/test). `libsql://…` or `https://…` → Turso (production). Selects the driver; **no application code branches on it** (schema doc §12). |
| `METWORKCRM_DATABASE_AUTH_TOKEN` | Turso only | — | Ignored by the file driver. Server-only — never `NEXT_PUBLIC_*`. |
| `METWORKCRM_SEED_PASSWORD` | no | `123456` | Read **only** by `scripts/metworkcrm/seed.ts`, never at runtime, which is why it is not in the Zod schema. **Set it before any production deploy.** |

Both runtime variables are server-only. Verified: no `NEXT_PUBLIC` reference
exists anywhere in the CRM tree.

> **Production note.** The seed account (`mohamed@metwork.dz`) ships with
> `must_change_password = 1`, so the default credential cannot survive first
> login. That is a mitigation, not a licence to skip `METWORKCRM_SEED_PASSWORD`.

---

## 2. Backup & restore

### 2.1 Local / file driver — `npm run crm:backup`

```bash
npm run crm:backup                    # → backups/crm-<ISO>.db
npm run crm:backup -- --out /tmp/x.db # explicit path (restore drills)
```

Writes a timestamped snapshot to `backups/` (already git-ignored). The script
is read-only against the live database, re-runnable, and **verifies its own
output** before reporting success — `integrity_check`, a 29/29 table count,
and a source-unchanged assertion. It exits non-zero if any of those fail.

**Why `VACUUM INTO` and not `cp`.** The CRM runs in WAL mode. A committed
transaction can live in the `-wal` sibling until a checkpoint folds it back
into the main file, so copying `.crm-local.db` alone while any connection is
open can silently drop recent writes. This is not theoretical — measured on
this repo:

| Method (taken mid-session, writer connection open) | Probe row present |
|---|---|
| `cp .crm-local.db backup.db` | ❌ **0 — write lost** |
| `VACUUM INTO` (`npm run crm:backup`) | ✅ 1 |

At the time of measurement the live database was 663 KB with a **3.3 MB WAL**
beside it. Never back this database up with `cp`.

**Restore (file driver):**

```bash
# 1. Stop anything holding the database open (dev server, scripts).
# 2. Move the current files aside — never delete until the restore is verified.
mv .crm-local.db     .crm-local.db.pre-restore
mv .crm-local.db-wal .crm-local.db-wal.pre-restore 2>/dev/null || true
mv .crm-local.db-shm .crm-local.db-shm.pre-restore 2>/dev/null || true

# 3. Put the snapshot in place. A VACUUM INTO snapshot is a complete,
#    self-contained database — it has no -wal/-shm siblings by design.
cp backups/crm-<ISO>.db .crm-local.db

# 4. Verify BEFORE trusting it.
npm run crm:verify        # 29/29 tables, FKs enforced, integrity ok
npm run crm:migrate       # must report a no-op (see §3)

# 5. Only once verified, discard the .pre-restore files.
```

### 2.2 Turso / production

`npm run crm:backup` **refuses to run** against a `libsql://` or `https://`
URL and exits non-zero. This is deliberate: `VACUUM INTO` writes to a local
filesystem path, which a database reached over HTTP cannot use, so allowing it
would produce either an error or — far worse — a snapshot of the wrong
database. Use Turso's own tooling:

```bash
turso db shell <database> .dump > backups/crm-prod-<ISO>.sql   # logical backup
turso db create <restore-target> --from-dump backups/crm-prod-<ISO>.sql
```

Turso also keeps point-in-time restore on its managed plans
(`turso db create <new> --from-db <source> --timestamp <ISO>`); prefer that for
incident recovery and treat the `.dump` as the portable, provider-independent
copy. Verify any restored database with `npm run crm:verify` pointed at it
before switching traffic over.

---

## 3. Migrations

```bash
npm run crm:generate   # author a new migration from schema.ts (dev only)
npm run crm:migrate    # apply pending migrations
npm run crm:verify     # assert the result matches the schema doc
npm run crm:setup      # migrate + seed + verify
```

**Re-run safety is structural, not conventional.** Drizzle records every
applied migration in its own `__drizzle_migrations` table, so `crm:migrate` on
an up-to-date database is a no-op. Confirmed by re-running it against a
restored snapshot.

`runCrmMigrations()` is invoked **only** from these CLI scripts and from test
setup — never at request time. A migration racing across serverless instances
is a corruption scenario (R-21). Do not call it from a route handler.

---

## 4. Production readiness checklist

- [ ] `METWORKCRM_DATABASE_URL` points at the production Turso database.
- [ ] `METWORKCRM_DATABASE_AUTH_TOKEN` set (server-only env, not in the client bundle).
- [ ] `METWORKCRM_SEED_PASSWORD` set to a real secret **before** the first `crm:seed`.
- [ ] `npm run crm:migrate` run once against production, then `crm:verify` → 29/29.
- [ ] First login completes the forced password change; confirm `must_change_password = 0` afterwards.
- [ ] A backup taken and **restored into a scratch database** at least once — an untested backup is a hope, not a backup.
- [ ] `npm run type-check`, `npm run lint`, `npx vitest run` all green.
- [ ] Playwright `metworkcrm` project green (see §6).

---

## 5. Security posture (audited, Prompt 8)

| Control | Implementation |
|---|---|
| Session isolation | Own cookie `metwork_crm`, `HttpOnly` + `SameSite=Strict`; only the **SHA-256** of the session id is persisted. No read of the platform's `metwork_session` anywhere. |
| Password storage | scrypt via `@/server/auth/password` (R-16) — per-password salt, `timingSafeEqual`, format `scrypt$<salt>$<hash>`. Plaintext is never stored and never logged. |
| Login hardening | Two independent rate-limit budgets — **10 / 15 min per email**, **30 / 15 min per IP**; one generic failure message for both "no such account" and "wrong password"; constant-work verify against a dummy hash so response time cannot confirm an email exists; inactive accounts rejected. |
| Route authorization | All 46 `/api/metworkcrm/**` handlers guarded except `auth/login` and `auth/logout` (necessarily public). 28 of 29 pages guarded; `login` is the exception. `payments`, `settings`, `users` are ADMIN-only at both the page and API layer. |
| Regression protection | `route-guards.test.ts` asserts guard coverage **per exported HTTP method**, so adding an unguarded `DELETE` to an existing file fails the suite. The public allowlist is asserted exact in both directions. |
| Monetary visibility | `TEAM_MEMBER` sees no amount anywhere — enforced in the service layer via `redactMoney`, not per-route (R-19 extended). |
| Runtime pinning | Every CRM handler declares `runtime = 'nodejs'`; SQLite drivers cannot run on Edge. |

**Known and accepted:** `checkRateLimitDistributed` is **fail-open** across the
whole platform — a Redis outage degrades to in-memory limiting rather than
locking users out. Inherited deliberately; recorded here rather than silently
changed for the CRM alone.

---

## 6. End-to-end tests

```bash
# Terminal 1 — dev server against the local CRM database
USE_LOCAL_DB=true npx next dev -p 3999

# Terminal 2
npx playwright test --project=metworkcrm --workers=1
```

`--workers=1` is required: the suite shares one SQLite file. The suite creates
and tears down **its own** `internal_users` fixture rather than consuming the
seeded admin account, so it is safely re-runnable and never leaves the seed
account's `must_change_password` flag flipped.

---

## 7. What changed in the platform outside `/metworkcrm`

**Nothing, beyond six pre-approved files touched once in Prompt 1.**

Audited by enumerating every commit reachable from `main` that touches a CRM
path — exactly six exist (`af37979`, `54180a0`, `38d9c52`, `35d188e`,
`3ad74dd`, `c31819f`), confirming the review below is complete rather than a
sample. **Five of the six touched nothing outside `/metworkcrm` at all.**

| File | Change | Blast radius |
|---|---|---|
| `src/middleware.ts` | +12 lines: `if (pathname === '/metworkcrm' \|\| pathname.startsWith('/metworkcrm/')) return NextResponse.next();` | None — the condition *is* the change (R-4). |
| `next.config.mjs` | `serverComponentsExternalPackages: ['pdfkit']` → `['pdfkit', 'better-sqlite3']` | One array element (R-30/C-3). |
| `package.json` | +3 deps, +2 dev deps, +6 `crm:*` scripts | Additive; no existing dep or script modified. |
| `package-lock.json` | lockfile for the above | Additive. |
| `.env.example` | +1 commented CRM block (3 keys) | Additive. |
| `.gitignore` | +`.crm-local.db{,-wal,-shm}`, +Playwright output dirs (Prompt 8) | Additive. |

**Prompt 8 added no seventh file.** The plan had allowed for one — a
`metworkcrm` project inside `playwright.config.ts` — but that config declares a
`globalSetup` which signs in as six *customer* roles against the platform dev
server, and `globalSetup` cannot be scoped to a single project. Adding the CRM
there would have made the CRM suite unrunnable without platform fixtures it has
nothing to do with. It ships as its own `playwright.metworkcrm.config.ts`
instead — a **new root file, not a modification of a platform one** — so
`playwright.config.ts` is byte-for-byte untouched and the modified-platform-file
count stays at six.

New root-level files added by the CRM (none of them platform code):
`playwright.metworkcrm.config.ts`, `drizzle.config.ts`, `METWORK_OS_*.md`.

Two invariants verified by content, not by trust:

- **R-1 — the CRM never writes platform state.** Zero occurrences of
  `@/server/db/store`, `DbShape`, or the JSONB `db.update(d => …)` mutator
  anywhere in the CRM tree. (A naive `db.update(` grep returns hits — all are
  drizzle calls against `crm_*` tables through `getCrmDb()`, a different `db`.)
- **Import surface.** The CRM imports 13 platform modules, all pure or
  read-only: `@/server/http/json`, seven `@/components/ui/*` primitives,
  `@/lib/utils`, `@/server/auth/password` (R-16), `@/lib/rate-limit`,
  `@/lib/cloudinary` (R-26). None writes to the platform store.

No platform route, page, component, translation, cron, or `DbShape` key was
added, removed or modified by any prompt.
