# Metwork

> Algeria's unified startup ecosystem platform — connecting entrepreneurs, investors, incubators, and coworking spaces.

This repository contains the **Next.js frontend** for Metwork. The NestJS backend lives in a separate repository and exposes a typed REST API consumed by this frontend.

---

## Tech stack

- **Framework** — Next.js 14 (App Router) + React 18 + TypeScript (strict)
- **Styling** — Tailwind CSS + shadcn/ui primitives + custom design tokens
- **i18n** — `next-intl` with EN / FR / AR (Arabic includes RTL)
- **Forms** — react-hook-form + zod
- **State** — React context + Zustand for client UI state, server components for data
- **Icons** — lucide-react
- **Auth** — Cookie-based sessions issued by the backend; middleware enforces route guards
- **Theming** — next-themes (light + dark)

---

## Getting started

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- Docker (for local Postgres / Redis / MinIO)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
# generate AUTH_SECRET with: openssl rand -base64 32
```

### 3. Start backing services (optional for UI work)

```bash
docker compose up -d postgres redis minio
```

### 4. Run the dev server

```bash
npm run dev
```

The app is now at `http://localhost:3000`. The default locale `/en` is enforced by middleware; you can also visit `/fr` or `/ar`.

---

## Project structure

```
src/
├── app/                          # Next.js App Router
│   ├── [locale]/                 # AR / FR / EN routing
│   │   ├── (public)/             # Marketing pages: landing, programs, events…
│   │   ├── (auth)/               # login, signup, verify-otp, forgot-password
│   │   ├── dashboard/            # Role-based dashboards
│   │   │   ├── entrepreneur/
│   │   │   ├── investor/
│   │   │   ├── incubator/
│   │   │   └── admin/
│   │   ├── layout.tsx            # Locale layout (sets lang + dir)
│   │   ├── loading.tsx
│   │   └── not-found.tsx
│   ├── api/                      # Route handlers (webhooks, uploads)
│   ├── layout.tsx                # Root layout (minimal)
│   └── global-error.tsx
│
├── components/
│   ├── ui/                       # Primitives (Button, Input, Card, …)
│   ├── layout/                   # Navbar, footer, sidebar, locale switcher
│   ├── features/                 # Feature-bound components (auth/, booking/, …)
│   ├── shared/                   # Generic components (StatCard, EmptyState, …)
│   └── providers/                # Context providers (auth, theme, intl)
│
├── config/                       # Static config (site, navigation, cities, memberships)
├── hooks/                        # Custom hooks
├── i18n/
│   ├── config.ts                 # Locale list + metadata
│   ├── routing.ts                # next-intl Link / useRouter
│   ├── request.ts                # Server-side message loader
│   └── messages/                 # en.json, fr.json, ar.json
├── lib/                          # Utilities (api-client, env, format, validators, …)
├── services/                     # Frontend service layer (auth, booking, wallet, …)
├── server/                       # Server-only helpers (kept for future tRPC)
├── styles/                       # globals.css with Tailwind + design tokens
├── types/                        # Shared types (auth, domain)
└── middleware.ts                 # i18n + auth route guards
```

### Why this structure?

- **`(public)` and `(auth)` route groups** share a parent locale segment but render different layouts. The `(public)` group has the marketing navbar/footer; `(auth)` has a clean centered shell.
- **`features/` vs `shared/`** — features are bound to a domain (auth, booking, wallet); shared are generic (StatCard, EmptyState).
- **`services/`** is the frontend-side abstraction over the API. UI never imports `apiClient` directly — it goes through a service.
- **`config/`** holds static, type-safe configuration. Editing `navigation.ts` instantly updates both desktop and mobile menus.

---

## Available scripts

| Script               | Purpose                          |
| -------------------- | -------------------------------- |
| `npm run dev`        | Start dev server on :3000        |
| `npm run build`      | Production build                 |
| `npm run start`      | Start production server          |
| `npm run lint`       | ESLint                           |
| `npm run type-check` | tsc --noEmit                     |
| `npm run format`     | Prettier write                   |

---

## Internationalization

All user-facing strings live in `src/i18n/messages/{en,fr,ar}.json` and are accessed via:

```tsx
import { useTranslations } from 'next-intl';
const t = useTranslations('namespace');
t('key'); // → translated string
```

To add a locale:

1. Add a code to `src/i18n/config.ts`
2. Create `src/i18n/messages/{code}.json`
3. Add font support in `tailwind.config.ts` if it uses a non-Latin script

### RTL

Arabic is fully RTL. The `<html dir>` attribute is set in `[locale]/layout.tsx`. All custom CSS uses logical properties (`ms-*`, `me-*`, `start-*`, `end-*`) so the same classes work in both directions.

---

## Authentication architecture

Auth is **cookie-based**, issued by the backend at `/auth/login` and `/auth/verify-otp`. The frontend never holds a JWT directly — the cookie is HttpOnly, Secure, and SameSite=Lax.

**Flow:**

1. User submits login/signup → frontend calls `authService.login()`
2. Backend validates → sets `metwork_session` cookie → returns `SessionUser`
3. Frontend stores user in `AuthProvider` context for client components
4. Server components call `getServerSession()` which forwards the cookie to `/auth/me`
5. `middleware.ts` checks the cookie and redirects unauthenticated users away from `/dashboard/*`

**Role guarding:** Use `requireRole()` at the top of any role-restricted server component:

```tsx
import { requireRole } from '@/lib/auth-guards';

export default async function Page() {
  const user = await requireRole(['ENTREPRENEUR']);
  // user is guaranteed to be an entrepreneur
}
```

---

## Adding a new page

1. Create a folder under the appropriate route group:
   - Public: `src/app/[locale]/(public)/my-page/page.tsx`
   - Authed: `src/app/[locale]/dashboard/{role}/my-page/page.tsx`
2. Export a default async function with `setRequestLocale(locale)` at the top
3. Add nav entries in `src/config/navigation.ts`
4. Add translation keys in all three locale files

---

## Deploying to a VPS

```bash
# Build and run with Docker
docker compose up -d --build
```

In production behind Caddy: copy `docker/Caddyfile` to your VPS, point your DNS to the VPS, and Caddy provisions Let's Encrypt certs automatically.

---

## License

Proprietary © Metwork. All rights reserved.
