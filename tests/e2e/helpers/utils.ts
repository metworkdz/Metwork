import { type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SCREENSHOT_DIR = path.resolve('tests/screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

/** Take a full-page screenshot saved to tests/screenshots/. */
export async function capture(page: Page, name: string): Promise<void> {
  const filename = name.replace(/[^a-z0-9_-]/gi, '_') + '.png';
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, filename), fullPage: true });
}

/** Structured result record written to tests/results-log.jsonl. */
export type Status = 'PASS' | 'FAIL' | 'SKIP';

export interface TestResult {
  agent: string;
  id: string;
  name: string;
  status: Status;
  detail?: string;
  ts: string;
}

const RESULTS_FILE = path.resolve('tests/results-log.jsonl');

export function log(agent: string, id: string, name: string, status: Status, detail = ''): void {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️';
  const line = `${icon} [${agent}] ${id} — ${name}${detail ? ' | ' + detail : ''}`;
  console.log(line);

  const record: TestResult = { agent, id, name, status, detail: detail || undefined, ts: new Date().toISOString() };
  fs.appendFileSync(RESULTS_FILE, JSON.stringify(record) + '\n');
}

/** Navigate to a page and return true if it resolves (not 404/error). */
export async function tryGoto(page: Page, url: string): Promise<boolean> {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
  const status = resp?.status() ?? 0;
  if (status === 404) return false;
  // Check for Next.js not-found page rendered client-side.
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (bodyText.includes('404') && bodyText.length < 500) return false;
  return true;
}

/** Return visible inner-text of <main> (or <body> fallback). */
export async function mainText(page: Page): Promise<string> {
  return page.locator('main').innerText().catch(() => page.locator('body').innerText());
}
