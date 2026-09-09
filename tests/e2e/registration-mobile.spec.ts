/**
 * The public registration link on a phone — the surface almost every applicant
 * will actually use, because the link gets shared on WhatsApp.
 *
 * WHY THIS SUITE EXISTS
 *  • ZOOM. Every input was `text-sm` (14px) with no 16px floor anywhere. iOS
 *    Safari zooms the viewport whenever a field under 16px takes focus, and it
 *    never zooms back — on an eleven-question form that is eleven jolts. The
 *    computed-font-size assertions below are what stop that regressing.
 *  • ONE WALL OF INPUTS. The form rendered every field in a single column. It
 *    is now one question per screen; these tests walk that flow and check the
 *    progress and back affordances exist at each step.
 *  • TAP TARGETS. Choice options were 16px native controls in a bare label.
 *    Every interactive row must clear 44px.
 *  • PRICE. A split-priced listing must show BOTH amounts, and the payment
 *    step must reprice when the method changes — the defect that started all
 *    of this ("both are 24 000").
 *
 * Read-only apart from creating its own fixture; it never completes a payment.
 *
 *   npx playwright test --project=registration-mobile --workers=1
 */
import { test, expect, devices, type Page } from '@playwright/test';
import { roleContext, createProgram, setRegistrationForm } from './api/_helpers';

test.use({ ...devices['iPhone 13'], browserName: 'chromium' });

const ONLINE_PRICE = 22_000;
const CASH_PRICE = 24_000;

/** iOS zooms below this; 44px is the platform minimum touch target. */
const MIN_FONT_PX = 16;
const MIN_TARGET_PX = 44;

let slug: string;
let questionCount: number;

test.beforeAll(async () => {
  const inc = await roleContext('incubator');
  try {
    const program = await createProgram(inc, {
      title: `QA Mobile Training ${Date.now()}`,
      type: 'TRAINING',
      price: CASH_PRICE,
      onlinePrice: ONLINE_PRICE,
      cashPrice: CASH_PRICE,
      seatsTotal: 20,
      acceptedPaymentMethods: ['ONLINE', 'CASH'],
      cashDepositType: 'PERCENT',
      cashDepositValue: 25,
    });
    const fields = await setRegistrationForm(inc, 'PROGRAM', program.id, [
      { label: 'Startup / project name', type: 'SHORT_TEXT', required: true },
      { label: 'Stage', type: 'DROPDOWN', options: ['Idea', 'MVP'], required: true },
      { label: 'Tell us about your project', type: 'LONG_TEXT', required: true },
      { label: 'What do you expect?', type: 'CHECKBOX', options: ['Mentoring', 'Funding'], required: false },
    ]);
    slug = program.slug;
    questionCount = fields.length;
  } finally {
    await inc.dispose();
  }
});

async function documentOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

/** Every focusable control currently on screen, with what a phone cares about. */
async function controls(page: Page) {
  return page.evaluate(() => {
    const form = document.querySelector('form');
    if (!form) return [];
    return [...form.querySelectorAll('input, textarea, select, button, label')]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        fontSize: parseFloat(getComputedStyle(el).fontSize),
        height: el.getBoundingClientRect().height,
        text: (el.textContent ?? '').trim().slice(0, 40),
      }));
  });
}

/** Advance one step, filling whatever the current one asks for. */
async function nextStep(page: Page) {
  const select = page.locator('form select');
  const textarea = page.locator('form textarea');
  const text = page.locator('form input[type=text], form input[type=url]');
  if (await select.count()) await select.selectOption({ index: 1 });
  else if (await textarea.count()) await textarea.first().fill('Une plateforme pour les artisans.');
  else if (await text.count()) await text.first().fill('Atelier Verte');
  await page.locator('form button[type=submit]').click();
}

for (const locale of ['fr', 'ar', 'en'] as const) {
  test(`${locale} — the page fits the phone and nothing zooms on focus`, async ({ page }) => {
    await page.goto(`/${locale}/programs/${slug}`);
    await page.waitForLoadState('networkidle');

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(scrollWidth, `${locale} scrolls sideways`).toBeLessThanOrEqual(clientWidth + 1);

    if (locale === 'ar') {
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    }

    for (const c of await controls(page)) {
      if (c.tag === 'input' || c.tag === 'textarea' || c.tag === 'select') {
        expect(c.fontSize, `${locale}: ${c.tag} at ${c.fontSize}px triggers iOS zoom`)
          .toBeGreaterThanOrEqual(MIN_FONT_PX);
        expect(c.height, `${locale}: ${c.tag} target is ${c.height}px`)
          .toBeGreaterThanOrEqual(MIN_TARGET_PX);
      }
      if (c.tag === 'button' && c.text) {
        expect(c.height, `${locale}: button "${c.text}" is ${c.height}px`)
          .toBeGreaterThanOrEqual(MIN_TARGET_PX);
      }
    }
  });
}

