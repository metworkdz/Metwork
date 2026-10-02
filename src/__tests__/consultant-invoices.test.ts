/**
 * Consultant-issued documents.
 *
 * The things worth pinning are the ones a second owner can break: the two
 * client books and document lists must not leak into each other, the two
 * numbering sequences must be independent, and the legal gate must ask an
 * auto-entrepreneur for the right number under the right label. The money math
 * itself is unchanged and already covered by invoice-engine / invoice-kinds.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type IncubatorRecord, type MentorRecord } from '@/server/db/store';
import { issueInvoice } from '@/server/invoices/issue';
import { createClient, listClients, searchClients } from '@/server/invoices/clients';
import {
  findIssuer,
  invoicesFor,
  issuerLegalGate,
  REG_LABEL_AUTO_ENTREPRENEUR,
  REG_LABEL_REGISTRE_COMMERCE,
  type InvoiceOwner,
} from '@/server/invoices/owner';
import { buildInvoiceViewModel } from '@/server/invoices/pdf/viewModel';

const MENTOR_ID = 'mentor-inv-1';
const INC_ID = 'inc-inv-1';

const CONSULTANT: InvoiceOwner = { type: 'CONSULTANT', id: MENTOR_ID };
const INCUBATOR: InvoiceOwner = { type: 'INCUBATOR', id: INC_ID };

const LINES = [{ designation: 'Accompagnement stratégique', quantity: 2, unitPriceHt: 10_000 }];

function mentor(over: Partial<MentorRecord> = {}): MentorRecord {
  return {
    id: MENTOR_ID,
    fullName: 'Mokhtaria Mekki',
    position: 'Consultante',
    imageUrl: '',
    email: 'mokhtaria@example.dz',
    phone: '+213555000111',
    address: '14 Boulevard Emir Abdelkader, Oran',
    approvalStatus: 'APPROVED',
    invoiceLegalStatus: 'AUTO_ENTREPRENEUR',
    invoiceRegNumber: 'AE-31-0045127',
    nif: '002431112519476',
    createdAt: new Date('2026-01-01').toISOString(),
    ...over,
  } as unknown as MentorRecord;
}

/** A consultant on a registre de commerce — personne morale unless told otherwise. */
function rcMentor(over: Partial<MentorRecord> = {}): MentorRecord {
  return mentor({
    invoiceLegalStatus: 'REGISTRE_COMMERCE',
    invoiceRcType: 'PERSONNE_MORALE',
    invoiceRegNumber: '31/00-9988776',
    ai: 'A-1234',
    ...over,
  });
}

function incubator(over: Partial<IncubatorRecord> = {}): IncubatorRecord {
  return {
    id: INC_ID,
    name: 'Metwork',
    email: 'hub@metwork.dz',
    address: 'Oran',
    commercialRegNumber: '24B1125194-31/00',
    nif: '002431112519476',
    createdAt: new Date('2026-01-01').toISOString(),
    ...over,
  } as unknown as IncubatorRecord;
}

async function seed(m: MentorRecord = mentor()): Promise<void> {
  await db.update((d) => {
    d.mentors = [m];
    d.incubators = [incubator()];
    d.clients = [];
    d.invoices = [];
  });
}

beforeEach(() => seed());

/* ─────────────────── Isolation ─────────────────── */

