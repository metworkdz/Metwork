/**
 * Admin startups page — UI + API e2e.
 *
 * 1. Admin sees every listing including DRAFT (not just ACTIVE).
 * 2. A non-admin (entrepreneur) hitting GET /api/admin/startups gets 403.
 * 3. Delete requires confirmation (Cancel keeps the row; Confirm removes it),
 *    and the deleted startup disappears from the public/investor marketplace.
 * 4. Decision D2: an investor's bookmark (savedStartups) on the deleted
 *    listing is cascade-deleted, while their contact request
 *    (investorContacts) is preserved as a historical record — neither leaves
 *    the app in a crashing state.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { roleContext, readLocalDb } from './api/_helpers';

function uniq(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

test.describe('Admin startups management', () => {
  let founderCtx: APIRequestContext;
  let investorCtx: APIRequestContext;
  let draftName: string;
  let activeName: string;
  let activeId: string;

  test.beforeAll(async () => {
    founderCtx = await roleContext('founder');
    investorCtx = await roleContext('investor');

    const suffix = uniq();
    draftName = `QA Admin Draft ${suffix}`;
    activeName = `QA Admin Active ${suffix}`;

    const draftRes = await founderCtx.post('/api/startups', {
      data: {
        name: draftName,
        description: 'Automated e2e fixture — draft listing for admin page test. Safe to delete.',
        industry: 'SaaS',
        fundingGoal: 500_000,
        equityOffered: 10,
        maturityStage: 'IDEA',
      },
    });
    expect(draftRes.status(), `create draft → ${draftRes.status()} ${await draftRes.text()}`).toBe(201);

    const activeRes = await founderCtx.post('/api/startups', {
      data: {
        name: activeName,
        description: 'Automated e2e fixture — active listing for admin page test. Safe to delete.',
        industry: 'FinTech',
        fundingGoal: 1_000_000,
        equityOffered: 15,
        maturityStage: 'SEED',
      },
    });
    expect(activeRes.status(), `create active → ${activeRes.status()} ${await activeRes.text()}`).toBe(201);
    const active = await activeRes.json();
    activeId = active.id;

    const publishRes = await founderCtx.patch(`/api/startups/${activeId}`, { data: { status: 'ACTIVE' } });
    expect(publishRes.status(), `publish active → ${publishRes.status()}`).toBe(200);

    // Investor bookmarks it and sends a contact request — the D2 fixtures.
    const saveRes = await investorCtx.post(`/api/startups/${activeId}/save`);
    expect(saveRes.status(), `save → ${saveRes.status()}`).toBe(200);
    const saveBody = await saveRes.json();
    expect(saveBody.saved).toBe(true);

    const contactRes = await investorCtx.post(`/api/startups/${activeId}/contact`, {
      data: { message: 'Automated e2e fixture — interested in learning more about this startup.' },
    });
    expect(contactRes.status(), `contact → ${contactRes.status()} ${await contactRes.text()}`).toBe(201);
  });

  test.afterAll(async () => {
    await founderCtx.dispose();
    await investorCtx.dispose();
  });

  test('non-admin (entrepreneur) is forbidden from the admin startups API', async () => {
    const res = await founderCtx.get('/api/admin/startups');
    expect(res.status(), `expected 403, got ${res.status()}`).toBe(403);
  });

  test('admin sees all statuses (including DRAFT) via the API', async () => {
    const adminCtx = await roleContext('admin');
    try {
      const res = await adminCtx.get('/api/admin/startups');
      expect(res.status(), `admin list → ${res.status()}`).toBe(200);
      const body = await res.json();
      const draftRow = body.items.find((s: any) => s.name === draftName);
      const activeRow = body.items.find((s: any) => s.name === activeName);
      expect(draftRow, 'draft listing should be visible to admin').toBeTruthy();
      expect(draftRow.status).toBe('DRAFT');
      expect(activeRow, 'active listing should be visible to admin').toBeTruthy();
      expect(activeRow.status).toBe('ACTIVE');
      expect(activeRow.founderName).toBeTruthy();
      expect(activeRow.founderEmail).toBeTruthy();
    } finally {
      await adminCtx.dispose();
    }
  });

  test('admin UI: table shows DRAFT, delete requires confirmation, cascade behaves per D2', async ({ page }) => {
    // This project's storageState is the seeded admin account.
    await page.goto('/en/dashboard/admin/startups');
    await page.waitForLoadState('networkidle');

    const search = page.getByPlaceholder('Search by name, founder, or industry…');
    await search.fill(draftName.slice(0, 20));
    await expect(page.getByText(draftName, { exact: true })).toBeVisible();
    await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();

    // Switch search to the active listing we're about to delete.
    await search.fill(activeName.slice(0, 20));
    const row = page.locator('tr').filter({ hasText: activeName });
    await expect(row).toBeVisible();

    async function openDeleteDialog() {
      await row.getByRole('button', { name: 'Actions' }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
    }

    // Cancel path: the row must survive.
    await openDeleteDialog();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(activeName)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();

    // Confirm path: the row must disappear.
    await openDeleteDialog();
    const deleteResponsePromise = page.waitForResponse(
      (r) => r.url().includes(`/api/admin/startups/${activeId}`) && r.request().method() === 'DELETE',
    );
    await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.ok(), `delete → ${deleteResponse.status()}`).toBeTruthy();
    await expect(page.getByText(activeName, { exact: true })).toHaveCount(0);

    // Disappeared from the investor-facing marketplace too.
    const marketplaceRes = await investorCtx.get('/api/startups');
    expect(marketplaceRes.ok()).toBeTruthy();
    const marketplace = await marketplaceRes.json();
    expect(marketplace.items.some((s: any) => s.id === activeId)).toBe(false);

    // D2: the listing itself is gone; the bookmark cascade-deleted with it;
    // the investor-contact record survives (frozen snapshot, historical record).
    const dbState = readLocalDb();
    expect(dbState.startupListings.some((s) => s.id === activeId)).toBe(false);
    expect(dbState.savedStartups.some((s) => s.startupId === activeId)).toBe(false);
    const survivingContact = dbState.investorContacts.find((c) => c.startupId === activeId);
    expect(survivingContact, 'investor contact history should be preserved, not orphaned into a crash').toBeTruthy();
    expect(survivingContact!.startupName).toBe(activeName);

    // The investor's own contact-history read must not crash on the now-deleted startup.
    const myContactRes = await investorCtx.get(`/api/startups/${activeId}/contact`);
    expect(myContactRes.ok(), `contact read after delete → ${myContactRes.status()}`).toBeTruthy();
    const myContact = await myContactRes.json();
    expect(myContact.request?.startupId).toBe(activeId);
  });
});
