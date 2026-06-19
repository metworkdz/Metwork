/**
 * Idempotency tests for incubator CSV bulk-import (income & expenses).
 *
 * A retried upload with the same clientReference must replay the original batch
 * — never duplicate financial rows (which would distort the incubator's P&L).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import { importIncomeRows, importExpenseRows } from '@/server/incubator/import-service';

const INC = 'inc-1';
const REF_A = 'ref-aaaaaaaa';
const REF_B = 'ref-bbbbbbbb';

const incomeRow = { date: '2026-06-01', clientName: 'Acme', serviceName: 'Desk', amount: 1000, paymentMethod: 'CASH' };
const expenseRow = { date: '2026-06-01', title: 'Rent', amount: 5000 };

async function reset() {
  await db.update((d) => {
    d.income = [];
    d.expenses = [];
    d.clients = [];
    d.services = [];
  });
}

describe('importIncomeRows — idempotency', () => {
  beforeEach(reset);

  it('replays a re-submitted batch instead of duplicating rows', async () => {
    const first = await importIncomeRows(INC, [incomeRow], REF_A);
    expect(first).toMatchObject({ imported: 1, skipped: 0, replayed: false, batchId: REF_A });

    const second = await importIncomeRows(INC, [incomeRow], REF_A);
    expect(second).toMatchObject({ imported: 1, replayed: true, batchId: REF_A });

    const data = await db.read();
    expect(data.income.filter((r) => r.incubatorId === INC)).toHaveLength(1); // not 2
    expect(data.income[0]!.importBatchId).toBe(REF_A);
    // The replay also must not create a second client / service.
    expect(data.clients.filter((c) => c.incubatorId === INC)).toHaveLength(1);
    expect(data.services.filter((s) => s.incubatorId === INC)).toHaveLength(1);
  });

  it('distinct references both insert', async () => {
    await importIncomeRows(INC, [incomeRow], REF_A);
    await importIncomeRows(INC, [incomeRow], REF_B);
    const data = await db.read();
    expect(data.income.filter((r) => r.incubatorId === INC)).toHaveLength(2);
  });

  it('without a reference each call is a fresh batch (legacy behaviour)', async () => {
    await importIncomeRows(INC, [incomeRow]);
    await importIncomeRows(INC, [incomeRow]);
    const data = await db.read();
    expect(data.income.filter((r) => r.incubatorId === INC)).toHaveLength(2);
  });

  it('skips invalid rows and reports them', async () => {
    const res = await importIncomeRows(INC, [incomeRow, { date: 'bad', clientName: '', serviceName: 'X', amount: -1 }], REF_A);
    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]!.row).toBe(2);
  });
});

describe('importExpenseRows — idempotency', () => {
  beforeEach(reset);

  it('replays a re-submitted batch instead of duplicating rows', async () => {
    const first = await importExpenseRows(INC, [expenseRow], REF_A);
    expect(first).toMatchObject({ imported: 1, replayed: false, batchId: REF_A });

    const second = await importExpenseRows(INC, [expenseRow], REF_A);
    expect(second).toMatchObject({ imported: 1, replayed: true });

    const data = await db.read();
    const rows = data.expenses.filter((r) => r.incubatorId === INC);
    expect(rows).toHaveLength(1); // not 2
    expect(rows[0]!.importBatchId).toBe(REF_A); // batch ref persisted on the row
  });

  it('distinct references both insert; no reference is always a fresh batch', async () => {
    await importExpenseRows(INC, [expenseRow], REF_A);
    await importExpenseRows(INC, [expenseRow], REF_B);
    await importExpenseRows(INC, [expenseRow]);
    await importExpenseRows(INC, [expenseRow]);
    const data = await db.read();
    expect(data.expenses.filter((r) => r.incubatorId === INC)).toHaveLength(4);
  });
});
