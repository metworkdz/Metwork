/**
 * A program's finances for its owner: the report, and the expenses spent on
 * the program.
 *
 * Program expenses are ordinary rows of the expenses ledger, tagged with the
 * program — an incubator sees them in its Dépenses page like any other
 * expense, and the program's report counts them. A consultant has no ledger
 * of their own; their rows carry `mentorId` instead of `incubatorId` and are
 * only ever reached through their programs.
 *
 * Ownership is the registrations rule: a program owned by someone else, or an
 * expense of someone else's, is simply not found.
 */
import { randomUUID } from 'node:crypto';

import { programOwnedBy } from '@/server/certificates/service';
import { db, type ExpenseRecord, type ProgramRecord } from '@/server/db/store';
import type { OwnerScope } from '@/server/registrations/service';

import { computeProgramFinance, type ProgramFinanceReport } from './report';

type StoreData = Awaited<ReturnType<typeof db.read>>;

function findOwnedProgram(d: StoreData, programId: string, owner: OwnerScope): ProgramRecord | null {
  const program = (d.programs ?? []).find((p) => p.id === programId);
  return program && programOwnedBy(program, owner) ? program : null;
}

function expenseOwnedBy(e: ExpenseRecord, owner: OwnerScope): boolean {
  return owner.kind === 'MENTOR'
    ? e.mentorId === owner.mentorId
    : !e.mentorId && e.incubatorId === owner.incubatorId;
}

function programExpenses(d: StoreData, programId: string, owner: OwnerScope): ExpenseRecord[] {
  return (d.expenses ?? [])
    .filter((e) => e.programId === programId && expenseOwnedBy(e, owner))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export interface ProgramFinances {
  program: Pick<ProgramRecord, 'id' | 'title' | 'startDate' | 'endDate' | 'seatsTotal'>;
  /** The incubator's or the consultant's name — heads the exported report. */
  organizer: string;
  report: ProgramFinanceReport;
  expenses: ExpenseRecord[];
}

export async function loadProgramFinances(programId: string, owner: OwnerScope): Promise<ProgramFinances | null> {
  const d = await db.read();
  const program = findOwnedProgram(d, programId, owner);
  if (!program) return null;
  const expenses = programExpenses(d, programId, owner);
  const organizer = owner.kind === 'MENTOR'
    ? (d.mentors ?? []).find((m) => m.id === owner.mentorId)?.fullName
    : (d.incubators ?? []).find((i) => i.id === owner.incubatorId)?.name;
  return {
    program: {
      id: program.id,
      title: program.title,
      startDate: program.startDate,
      endDate: program.endDate,
      seatsTotal: program.seatsTotal,
    },
    organizer: organizer ?? program.incubatorName ?? '',
    // Only the owner's own expense rows reach the report — never a row some
    // other owner tagged with this id.
    report: computeProgramFinance({ ...d, expenses }, program),
    expenses,
  };
}

export interface ProgramExpenseInput {
  date: string;
  title: string;
  description?: string | null;
  amount: number;
  category?: string | null;
  receiptUrl?: string | null;
}

export async function createProgramExpense(
  programId: string,
  owner: OwnerScope,
  input: ProgramExpenseInput,
): Promise<ExpenseRecord | null> {
  return db.update((d) => {
    const program = findOwnedProgram(d, programId, owner);
    if (!program) return null;
    if (!Array.isArray(d.expenses)) d.expenses = [];
    const now = new Date().toISOString();
    const expense: ExpenseRecord = {
      id: randomUUID(),
      incubatorId: owner.kind === 'INCUBATOR' ? owner.incubatorId : null,
      mentorId: owner.kind === 'MENTOR' ? owner.mentorId : null,
      programId,
      date: input.date,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      amount: input.amount,
      category: input.category?.trim() || null,
      receiptUrl: input.receiptUrl ?? null,
      createdAt: now,
      updatedAt: now,
    };
    d.expenses.push(expense);
    return expense;
  });
}

export async function updateProgramExpense(
  programId: string,
  owner: OwnerScope,
  expenseId: string,
  patch: Partial<ProgramExpenseInput>,
): Promise<ExpenseRecord | null> {
  return db.update((d) => {
    if (!findOwnedProgram(d, programId, owner)) return null;
    const e = (d.expenses ?? []).find(
      (x) => x.id === expenseId && x.programId === programId && expenseOwnedBy(x, owner),
    );
    if (!e) return null;
    if (patch.date !== undefined) e.date = patch.date;
    if (patch.title !== undefined) e.title = patch.title.trim();
    if (patch.description !== undefined) e.description = patch.description?.trim() || null;
    if (patch.amount !== undefined) e.amount = patch.amount;
    if (patch.category !== undefined) e.category = patch.category?.trim() || null;
    if (patch.receiptUrl !== undefined) e.receiptUrl = patch.receiptUrl;
    e.updatedAt = new Date().toISOString();
    return { ...e };
  });
}

export async function deleteProgramExpense(
  programId: string,
  owner: OwnerScope,
  expenseId: string,
): Promise<boolean> {
  return db.update((d) => {
    if (!findOwnedProgram(d, programId, owner)) return false;
    const before = (d.expenses ?? []).length;
    d.expenses = (d.expenses ?? []).filter(
      (x) => !(x.id === expenseId && x.programId === programId && expenseOwnedBy(x, owner)),
    );
    return d.expenses.length < before;
  });
}
