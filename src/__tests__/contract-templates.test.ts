/**
 * Coverage for the contract-templates feature:
 *   - the pure variable engine (render safety, resolution, contract numbers)
 *   - template applicability (category matching)
 *   - CRUD ownership scoping (/api/incubator/contracts)
 *   - the generation endpoint guards + PDF output
 *     (/api/incubator/bookings/[id]/contract)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import {
  CONTRACT_VARIABLES,
  generateContractNumber,
  renderTemplate,
  resolveContractVariables,
} from '@/server/contracts/variables';
import { templateAppliesToCategory } from '@/server/contracts/service';

// INCUBATOR user mgr-1 ↔ incubator inc-1 (resolved by email).
vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: { id: 'mgr-1', email: 'i@x.com', role: 'INCUBATOR', approvalStatus: 'APPROVED' } });
  return {
    requireApiRole: vi.fn(ok),
    requireApprovedApiRole: vi.fn(ok),
    requireApiSession: vi.fn(ok),
    requireApprovedApiSession: vi.fn(ok),
  };
});

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const SPACE_BOOKING = 'bk-space-1';
const PROGRAM_BOOKING = 'bk-prog-1';
const TPL_TRAINING = 'tpl-training';
const TPL_ANY = 'tpl-any';
const TPL_OTHER_INC = 'tpl-foreign';

beforeEach(async () => {
  await db.update((d) => {
    d.incubators = [
      { id: 'inc-1', name: 'Algiers Incubator', status: 'ACTIVE', managerId: 'mgr-1', email: 'i@x.com', address: '12 Rue X', commercialRegNumber: 'RC-123', nif: 'NIF-999' } as never,
      { id: 'inc-2', name: 'Other Inc', status: 'ACTIVE', managerId: 'mgr-2', email: 'o@x.com' } as never,
    ];
    d.spaces = [
      { id: SPACE_ID, incubatorId: 'inc-1', incubatorName: 'Algiers Incubator', name: 'Training Room A', city: 'Algiers', isActive: true, capacity: 20, category: 'TRAINING_ROOM', workingDays: [0,1,2,3,4,5,6], openingTime: '00:00', closingTime: '23:59' } as never,
    ];
    d.users = [{ id: 'mgr-1', email: 'i@x.com', fullName: 'Manager One', role: 'INCUBATOR' } as never];
    d.bookings = [
      { id: SPACE_BOOKING, userId: null, source: 'offline', itemKind: 'SPACE', itemId: SPACE_ID, itemName: 'Training Room A', vendorName: 'Algiers Incubator', city: 'Algiers', unit: 'DAY', quantity: 2, startsAt: '2026-07-01T09:00:00.000Z', endsAt: '2026-07-02T17:00:00.000Z', totalAmount: 24000, status: 'CONFIRMED', clientReference: 'ref-1', transactionId: null, paymentMethod: 'manual', clientName: 'Ahmed Benali', clientEmail: 'ahmed@x.com', clientPhone: '0555', clientIdNumber: 'ID-42', createdAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-01T10:00:00.000Z' } as never,
      { id: PROGRAM_BOOKING, userId: null, source: 'offline', itemKind: 'PROGRAM', itemId: 'prog-x', itemName: 'Bootcamp', vendorName: 'Algiers Incubator', city: 'Algiers', unit: 'MONTH', quantity: 1, startsAt: '2026-07-01T09:00:00.000Z', endsAt: '2026-08-01T09:00:00.000Z', totalAmount: 10000, status: 'CONFIRMED', clientReference: 'ref-2', transactionId: null, paymentMethod: 'manual', createdAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-01T10:00:00.000Z' } as never,
    ];
    d.contractTemplates = [
      { id: TPL_TRAINING, incubatorId: 'inc-1', name: 'Training room contract', spaceCategory: 'TRAINING_ROOM', body: 'Client {{client_name}} for {{space_name}}.', language: 'en', createdAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-01T10:00:00.000Z' },
      { id: TPL_ANY, incubatorId: 'inc-1', name: 'Generic contract', spaceCategory: 'ANY', body: 'Generic for {{space_category}}.', language: 'en', createdAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-01T10:00:00.000Z' },
      { id: TPL_OTHER_INC, incubatorId: 'inc-2', name: 'Foreign', spaceCategory: 'ANY', body: 'x', language: 'en', createdAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-01T10:00:00.000Z' },
    ];
  });
});

/* ─────────────────── pure engine ─────────────────── */

describe('renderTemplate', () => {
  it('substitutes whitelisted tokens and blanks unknown ones (never crashes)', () => {
    const out = renderTemplate('Hi {{client_name}}, junk {{not_a_token}} price {{price}}', {
      client_name: 'Bob', price: '100 DZD',
    });
    expect(out).toBe('Hi Bob, junk  price 100 DZD');
    expect(out).not.toContain('{{');
  });

  it('tolerates whitespace inside braces and missing values', () => {
    expect(renderTemplate('{{ client_name }} / {{client_email}}', { client_name: 'A' })).toBe('A / ');
  });
});

