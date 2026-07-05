/**
 * API-driven e2e — MANUAL withdrawal flow (user wallet + mentor-ledger guard).
 *
 * Covers the requester → hold → admin approve/reject lifecycle end to end,
 * asserting against AUTHORITATIVE server state (the local-DB document), never a
 * single response DTO. The notifier is observed through the USE_LOCAL_DB email
 * sink so "email fired exactly once" survives an idempotent double-approve.
 *
 * Run constraints (mirror the rest of the api suite):
 *   • Serial, workers:1 (playwright.api.config.ts) — shares the one JSON doc.
 *   • MOCK_PAYMENT_MODE=sync + USE_LOCAL_DB=true + known AUTH_SECRET.
 *   • Uses `explorer` for the user-wallet path (its own fresh 5/day withdrawal
 *     rate-limit budget — `founder` is already spent by admin-ops.spec) and
 *     keeps to ≤4 POST /api/withdrawals so the budget is never exhausted.
 *
 * Notes on shipped behaviour (deliberate — see SESSION_LOG):
 *   • The admin withdrawal view returns the FULL destination snapshot (the
 *     admin needs the real RIB/RIP to wire the money) — asserted un-masked.
 *   • A receipt is attached AT the approval PATCH (`receiptUrl`); there is no
 *     standalone attach route yet, so assertions 5 + 6 are exercised together.
 */
import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { roleContext, walletBalance, SEED } from './_helpers';
import { mintConsultantContext } from './_consult-helpers';
import {
  VALID_RIB,
  VALID_RIP,
  putUserPayoutAccount,
  putConsultantPayoutAccount,
  createUserWithdrawal,
  createConsultantWithdrawal,
  adminDecideUser,
  userWithdrawalById,
  txnById,
  uploadReceipt,
  countEmails,
  clearEmailSink,
} from './_withdrawal-helpers';

/** The `explorer` account email — the recipient the notifier resolves + records. */
const EXPLORER_EMAIL = 'test.explorer@metwork.test';

async function errCode(res: APIResponse): Promise<string | undefined> {
  const body = await res.json().catch(() => ({}));
  return body?.error?.code;
}
async function dump(res: APIResponse): Promise<string> {
  return `${res.status()} ${await res.text()}`;
}