describe('the two books never mix', () => {
  it('keeps clients apart', async () => {
    await createClient(CONSULTANT, { fullName: 'Client du consultant', email: 'a@example.dz' });
    await createClient(INCUBATOR, { fullName: "Client de l'incubateur", email: 'b@example.dz' });

    expect((await listClients(CONSULTANT)).map((c) => c.fullName)).toEqual(['Client du consultant']);
    expect((await listClients(INCUBATOR)).map((c) => c.fullName)).toEqual(["Client de l'incubateur"]);
    // And search cannot reach across either.
    expect(await searchClients(CONSULTANT, 'incubateur')).toEqual([]);
  });

  it('refuses to address a document to the other owner’s client', async () => {
    const theirs = await createClient(INCUBATOR, { fullName: 'Pas à moi', email: 'c@example.dz' });
    const res = await issueInvoice(CONSULTANT, {
      clientId: theirs.id,
      lines: LINES,
      paymentMethod: 'ESPECE',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('CLIENT_NOT_FOUND');
  });

  it('separates on the KIND of owner, not just on the id', async () => {
    // Ids are UUIDs in practice, so a check that compared only ids would pass
    // every other test here by luck. Give both owners the SAME id and the
    // distinction has to be the type.
    const SHARED = 'same-id';
    await db.update((d) => {
      d.mentors = [mentor({ id: SHARED })];
      d.incubators = [incubator({ id: SHARED })];
      d.clients = [];
      d.invoices = [];
    });
    const asConsultant: InvoiceOwner = { type: 'CONSULTANT', id: SHARED };
    const asIncubator: InvoiceOwner = { type: 'INCUBATOR', id: SHARED };

    await createClient(asConsultant, { fullName: 'Chez le consultant', email: 'x@example.dz' });
    expect(await listClients(asIncubator)).toEqual([]);
    expect((await listClients(asConsultant)).map((c) => c.fullName)).toEqual(['Chez le consultant']);
  });

  it('keeps document lists apart', async () => {
    await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    await issueInvoice(INCUBATOR, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });

    const d = await db.read();
    expect(invoicesFor(d, CONSULTANT)).toHaveLength(1);
    expect(invoicesFor(d, INCUBATOR)).toHaveLength(1);
    expect(invoicesFor(d, CONSULTANT)[0]!.mentorId).toBe(MENTOR_ID);
    expect(invoicesFor(d, CONSULTANT)[0]!.incubatorId).toBeUndefined();
  });
});

function draft() {
  return { clientType: 'INDIVIDUAL' as const, name: 'Ahmed Benali' };
}

/* ─────────────────── Numbering ─────────────────── */

describe('numbering', () => {
  it('runs independently for each issuer', async () => {
    const a = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    const b = await issueInvoice(INCUBATOR, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    const c = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });

    expect(a.ok && a.invoice.seq).toBe(1);
    // The incubator's own first document, in the same year — not the second.
    expect(b.ok && b.invoice.seq).toBe(1);
    expect(c.ok && c.invoice.seq).toBe(2);
  });

  it('keeps the three kinds on separate sequences', async () => {
    const f = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    const p = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE', kind: 'PROFORMA' });
    const dv = await issueInvoice(CONSULTANT, {
      clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE', kind: 'DEVIS', validUntil: '2026-12-31',
    });

    expect(f.ok && f.invoice.number).toMatch(/^01\/\d{4}$/);
    expect(p.ok && p.invoice.number).toMatch(/^FP 01\/\d{4}$/);
    expect(dv.ok && dv.invoice.number).toMatch(/^DV 01\/\d{4}$/);
  });

  it('refuses a number this consultant has already used', async () => {
    await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE', seq: 7 });
    const again = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE', seq: 7 });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('NUMBER_TAKEN');
  });

  it('does not see the other issuer’s number as taken', async () => {
    await issueInvoice(INCUBATOR, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE', seq: 7 });
    const mine = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE', seq: 7 });
    expect(mine.ok).toBe(true);
  });
});

/* ─────────────────── Letterhead ─────────────────── */

describe('the legal header', () => {
  it('labels an auto-entrepreneur’s number "Carte AE"', async () => {
    const res = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.invoice.issuerSnapshot.rc).toBe('AE-31-0045127');
    expect(res.invoice.issuerSnapshot.rcLabel).toBe(REG_LABEL_AUTO_ENTREPRENEUR);
    // And it reaches the PDF that way.
    expect(buildInvoiceViewModel(res.invoice).issuerLines.join(' | ')).toContain('Carte AE');
  });

  it('labels a registered consultant’s number "RCN"', async () => {
    await seed(rcMentor());
    const res = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(res.ok && res.invoice.issuerSnapshot.rcLabel).toBe(REG_LABEL_REGISTRE_COMMERCE);
  });

  it('asks an RC holder which kind they are, and for their article d’imposition', async () => {
    // Not cosmetic: the type decides the tax regime, so a document issued
    // without it cannot know what rate it should have offered.
    await seed(mentor({ invoiceLegalStatus: 'REGISTRE_COMMERCE', invoiceRegNumber: '31/00-9988776', ai: 'A-1234' }));
    const noType = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(noType.ok).toBe(false);
    if (!noType.ok) expect(noType.message).toContain('personne physique');

    await seed(rcMentor({ ai: null }));
    const noAi = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(noAi.ok).toBe(false);
    if (!noAi.ok) expect(noAi.message).toContain("article d'imposition");
  });

  it('asks an auto-entrepreneur for neither', async () => {
    // A carte d'auto-entrepreneur carries no article d'imposition, and there
    // is no "type" to choose.
    const res = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(res.ok).toBe(true);
  });

  it('refuses to issue without a registration number or a NIF', async () => {
    await seed(mentor({ invoiceRegNumber: null }));
    const a = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe('ISSUER_LEGAL_INCOMPLETE');

    await seed(mentor({ nif: null }));
    const b = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(b.ok).toBe(false);
  });

  it('refuses a transfer invoice with no RIB, and accepts one with', async () => {
    const without = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'VIREMENT' });
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.code).toBe('ISSUER_BANK_INCOMPLETE');

    await seed(mentor({ bankName: 'BNA', bankRib: '00400123456789012345' }));
    const withRib = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'VIREMENT' });
    expect(withRib.ok).toBe(true);
    if (withRib.ok) expect(withRib.invoice.issuerSnapshot.bankRib).toBe('00400123456789012345');
  });

  it('never borrows Metwork’s logo or stamp', async () => {
    // No fallback, by design: the platform's mark on a document between a
    // consultant and their own client would misstate who issued it.
    const res = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(res.ok && res.invoice.issuerSnapshot.logoUrl).toBeNull();
    expect(res.ok && res.invoice.issuerSnapshot.stampUrl).toBeNull();
  });
});

