/**
 * METWORK OS CRM — critical-path e2e (Prompt 8).
 *
 * Covers the five flows the hardening brief names:
 *   1. login + forced password change      (UI — the one flow whose value IS the screen)
 *   2. Organization / Contact CRUD + linking
 *   3. Task lifecycle
 *   4. one full Opportunity pipeline run
 *   5. Startup ↔ platform-listing linking   (the Prompt 3 identity model)
 * plus the role gate, which is the security claim most worth proving against a
 * real running server rather than statically.
 *
 * DESIGN
 *  • SERIAL, one worker — the suite shares a single SQLite file (enforced in
 *    playwright.metworkcrm.config.ts, not left to the caller).
 *  • Owns its accounts and its data; every row is tagged `e2e-crm` and removed
 *    in `afterAll`, which then ASSERTS the count is zero rather than hoping.
 *  • Never touches the seeded admin, so `must_change_password` is never flipped
 *    and the suite is re-runnable (verified by running it twice).
 *  • Mostly API-level: the CRM's own service tests already cover business rules,
 *    so what e2e adds is proof that auth, guards and routing work end-to-end
 *    against a real server — not a slower re-test of the same logic.
 *
 * Run:
 *   USE_LOCAL_DB=true npx next dev -p 3999
 *   npx playwright test -c playwright.metworkcrm.config.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import {
  E2E_TAG,
  cleanupCrmFixtures,
  countCrmFixtures,
  createCrmUser,
  readUserFlag,
  type CrmTestUser,
} from './_crm-fixtures';

test.describe.configure({ mode: 'serial' });

const BASE = process.env.CRM_E2E_BASE_URL ?? 'http://localhost:3999';
const ADMIN_PASSWORD = 'E2eAdminPass!2026';
const MEMBER_PASSWORD = 'E2eMemberPass!2026';

let admin: CrmTestUser;
let member: CrmTestUser;
/** Authenticated API contexts — the CRM cookie lives in the context's jar. */
let adminApi: APIRequestContext;
let memberApi: APIRequestContext;

/** Sign in and return a context carrying that user's `metwork_crm` cookie. */
async function signIn(email: string, password: string): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const res = await ctx.post('/api/metworkcrm/auth/login', { data: { email, password } });
  expect(res.status(), `login failed for ${email}`).toBe(200);
  return ctx;
}

/**
 * Force Next to compile the routes the UI specs drive, before any assertion
 * depends on them.
 *
 * Not a workaround for flakiness — a `next dev` server compiles each route on
 * first request, and on a loaded machine `/api/metworkcrm/auth/change-password`
 * has been measured at ~33s and the `/metworkcrm` dashboard at ~170s. A UI test
 * that clicks submit and waits for a redirect would be timing that compile, not
 * the application. These requests are all unauthenticated (401/redirect is the
 * expected and ignored result); only the compile side effect matters.
 */
async function warmRoutes(): Promise<void> {
  const ctx = await pwRequest.newContext({ baseURL: BASE, timeout: 180_000 });
  // Discovered from the filesystem rather than hard-coded: a hand-written list
  // silently rots as routes are added, and the failure mode is a confusing
  // timeout in an unrelated assertion rather than an obviously stale list.
  const apiDir = path.join(process.cwd(), 'src/app/api/metworkcrm');
  const collections: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Dynamic segments need a real id to resolve; the collection route
        // above them compiles the shared module graph anyway.
        if (!entry.name.startsWith('[')) walk(full);
      } else if (entry.name === 'route.ts' && !full.includes('[')) {
        collections.push(
          '/api/metworkcrm/' + path.relative(apiDir, path.dirname(full)).split(path.sep).join('/'),
        );
      }
    }
  };
  walk(apiDir);

  try {
    // Unauthenticated: 401/422 is the expected, ignored result — only the
    // compile side effect matters.
    await Promise.all([
      ...collections.map((p) => ctx.get(p).catch(() => undefined)),
      ctx
        .post('/api/metworkcrm/auth/change-password', {
          data: { currentPassword: 'x', newPassword: 'y', confirmPassword: 'y' },
        })
        .catch(() => undefined),
      ...['/metworkcrm/login', '/metworkcrm', '/metworkcrm/change-password', '/metworkcrm/organizations', '/metworkcrm/payments'].map(
        (p) => ctx.get(p).catch(() => undefined),
      ),
    ]);
  } finally {
    await ctx.dispose();
  }
}

