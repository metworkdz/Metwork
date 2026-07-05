/**
 * Shared helpers for the MANUAL withdrawal e2e suite (withdrawal-flow.spec.ts).
 *
 * API-driven like the rest of the api suite: every assertion reads the
 * authoritative local-DB document (`readLocalDb`) rather than a single DTO.
 *
 * Email observability: the server (USE_LOCAL_DB=true) appends one JSONL line
 * per would-be withdrawal email to `.e2e-emails.jsonl` next to the local DB
 * (see src/server/notifications/e2e-email-sink.ts). `readEmailSink` /
 * `countEmails` read it so a test can assert "email triggered exactly once"
 * across an idempotent double-approve.
 */
import { expect, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BASE, readLocalDb } from './_helpers';

export type AccountType = 'bank' | 'ccp';
export type WithdrawalMethod = 'bank_transfer' | 'ccp' | 'cheque';

export interface PayoutAccountInput {
  accountType: AccountType;
  accountNumber: string;
  holderName: string;
}

/** A valid 20-digit RIB / RIP for tests (spaces tolerated by the server). */
export const VALID_RIB = '00799999000123456789';
export const VALID_RIP = '00799999000987654321';

/* ───────────────────────────── Payout account ───────────────────────────── */

/** PUT the caller's user payout account. Returns the APIResponse for status asserts. */
export function putUserPayoutAccount(ctx: APIRequestContext, account: PayoutAccountInput) {
  return ctx.put('/api/payout-account', { data: account });
}

/** PUT the caller's consultant payout account. */
export function putConsultantPayoutAccount(ctx: APIRequestContext, account: PayoutAccountInput) {
  return ctx.put('/api/consultant/payout-account', { data: account });
}

/* ───────────────────────────── Withdrawal requests ───────────────────────────── */

export interface CreateWithdrawalBody {
  amount: number;
  method?: WithdrawalMethod;
  /** Legacy free-text path (no method). */
  accountDetails?: string;
}

/** POST a user withdrawal request. */
export function createUserWithdrawal(ctx: APIRequestContext, body: CreateWithdrawalBody) {
  return ctx.post('/api/withdrawals', { data: body });
}

/** POST a consultant withdrawal request. */
export function createConsultantWithdrawal(ctx: APIRequestContext, body: CreateWithdrawalBody) {
  return ctx.post('/api/consultant/withdrawals', { data: body });
}

/** PATCH an admin decision on a user withdrawal (approve / reject). */
export function adminDecideUser(
  admin: APIRequestContext,
  id: string,
  data: { status: 'APPROVED' | 'REJECTED'; adminNote?: string; receiptUrl?: string },
) {
  return admin.patch(`/api/admin/withdrawals/${id}`, { data });
}

/** PATCH an admin decision on a mentor withdrawal. */
export function adminDecideMentor(
  admin: APIRequestContext,
  id: string,
  data: { status: 'APPROVED' | 'REJECTED'; adminNote?: string; receiptUrl?: string },
) {
  return admin.patch(`/api/admin/mentor-withdrawals/${id}`, { data });
}

/* ───────────────────────────── Server-state reads ───────────────────────────── */

interface WithdrawalRecord {
  id: string;
  userId?: string;
  mentorId?: string;
  amount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  method?: string | null;
  destinationAccountSnapshot?: PayoutAccountInput | null;
  receiptUrl?: string | null;
  approvedAt?: string | null;
  processedByAdminId?: string | null;
  holdTransactionId?: string;
  holdTxnId?: string;
  refundTransactionId?: string | null;
  refundTxnId?: string | null;
}

/** A user withdrawal record straight from the local DB (or undefined). */
export function userWithdrawalById(id: string): WithdrawalRecord | undefined {
  const db = readLocalDb() as unknown as { withdrawalRequests: WithdrawalRecord[] };
  return (db.withdrawalRequests ?? []).find((r) => r.id === id);
}

/** A mentor withdrawal record straight from the local DB (or undefined). */
export function mentorWithdrawalById(id: string): WithdrawalRecord | undefined {
  const db = readLocalDb() as unknown as { mentorWithdrawals?: WithdrawalRecord[] };
  return (db.mentorWithdrawals ?? []).find((r) => r.id === id);
}

/** A transaction record by id (for hold/refund status assertions). */
export function txnById(id: string): { status?: string } | undefined {
  const db = readLocalDb() as unknown as { transactions: Array<{ id: string; status?: string }> };
  return (db.transactions ?? []).find((t) => t.id === id);
}

/* ───────────────────────────── Uploader (reused) ───────────────────────────── */

/** A 1×1 transparent PNG — the smallest valid image the uploader will accept. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Upload a receipt image through the EXISTING /api/upload endpoint and return an
 * ABSOLUTE URL. In e2e (no Cloudinary) the uploader's filesystem fallback
 * returns a relative `/uploads/...` path; the admin PATCH `receiptUrl` requires
 * an absolute URL (in prod Cloudinary already returns one), so we prefix BASE.
 */
export async function uploadReceipt(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.post('/api/upload', {
    multipart: {
      folder: 'receipts',
      file: { name: 'receipt.png', mimeType: 'image/png', buffer: PNG_1x1 },
    },
  });
  expect(res.status(), `upload → ${res.status()} ${await res.text()}`).toBe(201);
  const { url } = await res.json();
  return /^https?:\/\//.test(url) ? url : `${BASE}${url}`;
}

/* ───────────────────────────── Email sink ───────────────────────────── */

function emailSinkPath(): string {
  const dbPath = process.env.LOCAL_DB_PATH ?? '.local-db.json';
  return path.join(path.dirname(dbPath), '.e2e-emails.jsonl');
}

interface EmailRecord {
  kind: string;
  to: string;
  amount: number;
  at: string;
  method?: string | null;
}

/** Read every recorded would-be email (empty if the sink file doesn't exist). */
export function readEmailSink(): EmailRecord[] {
  const p = emailSinkPath();
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EmailRecord);
}

/** Count sink records matching a kind + recipient + amount (the idempotency key). */
export function countEmails(kind: string, to: string, amount: number): number {
  return readEmailSink().filter((e) => e.kind === kind && e.to === to && e.amount === amount).length;
}

/** Truncate the sink so a test starts from a clean slate. */
export function clearEmailSink(): void {
  const p = emailSinkPath();
  if (fs.existsSync(p)) fs.writeFileSync(p, '', 'utf8');
}