test.describe.serial('Manual withdrawal flow', () => {
  let explorer: APIRequestContext;
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    explorer = await roleContext('explorer');
    admin = await roleContext('admin');
    clearEmailSink();
  });

  test.afterAll(async () => {
    await explorer.dispose();
    await admin.dispose();
  });

  /* ─── 2. Payout account: bank/ccp save with the right type; invalid rejected;
   *        method must match the saved account type. ─── */
  test('payout account — bank + ccp save with the right type; invalid rejected; method gate', async () => {
    // Invalid number (not 20 digits) → 422.
    const bad = await putUserPayoutAccount(explorer, {
      accountType: 'bank', accountNumber: '12345', holderName: 'QA Explorer',
    });
    expect(bad.status(), `invalid RIB → ${await dump(bad)}`).toBe(422);
    expect(await errCode(bad)).toBe('INVALID_ACCOUNT_NUMBER');

    // Save a BANK account (RIB).
    const bank = await putUserPayoutAccount(explorer, {
      accountType: 'bank', accountNumber: VALID_RIB, holderName: 'QA Explorer',
    });
    expect(bank.status(), `save bank → ${await dump(bank)}`).toBe(200);
    expect((await bank.json()).payoutAccount).toMatchObject({ accountType: 'bank', accountNumber: VALID_RIB });

    // GET reflects the saved bank account.
    const get1 = await explorer.get('/api/payout-account');
    expect((await get1.json()).payoutAccount).toMatchObject({ accountType: 'bank' });

    // Method must match the saved type: a CCP request with a BANK on file → 422.
    const mismatch = await createUserWithdrawal(explorer, { amount: 1000, method: 'ccp' });
    expect(mismatch.status(), `method mismatch → ${await dump(mismatch)}`).toBe(422);
    expect(await errCode(mismatch)).toBe('NO_PAYOUT_ACCOUNT');

    // Replace with a CCP account (RIP) — replaces cleanly, right type.
    const ccp = await putUserPayoutAccount(explorer, {
      accountType: 'ccp', accountNumber: VALID_RIP, holderName: 'QA Explorer',
    });
    expect(ccp.status(), `save ccp → ${await dump(ccp)}`).toBe(200);
    expect((await ccp.json()).payoutAccount).toMatchObject({ accountType: 'ccp', accountNumber: VALID_RIP });
  });

  /* ─── 3. Creating a request holds the balance; can't double-request the same
   *        funds / exceed the available balance. ─── */
  test('creating a request holds the balance and cannot exceed / double-spend it', async () => {
    // Put a BANK account back so a bank_transfer request is valid.
    await putUserPayoutAccount(explorer, { accountType: 'bank', accountNumber: VALID_RIB, holderName: 'QA Explorer' });

    const before = await walletBalance(explorer);

    // A request beyond the balance is refused (hold never placed).
    const over = await createUserWithdrawal(explorer, { amount: before + 1, method: 'bank_transfer' });
    expect(over.status(), `over-balance → ${await dump(over)}`).toBe(422);
    expect(await errCode(over)).toBe('INSUFFICIENT_FUNDS');

    // A valid request holds the amount immediately.
    const res = await createUserWithdrawal(explorer, { amount: 2000, method: 'bank_transfer' });
    expect(res.status(), `create → ${await dump(res)}`).toBe(201);
    const id = (await res.json()).withdrawalRequest.id as string;

    expect(await walletBalance(explorer), 'available drops by the held amount').toBe(before - 2000);

    const rec = userWithdrawalById(id)!;
    expect(rec.status).toBe('PENDING');
    expect(rec.method).toBe('bank_transfer');
    // Destination snapshot frozen onto the request at creation time.
    expect(rec.destinationAccountSnapshot).toMatchObject({ accountType: 'bank', accountNumber: VALID_RIB });
    expect(txnById(rec.holdTransactionId!)?.status, 'hold txn is PENDING').toBe('PENDING');

    // The same funds can't be requested twice: a second request for the
    // pre-hold balance now exceeds the reduced available balance.
    const twice = await createUserWithdrawal(explorer, { amount: before, method: 'bank_transfer' });
    expect(twice.status(), `double-spend → ${await dump(twice)}`).toBe(422);
    expect(await errCode(twice)).toBe('INSUFFICIENT_FUNDS');

    // Hand the id to the next tests via a module-scoped stash.
    heldRequestId = id;
  });

  /* ─── 4. Admin sees the request with the right user, amount, method and
   *        (approach A) the FULL, un-masked destination. ─── */
  test('admin sees the request with correct user, amount, method and full destination', async () => {
    const res = await admin.get('/api/admin/withdrawals');
    expect(res.status(), `admin list → ${await dump(res)}`).toBe(200);
    const { items } = await res.json();
    const row = (items as Array<Record<string, unknown>>).find((r) => r.id === heldRequestId);
    expect(row, 'held request present in the admin list').toBeTruthy();

    expect(row!.userId).toBe(SEED.explorerId);
    expect(row!.userName).toBeTruthy();
    expect(row!.amount).toBe(2000);
    expect(row!.method).toBe('bank_transfer');
    const snap = row!.destinationAccountSnapshot as { accountType: string; accountNumber: string } | null;
    expect(snap?.accountType).toBe('bank');
    // Approach A: the admin gets the FULL RIB (needed to wire the funds), not masked.
    expect(snap?.accountNumber).toBe(VALID_RIB);
    expect(snap?.accountNumber).not.toContain('*');
  });

  /* ─── 5 + 6. Approve WITH an uploaded receipt → status approved, receipt on the
   *            request, hold settled, email once; a double-click never
   *            double-debits or double-emails. ─── */
  test('approve with receipt is idempotent — settles once, emails once, no double-debit', async () => {
    const balanceAfterHold = await walletBalance(explorer);

    // Reuse the existing uploader to attach proof of the manual transfer.
    const receiptUrl = await uploadReceipt(admin);

    const first = await adminDecideUser(admin, heldRequestId, {
      status: 'APPROVED', adminNote: 'Wired manually', receiptUrl,
    });
    expect(first.status(), `approve → ${await dump(first)}`).toBe(200);
    expect((await first.json()).withdrawalRequest.status).toBe('APPROVED');

    const afterFirst = userWithdrawalById(heldRequestId)!;
    expect(afterFirst.status).toBe('APPROVED');
    expect(afterFirst.approvedAt, 'approvedAt stamped').toBeTruthy();
    expect(afterFirst.processedByAdminId).toBe(SEED.adminId);
    expect(afterFirst.receiptUrl, 'receipt appears on the request').toBe(receiptUrl);
    expect(txnById(afterFirst.holdTransactionId!)?.status, 'hold settled COMPLETED').toBe('COMPLETED');
    // Approval never touches the balance again — the money left at request time.
    expect(await walletBalance(explorer)).toBe(balanceAfterHold);

    // Email fired exactly once for this approval (poll: notifier is async).
    await expect
      .poll(() => countEmails('withdrawal-approved', EXPLORER_EMAIL, 2000), { timeout: 10_000 })
      .toBe(1);
    const approvedAt1 = afterFirst.approvedAt;

    // Double-click: a second approve is an idempotent replay (200, no change).
    const second = await adminDecideUser(admin, heldRequestId, { status: 'APPROVED', receiptUrl });
    expect(second.status(), `replay approve → ${await dump(second)}`).toBe(200);

    const afterSecond = userWithdrawalById(heldRequestId)!;
    expect(afterSecond.approvedAt, 'approvedAt unchanged on replay').toBe(approvedAt1);
    expect(await walletBalance(explorer), 'no double-debit on replay').toBe(balanceAfterHold);

    // Still exactly one email — the replay did not re-notify.
    await expect
      .poll(() => countEmails('withdrawal-approved', EXPLORER_EMAIL, 2000), { timeout: 5_000 })
      .toBe(1);
  });

  /* ─── 7. Reject → hold released back to available; idempotent (no double-refund). ─── */
  test('reject releases the hold back to the balance and never double-refunds', async () => {
    const before = await walletBalance(explorer);

    const res = await createUserWithdrawal(explorer, { amount: 1000, method: 'bank_transfer' });
    expect(res.status(), `create → ${await dump(res)}`).toBe(201);
    const id = (await res.json()).withdrawalRequest.id as string;
    expect(await walletBalance(explorer)).toBe(before - 1000);

    const reject = await adminDecideUser(admin, id, { status: 'REJECTED', adminNote: 'Wrong RIB' });
    expect(reject.status(), `reject → ${await dump(reject)}`).toBe(200);
    expect((await reject.json()).withdrawalRequest.status).toBe('REJECTED');

    const rec = userWithdrawalById(id)!;
    expect(rec.status).toBe('REJECTED');
    expect(txnById(rec.holdTransactionId!)?.status, 'hold reversed').toBe('REVERSED');
    expect(await walletBalance(explorer), 'escrow refunded').toBe(before);

    // Idempotent: a replayed reject returns 200 and never refunds twice.
    const again = await adminDecideUser(admin, id, { status: 'REJECTED' });
    expect(again.status(), `replay reject → ${await dump(again)}`).toBe(200);
    expect(await walletBalance(explorer), 'no double-refund').toBe(before);
  });

  /* ─── Mentor-ledger wiring: payout account save + method gate. (Full mentor
   *      completion→withdrawal→payout lifecycle lives in consultation-portal.spec.) ─── */
  test('consultant payout account saves and gates method by type', async () => {
    const { ctx: consultant } = await mintConsultantContext(admin);
    try {
      const bank = await putConsultantPayoutAccount(consultant, {
        accountType: 'bank', accountNumber: VALID_RIB, holderName: 'QA Mentor',
      });
      expect(bank.status(), `mentor save bank → ${await dump(bank)}`).toBe(200);

      const ccp = await putConsultantPayoutAccount(consultant, {
        accountType: 'ccp', accountNumber: VALID_RIP, holderName: 'QA Mentor',
      });
      expect(ccp.status(), `mentor save ccp → ${await dump(ccp)}`).toBe(200);

      const get = await consultant.get('/api/consultant/payout-account');
      expect((await get.json()).payoutAccount).toMatchObject({ accountType: 'ccp', accountNumber: VALID_RIP });

      // A bank_transfer request with only a CCP on file → NO_PAYOUT_ACCOUNT
      // (asserted before any balance dependency, so this is deterministic).
      const mismatch = await createConsultantWithdrawal(consultant, { amount: 500, method: 'bank_transfer' });
      expect(mismatch.status(), `mentor method mismatch → ${await dump(mismatch)}`).toBe(422);
      expect(await errCode(mismatch)).toBe('NO_PAYOUT_ACCOUNT');
    } finally {
      await consultant.dispose();
    }
  });
});

/** Held request id shared from the "hold" test to the admin-view / approve tests. */
let heldRequestId: string;
