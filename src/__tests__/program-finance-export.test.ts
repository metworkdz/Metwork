/**
 * Exporting a program's financial report, and the program tag on the general
 * expenses ledger.
 *
 * An export lands in a spreadsheet or on a funder's desk, so the things that
 * matter are: it shows the same figures as the tab, a host-typed title can
 * never become a live formula, and nobody can export someone else's program.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const incubatorActor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => ({ ok: true, user: incubatorActor }));
  return { requireApiRole: guard, requireApprovedApiRole: guard };
});
vi.mock('@/server/mentors/access', () => ({
  requireConsultant: vi.fn(async () => ({ ok: true, mentorId: 'mentor-1' })),
}));

import { db } from '@/server/db/store';
import {
  buildProgramFinanceCsv,
  csvCell,
  financeFilename,
  renderProgramFinancePdf,
} from '@/server/program-finance/export';
import { loadProgramFinances } from '@/server/program-finance/service';
import { incubatorScope } from '@/server/registrations/service';

const NOW = '2026-09-01T10:00:00.000Z';
const A = incubatorScope('inc-a');

beforeEach(async () => {
  await db.update((d) => {
    d.users = [];
    d.incubators = [{ id: 'inc-a', name: 'Hub A', managerId: 'mgr-a', email: 'a@x.dz', status: 'ACTIVE' } as never];
    d.mentors = [{ id: 'mentor-1', fullName: 'Amina Benali' } as never];
    d.programs = [
      { id: 'p-a', incubatorId: 'inc-a', mentorId: null, title: 'Formation juridique', seatsTotal: 20,
        startDate: '2026-09-08T11:00:00.000Z', endDate: '2026-09-20T11:00:00.000Z' } as never,
      { id: 'p-m1', incubatorId: null, mentorId: 'mentor-1', title: 'Atelier', seatsTotal: 10,
        startDate: NOW, endDate: NOW } as never,
    ];
    d.registrations = [];
    d.bookings = [
      { id: 'b1', itemKind: 'PROGRAM', itemId: 'p-a', status: 'CONFIRMED', totalAmount: 12_000, userId: null,
        clientEmail: 'x@x.dz', paymentMethod: 'card', paymentMode: 'ONLINE_FULL', onlinePaidAmount: 12_000,
        cashRemainingAmount: 0, commissionAmount: 600, paymentStatus: 'PAID', createdAt: NOW } as never,
    ];
    d.expenses = [
      { id: 'e1', incubatorId: 'inc-a', programId: 'p-a', date: '2026-09-01', title: '=HYPERLINK("http://evil")',
        description: '@SUM(A1)', amount: 20_000, category: 'Salle', createdAt: NOW, updatedAt: NOW },
      { id: 'e2', incubatorId: 'inc-a', programId: 'p-a', date: '2026-09-02', title: 'استراحة القهوة',
        description: null, amount: 3_000, category: null, createdAt: NOW, updatedAt: NOW },
    ];
  });
});

describe('CSV', () => {
  it('neutralises anything that starts like a formula, and quotes what needs it', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+33 6')).toBe("'+33 6");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    // Numbers are numbers — a negative profit must stay summable.
    expect(csvCell(-30_300)).toBe('-30300');
    expect(csvCell(null)).toBe('');
  });

  it('carries the same figures as the report, and the expenses', async () => {
    const f = (await loadProgramFinances('p-a', A))!;
    const csv = buildProgramFinanceCsv(f, 'fr');
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toContain('Synthèse,Encaissé,12000');
    expect(lines).toContain('Synthèse,Bénéfice net,-11600');
    // Percentages are bare numbers, not text the formula guard would mangle.
    expect(lines.find((l) => l.startsWith('Synthèse,Marge nette (%)'))).toBe('Synthèse,Marge nette (%),-96.7');
    expect(csv).toContain(`'=HYPERLINK(""http://evil"")`);
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toContain('استراحة القهوة');
  });

  it('speaks the viewer\'s language', async () => {
    const f = (await loadProgramFinances('p-a', A))!;
    expect(buildProgramFinanceCsv(f, 'en')).toContain('Summary,Collected,12000');
    expect(buildProgramFinanceCsv(f, 'ar')).toContain('المحصّل');
  });
});

describe('PDF', () => {
  it('renders, and breaks a long expense list across pages', async () => {
    await db.update((d) => {
      for (let i = 0; i < 80; i++) {
        d.expenses.push({ id: `bulk-${i}`, incubatorId: 'inc-a', programId: 'p-a', date: '2026-09-03',
          title: `Dépense ${i}`, description: null, amount: 100, category: 'Divers', createdAt: NOW, updatedAt: NOW });
      }
    });
    const pdf = await renderProgramFinancePdf((await loadProgramFinances('p-a', A))!);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });

  it('names the file safely', () => {
    expect(financeFilename('Formation « juridique » / 2026', 'pdf')).toBe('Rapport financier - Formation juridique 2026.pdf');
    expect(financeFilename('تكوين', 'csv')).toBe('Rapport financier.csv');
  });
});

describe('the export route', () => {
  const get = (qs: string) => new NextRequest(`http://localhost/x?${qs}`);
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it('answers CSV and PDF with the right type and a download name', async () => {
    const { GET } = await import('@/app/api/incubator/programs/[id]/finances/export/route');
    const csv = await GET(get('format=csv&lang=en'), ctx('p-a'));
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csv.headers.get('content-disposition')).toBe('attachment; filename="Rapport financier - Formation juridique.csv"');
    expect(await csv.text()).toContain('Collected');

    const pdf = await GET(get('format=pdf'), ctx('p-a'));
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
  });

  it('refuses an unknown format, and another owner\'s program', async () => {
    const { GET } = await import('@/app/api/incubator/programs/[id]/finances/export/route');
    expect((await GET(get('format=xlsx'), ctx('p-a'))).status).toBe(400);
    expect((await GET(get('format=csv'), ctx('p-m1'))).status).toBe(404);
    const consultant = await import('@/app/api/consultant/programs/[id]/finances/export/route');
    expect((await consultant.GET(get('format=csv'), ctx('p-a'))).status).toBe(404);
    expect((await consultant.GET(get('format=csv'), ctx('p-m1'))).status).toBe(200);
  });
});

describe('the program tag on the general ledger', () => {
  it('an expense of a program deleted since can still be edited, keeping its tag', async () => {
    await db.update((d) => {
      d.expenses.push({ id: 'orphan', incubatorId: 'inc-a', programId: 'p-gone', date: '2026-09-01', title: 'Old',
        description: null, amount: 1_000, category: null, createdAt: NOW, updatedAt: NOW });
    });
    const { PATCH } = await import('@/app/api/incubator/expenses/[id]/route');
    const req = new NextRequest('http://localhost/x', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 2_000, programId: 'p-gone' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'orphan' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ amount: 2_000, programId: 'p-gone' });
  });
});