test.beforeAll(async () => {
  cleanupCrmFixtures(); // in case a previous run died mid-flight
  await warmRoutes();
  admin = await createCrmUser({ slug: 'admin', role: 'ADMIN', password: ADMIN_PASSWORD });
  member = await createCrmUser({ slug: 'member', role: 'TEAM_MEMBER', password: MEMBER_PASSWORD });
  adminApi = await signIn(admin.email, ADMIN_PASSWORD);
  memberApi = await signIn(member.email, MEMBER_PASSWORD);
});

test.afterAll(async () => {
  await adminApi?.dispose();
  await memberApi?.dispose();
  cleanupCrmFixtures();
  // Cleanup that isn't verified is just an intention.
  expect(countCrmFixtures(), 'suite left rows behind').toBe(0);
});

/* ═══════════════ 1. Login + forced password change (UI) ═══════════════ */

test.describe('login and forced password change', () => {
  test('rejects a bad password with a generic message and no session', async ({ page }) => {
    await page.goto('/metworkcrm/login');
    await page.getByLabel(/Adresse e-mail/i).fill(admin.email);
    await page.getByLabel(/Mot de passe/i).fill('definitely-not-the-password');
    await page.getByRole('button', { name: /Se connecter/i }).click();

    await expect(page.getByText(/E-mail ou mot de passe incorrect/i)).toBeVisible();
    // Still on login — no session was issued.
    await expect(page).toHaveURL(/\/metworkcrm\/login/);
  });

  test('forces a password change on first login, then lands on the dashboard', async ({ page }) => {
    // A dedicated account so this flow never mutates the shared fixtures.
    const fresh = await createCrmUser({
      slug: 'firstlogin',
      role: 'TEAM_MEMBER',
      password: 'InitialPass!2026',
      mustChangePassword: true,
    });
    expect(readUserFlag(fresh.email, 'must_change_password')).toBe(1);

    await page.goto('/metworkcrm/login');
    await page.getByLabel(/Adresse e-mail/i).fill(fresh.email);
    await page.getByLabel(/Mot de passe/i).fill('InitialPass!2026');
    await page.getByRole('button', { name: /Se connecter/i }).click();

    // Gate: every other page redirects here until the flag clears.
    await expect(page).toHaveURL(/\/metworkcrm\/change-password/);
    await page.goto('/metworkcrm/organizations');
    await expect(page, 'the gate must hold for other pages too').toHaveURL(
      /\/metworkcrm\/change-password/,
    );

    await page.getByLabel(/Mot de passe actuel/i).fill('InitialPass!2026');
    await page.getByLabel(/^Nouveau mot de passe/i).fill('ChangedPass!2026');
    await page.getByLabel(/Confirmer/i).fill('ChangedPass!2026');
    await page.getByRole('button', { name: /Mettre à jour/i }).click();

    // Generous: this submit re-hashes with scrypt (deliberately slow) and then
    // navigates to the dashboard, which the dev server may still be compiling.
    await expect(page).toHaveURL(/\/metworkcrm(\?|$)/, { timeout: 90_000 });
    await expect(page.getByRole('heading', { name: /Bonjour/i })).toBeVisible({ timeout: 30_000 });
    // Server-side truth, not just the redirect.
    expect(readUserFlag(fresh.email, 'must_change_password')).toBe(0);
  });

  test('an unauthenticated visitor is redirected to login', async ({ page }) => {
    await page.goto('/metworkcrm/organizations');
    await expect(page).toHaveURL(/\/metworkcrm\/login/);
  });
});