/* ─────────────────── VAT ─────────────────── */

describe('VAT', () => {
  it('defaults an auto-entrepreneur to 0 and omits the TVA line', async () => {
    const res = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.invoice.vatRate).toBe(0);
    expect(res.invoice.totals.tva).toBe(0);
    expect(res.invoice.totals.ttc).toBe(res.invoice.totals.ht);
    // ABSENT, not "0,00": a zero line asserts VAT was charged and came to nothing.
    expect(buildInvoiceViewModel(res.invoice).showVat).toBe(false);
  });

  it('defaults a personne morale to 19 and shows the line', async () => {
    await seed(rcMentor());
    const res = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(res.ok && res.invoice.vatRate).toBe(19);
    expect(res.ok && buildInvoiceViewModel(res.invoice).showVat).toBe(true);
  });

  it('defaults a personne physique to 0 — an RC is not the same as au réel', async () => {
    // The correction that prompted this: a personne physique is under the IFU
    // exactly like an auto-entrepreneur, and charges no VAT.
    await seed(rcMentor({ invoiceRcType: 'PERSONNE_PHYSIQUE' }));
    const res = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    expect(res.ok && res.invoice.vatRate).toBe(0);
    expect(res.ok && buildInvoiceViewModel(res.invoice).showVat).toBe(false);
    // Still an RC header, with its article d'imposition.
    expect(res.ok && res.invoice.issuerSnapshot.rcLabel).toBe(REG_LABEL_REGISTRE_COMMERCE);
    expect(res.ok && res.invoice.issuerSnapshot.ai).toBe('A-1234');
  });

  it('lets a personne physique au réel charge VAT on the document', async () => {
    await seed(rcMentor({ invoiceRcType: 'PERSONNE_PHYSIQUE' }));
    const res = await issueInvoice(CONSULTANT, {
      clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE', vatRate: 19,
    });
    expect(res.ok && res.invoice.totals.tva).toBe(3800);
  });

  it('lets an auto-entrepreneur who is assujetti charge VAT anyway', async () => {
    const res = await issueInvoice(CONSULTANT, {
      clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE', vatRate: 19,
    });
    expect(res.ok && res.invoice.totals.tva).toBe(3800);
  });

  it('still applies the stamp duty on a cash invoice', async () => {
    const res = await issueInvoice(CONSULTANT, { clientDraft: draft(), lines: LINES, paymentMethod: 'ESPECE' });
    // 20 000 TTC ≤ 30 000 → 1 %.
    expect(res.ok && res.invoice.totals.timbre).toBe(200);
  });
});

/* ─────────────────── Issuer resolution ─────────────────── */

describe('findIssuer', () => {
  it('reads the consultant’s own contact details, not the platform’s', async () => {
    const issuer = findIssuer(await db.read(), CONSULTANT);
    expect(issuer?.profile.name).toBe('Mokhtaria Mekki');
    expect(issuer?.profile.contactEmail).toBe('mokhtaria@example.dz');
    expect(issuer?.profile.address).toContain('Oran');
  });

  it('answers nothing for an owner that does not exist', async () => {
    expect(findIssuer(await db.read(), { type: 'CONSULTANT', id: 'nope' })).toBeNull();
    expect(
      issuerLegalGate(
        { name: '', address: null, reg: null, regLabel: 'RCN', rcType: null, nif: null, nis: null, ai: null,
          logoUrl: null, stampUrl: null, website: null, contactEmail: null, contactPhone: null,
          bankName: null, bankRib: null, defaultVatRate: 0, invoiceTemplate: 'CLASSIC' },
        'ESPECE',
        CONSULTANT,
      ).ok,
    ).toBe(false);
  });
});
