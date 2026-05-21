# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Metwork is Algeria's startup ecosystem platform — a **Next.js 14 frontend** (App Router, React 18, TypeScript strict) that connects entrepreneurs, investors, incubators, and coworking spaces. The NestJS backend lives in a separate repo and exposes a typed REST API; this repo is frontend-only.

## Commands

```bash
npm run dev            # Start dev server on :3000
npm run build          # Production build
npm run lint           # ESLint (flat config)
npm run type-check     # tsc --noEmit (use this — build ignores TS errors)
npm run test           # Vitest single pass
npm run test:watch     # Vitest watch (TDD)
npm run test:coverage  # Coverage report
```

**Run a single test file:**
```bash
npx vitest run src/__tests__/consultation-booking.test.ts
```

> The build has `typescript: { ignoreBuildErrors: true }` in `next.config.mjs` so Vercel deploys don't break. Always run `npm run type-check` locally to catch type errors.

## Architecture

### Routing

All pages live under `src/app/[locale]/` — the `[locale]` segment handles EN/FR/AR i18n via next-intl. Groups:
- `(public)/` — marketing pages (landing, programs, events, mentors)
- `(auth)/` — login, signup, OTP, password reset
- `dashboard/{entrepreneur,investor,incubator,admin}/` — role-specific authenticated pages

`src/middleware.ts` enforces locale prefixes, protects `/dashboard/*` (no session → redirect to `/login?next=...`), and bounces authenticated users away from auth pages.

### Auth

Auth is stateless on the frontend. The backend sets a `metwork_session` HttpOnly cookie; the frontend never reads or decodes it. `getServerSession()` in `src/lib/session.ts` forwards the cookie to `/auth/me` on the backend. The Edge middleware checks cookie *presence* only (no crypto on Edge).

For role-restricted server components:
```tsx
import { requireRole } from '@/lib/auth-guards';
const user = await requireRole(['ENTREPRENEUR']); // redirects if wrong role
```

### API Client

All API calls go through `src/lib/api-client.ts` — a typed fetch wrapper. Components never call `fetch` directly; they use services in `src/services/`.

- In the browser: base URL is always `/api` (relative, avoids CORS)
- On the server: uses `API_INTERNAL_URL` env var if set, falls back to `NEXT_PUBLIC_APP_URL/api`

Errors throw `ApiClientError` with `.status` and `.code` properties.

### Database

`src/server/db/store.ts` — a **single JSONB document** stored in Supabase. All app state is one blob (`id=1`). Mutations are atomic at the document level. No migrations — just add optional fields.

```ts
const data = await db.read();
await db.update(d => { d.users.push(newUser); });
```

### i18n

All strings are in `src/i18n/messages/{en,fr,ar}.json`. Use `useTranslations('namespace')` in client components and `getTranslations()` in RSCs. Arabic is fully RTL — layout sets `<html dir="rtl">`, and the codebase uses Tailwind logical properties (`ms-*`, `me-*`, `start-*`, `end-*`).

Every page must call `setRequestLocale(locale)` at the top to enable static rendering.

### Testing

Tests use **Vitest** (not Jest) — native ESM, no babel transforms needed. All tests run serially in one fork (`singleFork: true`) because they share in-memory DB state. The setup file at `src/__tests__/setup.ts` mocks the Supabase client before any imports.

Test files: `src/__tests__/**/*.test.ts` or co-located `*.test.ts` (not `*.spec.ts`).

## Key Files

| File | Purpose |
|------|---------|
| `src/middleware.ts` | i18n routing + auth cookie guards |
| `src/lib/api-client.ts` | Typed fetch wrapper, base URL logic |
| `src/lib/auth-guards.ts` | `requireRole()` for RSCs |
| `src/lib/session.ts` | `getServerSession()` — request-cached |
| `src/lib/validators.ts` | Zod schemas for all forms |
| `src/server/db/store.ts` | Single JSONB store (Supabase) |
| `src/lib/env.ts` | Zod-validated env vars — all env access goes here |
| `src/config/navigation.ts` | Type-safe nav config for all roles |
| `src/i18n/routing.ts` | next-intl `Link` / `useRouter` exports |

## Environment Variables

Validated by Zod at startup via `src/lib/env.ts`. See `.env.example`.

Client-exposed (`NEXT_PUBLIC_*`): `APP_URL`, `API_URL`, `SENTRY_DSN`, `POSTHOG_KEY`

Server-only: `AUTH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL` (Upstash, for rate limiting), `RESEND_API_KEY`, `INFOBIP_*`, `PAYMENT_PROVIDER`, `S3_*`

## Payments & Notifications

`src/server/payments/` defines a `PaymentProvider` interface with two implementations: `mock` (default, sync/async via `MOCK_PAYMENT_MODE`) and `slickpay` (Algerian CIB/Edahabia).

OTP delivery via `src/server/notifications/` prefers WhatsApp → SMS → email fallback. Email via Resend, SMS via Infobip.

## Rate Limiting

Distributed via `@upstash/ratelimit` (sliding window). Falls back to in-memory when Redis is unavailable. Fail-open — transient Redis errors don't block users.