/* ═══════════════ Role gate (the security claim, proven live) ═══════════════ */

test.describe('role gate', () => {
  test('TEAM_MEMBER is refused the Payments API and page; ADMIN is not', async ({ browser }) => {
    expect((await memberApi.get('/api/metworkcrm/payments')).status()).toBe(403);
    expect((await memberApi.post('/api/metworkcrm/payments', { data: {} })).status()).toBe(403);
    expect((await adminApi.get('/api/metworkcrm/payments')).status()).toBe(200);

    // And the page itself redirects server-side rather than rendering.
    const ctx = await browser.newContext({ baseURL: BASE });
    const page = await ctx.newPage();
    await page.goto('/metworkcrm/login');
    await page.getByLabel(/Adresse e-mail/i).fill(member.email);
    await page.getByLabel(/Mot de passe/i).fill(MEMBER_PASSWORD);
    await page.getByRole('button', { name: /Se connecter/i }).click();
    await expect(page).toHaveURL(/\/metworkcrm(\?|$)/);

    await page.goto('/metworkcrm/payments');
    await expect(page, 'TEAM_MEMBER must be bounced off /payments').toHaveURL(/\/metworkcrm(\?|$)/);
    // The nav must not advertise what the role cannot open.
    await expect(page.getByRole('link', { name: 'Paiements' })).toHaveCount(0);
    await ctx.close();
  });

  test('the CRM cookie grants zero access to the customer platform', async () => {
    // The isolation claim: a valid CRM session must not authenticate /auth/me.
    const res = await adminApi.get('/api/auth/me');
    expect(res.status()).toBe(401);
  });
});

/* ═══════════════ 2. Organization / Contact CRUD + linking ═══════════════ */

