import { defineConfig, devices } from '@playwright/test';
import { authStatePath } from './tests/e2e/global-setup';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: 1,
  workers: 5,
  reporter: [
    ['html', { outputFolder: 'tests/report', open: 'never' }],
    ['json', { outputFile: 'tests/results.json' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    locale: 'fr-FR',
  },
  projects: [
    {
      name: 'admin',
      testMatch: '**/admin.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('admin'),
      },
    },
    {
      name: 'incubator',
      testMatch: '**/incubator.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('incubator'),
      },
    },
    {
      name: 'entrepreneur-builder',
      testMatch: '**/entrepreneur-builder.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('builder'),
      },
    },
    {
      name: 'entrepreneur-founder',
      testMatch: '**/entrepreneur-founder.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('founder'),
      },
    },
    {
      name: 'entrepreneur-explorer',
      testMatch: '**/entrepreneur-explorer.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('explorer'),
      },
    },
    {
      // Category-specific spaces (COWORKING desks / PRIVATE_OFFICE / DOMICILIATION)
      // + manual-booking desk-blocking + expiry-notifier. SERIAL & state-sharing —
      // run with `--workers=1`. Retries disabled so a flake never re-runs
      // side-effectful fixture creation against the shared doc.
      name: 'spaces-granularity',
      testMatch: '**/spaces-granularity.spec.ts',
      retries: 0,
      // Dev-server on-demand route compiles can stall a first fetch by ~10s;
      // give the serial steps headroom instead of flaking on compile jank.
      timeout: 90_000,
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('incubator'),
      },
    },
    {
      // Test-data cleanup for the spaces-granularity suite. Run explicitly:
      //   npx playwright test tests/cleanup/spaces-granularity.cleanup.ts
      name: 'cleanup',
      testDir: './tests/cleanup',
      testMatch: '**/*.cleanup.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Invoicing suite — legal invoices (engine math, numbering, templates,
      // immutability), invoicing settings, entreprise/personne physique client
      // form, domiciliation price guard. SERIAL & state-sharing (one JSON doc,
      // per-year invoice counters) — run with `--workers=1`. Retries disabled
      // so a flake never double-issues an invoice against the shared doc.
      //   npx playwright test --project=invoices --workers=1
      name: 'invoices',
      testMatch: ['**/invoice-*.spec.ts', '**/domiciliation-price.spec.ts'],
      retries: 0,
      timeout: 90_000,
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('incubator'),
      },
    },
    {
      // Instant-book consultation suite (P1–P7). API-driven specs build their own
      // role contexts via the saved storage states, so this project needs no
      // storageState of its own. The UI i18n smoke runs here too. SERIAL by
      // intent: every spec reconfigures the shared seeded mentor — run with
      // `--workers=1`. Retries disabled so a flake never re-spends the per-mentor
      // PIN rate-limit budget.
      name: 'consultation',
      testMatch: ['**/api/consultation*.spec.ts', '**/consultation-i18n.spec.ts'],
      retries: 0,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      // Space reservation modes (Airbnb-style INSTANT / REQUEST) — API-driven
      // money-movement assertions (debit/credit/idempotency) + pay-link flow
      // via the e2e email sink. SERIAL & state-sharing — run with `--workers=1`.
      // Retries disabled so a flake never re-runs side-effectful wallet moves.
      //   npx playwright test --project=space-reservation-modes --workers=1
      name: 'space-reservation-modes',
      testMatch: '**/api/space-reservation-modes.spec.ts',
      retries: 0,
      timeout: 90_000,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      // Membership repricing — admin-editable plan config, exact purchase
      // amounts, the frozen-snapshot invariant (an admin price change must not
      // reach an active billing period), discount application, pass allowances
      // and promo-vs-membership stacking. SERIAL & state-sharing, and every
      // money test signs up its OWN member so seeded accounts stay clean.
      // Retries disabled so a flake never re-runs a purchase.
      //   npx playwright test --project=membership-pricing --workers=1
      name: 'membership-pricing',
      testMatch: '**/api/membership-pricing.spec.ts',
      retries: 0,
      timeout: 90_000,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      // Admin grant / revoke of a membership + the under-funded-wallet purchase
      // contract. SERIAL & state-sharing (one JSON doc) and every test signs up
      // its own member — run with `--workers=1`. Retries disabled so a flake
      // never re-runs a purchase.
      //   npx playwright test --project=entrepreneur-fixes --workers=1
      name: 'entrepreneur-fixes',
      testMatch: '**/api/membership-grant-topup.spec.ts',
      retries: 0,
      timeout: 90_000,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      // Entrepreneur dashboard at phone width — dialog centring, no horizontal
      // scroll, and the pay-first booking copy. Read-only: it opens a dialog
      // but never submits, so it is safe to run in parallel.
      //   npx playwright test --project=entrepreneur-mobile
      name: 'entrepreneur-mobile',
      testMatch: '**/entrepreneur-mobile.spec.ts',
      // A cold dev server compiles the wallet route on first hit, which can
      // outlast the default 45s before `networkidle` ever settles.
      timeout: 90_000,
      use: {
        // iPhone 13 metrics on Chromium: the repo only provisions the Chromium
        // browser, and the descriptor's default (WebKit) is not installed.
        // Mobile emulation (viewport, DPR, touch, UA) is what these assertions
        // actually depend on.
        ...devices['iPhone 13'],
        browserName: 'chromium',
        storageState: authStatePath('builder'),
      },
    },
    {
      // Startup logo field — founder uploads a logo via the profile form; a
      // second browser context (investor, via authStatePath) verifies it
      // renders as a rounded avatar and that a no-logo listing falls back to
      // initials at the same footprint. Founder is the primary actor.
      //   npx playwright test --project=startup-logo
      name: 'startup-logo',
      testMatch: '**/startup-logo.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('founder'),
      },
    },
    {
      // Manual withdrawal — requester UI (payout-account gate, RIB/RIP form) +
      // a hydration guard on the pages this feature touched. Default session is
      // the entrepreneur `builder` (a clean wallet not used by the api
      // withdrawal spec); the admin-payments hydration case overrides the
      // session per-describe. PRECONDITION: freshly-seeded DB (builder starts
      // with no payout account). Run: `--project=withdrawals-ui`.
      name: 'withdrawals-ui',
      testMatch: '**/withdrawal-ui.spec.ts',
      retries: 0,
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStatePath('builder'),
      },
    },
  ],
});