test('both prices are shown, not just the base one', async ({ page }) => {
  await page.goto(`/fr/programs/${slug}`);
  await page.waitForLoadState('networkidle');

  // THE reported defect: one number for two different payment methods.
  const card = page.locator('form').locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  const priceText = (await card.innerText()).replace(/ | /g, ' ');
  expect(priceText).toMatch(/22[\s.]000/);
  expect(priceText).toMatch(/24[\s.]000/);
});

test('the form asks one question at a time, with progress and a way back', async ({ page }) => {
  await page.goto(`/fr/programs/${slug}`);
  await page.waitForLoadState('networkidle');

  const form = page.locator('form');
  // identity + one step per question + payment
  const totalSteps = questionCount + 2;
  await expect(form.getByText(new RegExp(`1\\s*/?\\s*(sur|of|من)?\\s*${totalSteps}`))).toBeVisible();
  await expect(form.locator('[role="progressbar"]')).toBeVisible();

  // Step 1 asks only for identity — no custom question is on screen with it.
  await expect(form.locator('input, textarea, select')).toHaveCount(3);
  // Nothing to go back to yet.
  await expect(form.getByRole('button', { name: /Retour/i })).toHaveCount(0);

  // Blocked until the identity is valid — the CTA must not silently do nothing.
  await form.locator('button[type=submit]').click();
  await expect(form.getByText(/adresse email valide|obligatoire/i).first()).toBeVisible();

  await page.locator('#reg-name').fill('Amina Benali');
  await page.locator('#reg-email').fill(`qa.mobile.${Date.now()}@metwork.test`);
  await page.locator('#reg-phone').fill('+213770112233');
  await form.locator('button[type=submit]').click();

  await expect(form.getByText(/2\s*(sur|of|من)\s*/)).toBeVisible();
  await expect(form.getByRole('button', { name: /Retour/i })).toBeVisible();
  // One question per screen from here on.
  await expect(form.locator('input, textarea, select')).toHaveCount(1);

  // Back returns to the identity step with the answers still filled in.
  await form.getByRole('button', { name: /Retour/i }).click();
  await expect(page.locator('#reg-name')).toHaveValue('Amina Benali');
});

test('the payment step reprices when the method changes', async ({ page }) => {
  await page.goto(`/fr/programs/${slug}`);
  await page.waitForLoadState('networkidle');

  const form = page.locator('form');
  await page.locator('#reg-name').fill('Karim Saidi');
  await page.locator('#reg-email').fill(`qa.pay.${Date.now()}@metwork.test`);
  await page.locator('#reg-phone').fill('+213770112244');
  await form.locator('button[type=submit]').click();

  for (let i = 0; i < questionCount; i++) await nextStep(page);

  // The last step is payment.
  await expect(form.getByRole('button', { name: /Payer par carte/i })).toBeVisible();

  // Read the SUMMARY block only — "sur place" also appears in the cash option's
  // own description, which is on screen whichever method is selected.
  const summary = form.locator('div.rounded-lg.border').filter({ hasText: 'Total' }).last();
  const norm = async () => (await summary.innerText()).replace(/\u202f|\u00a0/g, ' ');

  // Card: the full online price, nothing owed on site.
  await form.getByRole('button', { name: /Payer par carte/i }).click();
  const online = await norm();
  expect(online).toMatch(/22 000/);
  expect(online).not.toMatch(/sur place/i);

  // Cash: the cash total, split into a deposit now and a balance on site.
  await form.getByRole('button', { name: /Payer en espèces/i }).click();
  const cash = await norm();
  expect(cash).toMatch(/24 000/);
  expect(cash).toMatch(/6 000/);
  expect(cash).toMatch(/18 000/);
  expect(cash).toMatch(/sur place/i);

  // And the fee is disclosed BEFORE the redirect, not sprung at checkout.
  expect(cash).toMatch(/frais de traitement/i);

  // The CTA names the amount actually about to be charged. `\s` so the match
  // survives the narrow no-break space Intl uses as the fr-DZ group separator.
  await expect(form.locator('button[type=submit]')).toContainText(/6\s?000/);
});

test('choice options are full-size tap targets', async ({ page }) => {
  await page.goto(`/fr/programs/${slug}`);
  await page.waitForLoadState('networkidle');

  const form = page.locator('form');
  await page.locator('#reg-name').fill('Sara Amrani');
  await page.locator('#reg-email').fill(`qa.tap.${Date.now()}@metwork.test`);
  await page.locator('#reg-phone').fill('+213770112255');
  await form.locator('button[type=submit]').click();

  // Walk to the CHECKBOX question (the last one in the fixture form).
  for (let i = 0; i < questionCount - 1; i++) await nextStep(page);

  const rows = form.locator('label:has(input[type=checkbox])');
  await expect(rows.first()).toBeVisible();
  for (const box of await rows.all()) {
    const h = (await box.boundingBox())?.height ?? 0;
    expect(h, 'a choice row is under the 44px minimum').toBeGreaterThanOrEqual(MIN_TARGET_PX);
  }
});