test.describe('organizations and contacts', () => {
  let orgId = '';
  let contactId = '';

  test('creates an organization, a contact, and links them both ways', async () => {
    const orgRes = await adminApi.post('/api/metworkcrm/organizations', {
      data: { name: `${E2E_TAG} Acme SARL`, type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' },
    });
    expect(orgRes.status()).toBe(201);
    orgId = (await orgRes.json()).id;

    // Org membership is modelled as a junction (`organizations[]`), not a bare
    // column — a contact can belong to several organizations with one marked
    // primary.
    const contactRes = await adminApi.post('/api/metworkcrm/contacts', {
      data: {
        firstName: `${E2E_TAG}-Amina`,
        lastName: `${E2E_TAG}-Belkacem`,
        status: 'ACTIF',
        organizations: [{ organizationId: orgId, role: 'Directrice', isPrimary: true }],
      },
    });
    expect(contactRes.status()).toBe(201);
    const created = await contactRes.json();
    contactId = created.contact.id;

    // Linked from the contact's side…
    const detail = await (await adminApi.get(`/api/metworkcrm/contacts/${contactId}`)).json();
    const link = detail.organizations.find((o: { id: string }) => o.id === orgId);
    expect(link, 'the organization should appear on the contact').toBeTruthy();
    expect(link.isPrimary).toBe(true);
    expect(link.role).toBe('Directrice');

    // …and the denormalised mirror must agree with the junction. These are two
    // representations of one fact; if they drift, the contact list (which
    // filters on the column) disagrees with the detail page (which reads the
    // junction).
    expect(detail.contact.primaryOrganizationId).toBe(orgId);

    // …and visible from the organization's side.
    const orgDetail = await (await adminApi.get(`/api/metworkcrm/organizations/${orgId}`)).json();
    expect(orgDetail.contacts.map((c: { id: string }) => c.id)).toContain(contactId);
  });

  test('updates an organization and finds it via global search', async () => {
    const patch = await adminApi.patch(`/api/metworkcrm/organizations/${orgId}`, {
      data: { status: 'ACTIF', city: 'Alger' },
    });
    expect(patch.status()).toBe(200);
    expect((await patch.json()).status).toBe('ACTIF');

    const search = await (
      await adminApi.get(`/api/metworkcrm/search?q=${encodeURIComponent('Acme SARL')}`)
    ).json();
    const orgGroup = search.groups.find((g: { kind: string }) => g.kind === 'ORGANIZATION');
    expect(orgGroup?.items.some((i: { id: string }) => i.id === orgId)).toBe(true);
  });

  test('the delete guard blocks removing an organization that still has dependents', async () => {
    const task = await adminApi.post('/api/metworkcrm/tasks', {
      data: {
        title: `${E2E_TAG} sole-link task`,
        priority: 'MOYENNE',
        status: 'A_FAIRE',
        organizationId: orgId,
      },
    });
    expect(task.status()).toBe(201);
    const taskId = (await task.json()).id;

    const blocked = await adminApi.delete(`/api/metworkcrm/organizations/${orgId}`);
    expect(blocked.status(), 'a sole-link dependent must block the delete').toBe(409);
    const body = await blocked.json();
    expect(body.error.message).toMatch(/tâches sans autre lien/i);

    // The organization survived — a blocked delete must not partially apply.
    expect((await adminApi.get(`/api/metworkcrm/organizations/${orgId}`)).status()).toBe(200);
    await adminApi.delete(`/api/metworkcrm/tasks/${taskId}`);
  });
});

/* ═══════════════ 3. Task lifecycle ═══════════════ */

test('task lifecycle: create → in progress → done, with completedAt stamped', async () => {
  const org = await (
    await adminApi.post('/api/metworkcrm/organizations', {
      data: { name: `${E2E_TAG} Task Co`, type: 'ENTREPRISE', status: 'ACTIF', country: 'DZ' },
    })
  ).json();

  const created = await adminApi.post('/api/metworkcrm/tasks', {
    data: {
      title: `${E2E_TAG} call the client`,
      priority: 'HAUTE',
      status: 'A_FAIRE',
      organizationId: org.id,
      assigneeId: admin.id,
    },
  });
  expect(created.status()).toBe(201);
  const task = await created.json();
  expect(task.completedAt).toBeNull();

  const inProgress = await adminApi.patch(`/api/metworkcrm/tasks/${task.id}`, {
    data: { status: 'EN_COURS' },
  });
  expect((await inProgress.json()).completedAt, 'not complete yet').toBeNull();

  const done = await (
    await adminApi.patch(`/api/metworkcrm/tasks/${task.id}`, { data: { status: 'TERMINEE' } })
  ).json();
  expect(done.status).toBe('TERMINEE');
  expect(done.completedAt, 'completing a task must stamp completedAt').toBeTruthy();

  // Reopening clears the stamp — otherwise "done at" would lie.
  const reopened = await (
    await adminApi.patch(`/api/metworkcrm/tasks/${task.id}`, { data: { status: 'A_FAIRE' } })
  ).json();
  expect(reopened.completedAt).toBeNull();

  // A task must always hang off something (anti-orphan rule).
  const orphan = await adminApi.post('/api/metworkcrm/tasks', {
    data: { title: `${E2E_TAG} orphan`, priority: 'BASSE', status: 'INBOX' },
  });
  expect(orphan.status()).toBe(422);
});

/* ═══════════════ 4. Full Opportunity pipeline run ═══════════════ */

test('opportunity pipeline: NOUVEAU_LEAD → GAGNE, with history, closedAt and the follow-up automation', async () => {
  const org = await (
    await adminApi.post('/api/metworkcrm/organizations', {
      data: { name: `${E2E_TAG} Pipeline Co`, type: 'ENTREPRISE', status: 'PROSPECT', country: 'DZ' },
    })
  ).json();

  const opp = await (
    await adminApi.post('/api/metworkcrm/opportunities', {
      data: {
        title: `${E2E_TAG} Pack Incubation`,
        organizationId: org.id,
        type: 'INCUBATION',
        stage: 'NOUVEAU_LEAD',
        amount: 250000,
        probability: 20,
        ownerId: admin.id,
      },
    })
  ).json();

  const STAGES = ['CONTACTE', 'BESOIN_IDENTIFIE', 'PROPOSITION_ENVOYEE', 'NEGOCIATION', 'GAGNE'];
  for (const stage of STAGES) {
    const res = await adminApi.patch(`/api/metworkcrm/opportunities/${opp.id}`, { data: { stage } });
    expect(res.status(), `advancing to ${stage}`).toBe(200);
    expect((await res.json()).stage).toBe(stage);
  }

  const detail = await (await adminApi.get(`/api/metworkcrm/opportunities/${opp.id}`)).json();
  expect(detail.opportunity.stage).toBe('GAGNE');
  expect(detail.opportunity.closedAt, 'a won deal must stamp closedAt').toBeTruthy();
  // Creation + 5 transitions, in order.
  expect(detail.stageHistory.length).toBe(6);
  const toStages = detail.stageHistory.map((h: { toStage: string }) => h.toStage).reverse();
  expect(toStages).toEqual(['NOUVEAU_LEAD', ...STAGES]);

  // Passing through PROPOSITION_ENVOYEE must have created the follow-up task
  // (Prompt 7 automation) — and it must not have blocked the stage change.
  const tasks = await (
    await adminApi.get(`/api/metworkcrm/tasks?opportunityId=${opp.id}&limit=50`)
  ).json();
  const followUp = tasks.rows.find((t: { title: string }) => /Relance dans 3 jours/i.test(t.title));
  expect(followUp, 'proposal-sent automation should have created a follow-up task').toBeTruthy();
  expect(followUp.source).toBe('AUTOMATION');

  // TEAM_MEMBER may see the pipeline but never the money (R-19).
  const asMember = await (await memberApi.get(`/api/metworkcrm/opportunities/${opp.id}`)).json();
  expect(asMember.opportunity.stage).toBe('GAGNE');
  expect(asMember.opportunity.amount, 'amounts must be hidden from TEAM_MEMBER').toBeNull();
});

/* ═══════════════ 5. Startup ↔ platform-listing linking ═══════════════ */

test('startup linking: CRM_ONLY without a platform listing, LINKED with one', async () => {
  const crmOnly = await (
    await adminApi.post('/api/metworkcrm/startups', {
      data: { name: `${E2E_TAG} Solo Startup`, pipelineStage: 'LEAD', sector: 'Fintech' },
    })
  ).json();
  expect(crmOnly.linkStatus, 'no platform listing ⇒ CRM_ONLY').toBe('CRM_ONLY');
  expect(crmOnly.platformListingId).toBeNull();

  const listingId = `${E2E_TAG}-listing-${Date.now()}`;
  const linked = await (
    await adminApi.post('/api/metworkcrm/startups', {
      data: {
        name: `${E2E_TAG} Linked Startup`,
        pipelineStage: 'LEAD',
        platformListingId: listingId,
      },
    })
  ).json();
  // `link_status` is a STORED generated column — proving it here proves the
  // schema derives identity, not the application.
  expect(linked.linkStatus, 'a platform listing ⇒ LINKED').toBe('LINKED');
  expect(linked.platformListingId).toBe(listingId);

  // The link is unique: the same listing cannot back two CRM records.
  const duplicate = await adminApi.post('/api/metworkcrm/startups', {
    data: { name: `${E2E_TAG} Duplicate`, pipelineStage: 'LEAD', platformListingId: listingId },
  });
  expect(duplicate.status(), 'duplicate platform link must be rejected').toBeGreaterThanOrEqual(400);

  // Stage advance still works on a linked record.
  const advanced = await adminApi.patch(`/api/metworkcrm/startups/${linked.id}`, {
    data: { pipelineStage: 'ONBOARDING' },
  });
  expect(advanced.status()).toBe(200);
  expect((await advanced.json()).pipelineStage).toBe('ONBOARDING');
});