describe('resolveContractVariables', () => {
  it('pulls values from booking + space + incubator without re-entry', async () => {
    const data = await db.read();
    const booking = data.bookings.find((b) => b.id === SPACE_BOOKING)!;
    const space = data.spaces.find((s) => s.id === SPACE_ID)!;
    const incubator = data.incubators.find((i) => i.id === 'inc-1')!;
    const values = resolveContractVariables({ booking, space, incubator, user: null, lang: 'en', contractNumber: 'CT-1' });

    expect(values.client_name).toBe('Ahmed Benali');
    expect(values.client_id_number).toBe('ID-42');
    expect(values.space_name).toBe('Training Room A');
    expect(values.space_category).toBe('Training room');
    expect(values.duration).toBe('2 day(s)');
    expect(values.incubator_cr).toBe('RC-123');     // from commercialRegNumber
    expect(values.incubator_nif).toBe('NIF-999');
    expect(values.contract_number).toBe('CT-1');
    expect(values.price).toContain('DZD');
    // Offline booking (no platform user) → no client city available.
    expect(values.client_city).toBe('');
    // Online booking → client city comes from the resolved user.
    const online = resolveContractVariables({ booking, space, incubator, user: { city: 'Oran' } as never, lang: 'en', contractNumber: 'CT-1' });
    expect(online.client_city).toBe('Oran');
  });
});

describe('generateContractNumber', () => {
  it('is deterministic per booking and unique across bookings', () => {
    const inc = { id: 'inc-1', name: 'Algiers Incubator' };
    const a1 = generateContractNumber(inc, { id: SPACE_BOOKING });
    const a2 = generateContractNumber(inc, { id: SPACE_BOOKING });
    const b = generateContractNumber(inc, { id: PROGRAM_BOOKING });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1.startsWith('CT-ALGI-')).toBe(true);
  });
});

describe('templateAppliesToCategory', () => {
  it('matches category or ANY/undefined wildcard', () => {
    expect(templateAppliesToCategory({ spaceCategory: 'TRAINING_ROOM' }, 'TRAINING_ROOM')).toBe(true);
    expect(templateAppliesToCategory({ spaceCategory: 'TRAINING_ROOM' }, 'COWORKING')).toBe(false);
    expect(templateAppliesToCategory({ spaceCategory: 'ANY' }, 'COWORKING')).toBe(true);
    expect(templateAppliesToCategory({ spaceCategory: undefined }, null)).toBe(true);
  });
});

describe('CONTRACT_VARIABLES catalogue', () => {
  it('lists every documented token', () => {
    expect(CONTRACT_VARIABLES.map((v) => v.token)).toContain('contract_number');
    expect(CONTRACT_VARIABLES.map((v) => v.token)).toContain('client_city');
    expect(CONTRACT_VARIABLES.length).toBe(21);
  });
});

/* ─────────────────── CRUD ownership ─────────────────── */

describe('contracts CRUD', () => {
  it('GET lists only the calling incubator templates', async () => {
    const { GET } = await import('@/app/api/incubator/contracts/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((c: { id: string }) => c.id);
    expect(ids).toContain(TPL_TRAINING);
    expect(ids).toContain(TPL_ANY);
    expect(ids).not.toContain(TPL_OTHER_INC);  // owned by inc-2
  });

  it('POST creates a template owned by the incubator', async () => {
    const { POST } = await import('@/app/api/incubator/contracts/route');
    const req = new NextRequest('http://localhost/api/incubator/contracts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New', body: 'Hello {{client_name}}', language: 'fr', spaceCategory: 'COWORKING' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const { template } = await res.json();
    expect(template.incubatorId).toBe('inc-1');
    expect(template.spaceCategory).toBe('COWORKING');
  });

  it('PATCH/DELETE cannot touch another incubator template (404)', async () => {
    const mod = await import('@/app/api/incubator/contracts/[id]/route');
    const ctx = { params: Promise.resolve({ id: TPL_OTHER_INC }) };
    const patch = await mod.PATCH(new NextRequest('http://localhost/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'hacked' }) }), ctx);
    expect(patch.status).toBe(404);
    const del = await mod.DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), ctx);
    expect(del.status).toBe(404);
    // The foreign template is untouched.
    expect((await db.read()).contractTemplates.find((c) => c.id === TPL_OTHER_INC)?.name).toBe('Foreign');
  });
});

/* ─────────────────── generation endpoint ─────────────────── */

describe('GET booking contract', () => {
  const route = () => import('@/app/api/incubator/bookings/[id]/contract/route');
  const reqFor = (id: string, templateId?: string) =>
    new NextRequest(`http://localhost/api/incubator/bookings/${id}/contract${templateId ? `?templateId=${templateId}` : ''}`);

  it('rejects a PROGRAM booking with 400', async () => {
    const { GET } = await route();
    const res = await GET(reqFor(PROGRAM_BOOKING, TPL_ANY), { params: Promise.resolve({ id: PROGRAM_BOOKING }) });
    expect(res.status).toBe(400);
  });

  it('requires a templateId', async () => {
    const { GET } = await route();
    const res = await GET(reqFor(SPACE_BOOKING), { params: Promise.resolve({ id: SPACE_BOOKING }) });
    expect(res.status).toBe(400);
  });

  it("rejects another incubator's template with 404", async () => {
    const { GET } = await route();
    const res = await GET(reqFor(SPACE_BOOKING, TPL_OTHER_INC), { params: Promise.resolve({ id: SPACE_BOOKING }) });
    expect(res.status).toBe(404);
  });

  it('generates a PDF for a valid SPACE booking + owned template', async () => {
    const { GET } = await route();
    const res = await GET(reqFor(SPACE_BOOKING, TPL_TRAINING), { params: Promise.resolve({ id: SPACE_BOOKING }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
