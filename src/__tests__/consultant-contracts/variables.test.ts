/**
 * Unit tests for the consultant contract template engine
 * (src/server/consultant-contracts/variables.ts).
 *
 * Pins the properties the whole "paste your own template" feature depends on:
 *   • every documented token resolves to the expected value,
 *   • an unknown or mistyped token renders blank rather than throwing,
 *   • a token from the OTHER contract engine (space-booking) is rejected too
 *     — the two whitelists must never cross-pollinate,
 *   • payout method inference matches the consultant's own account type,
 *   • the payout description masks everything but the last 4 digits.
 */
import { describe, it, expect } from 'vitest';
import {
  CONSULTANT_CONTRACT_VARIABLES,
  describePayoutAccount,
  inferPayoutMethod,
  renderConsultantContractTemplate,
  resolveConsultantContractVariables,
  splitAtSignatureMarker,
  stripSignatureMarker,
} from '@/server/consultant-contracts/variables';
import type { MentorRecord } from '@/server/consultant-contracts/types';

const MENTOR: Pick<
  MentorRecord,
  'fullName' | 'phone' | 'email' | 'position' | 'address' | 'city' | 'idNumber'
> = {
  fullName: 'Yasmine Belkacem',
  phone: '+213770112233',
  email: 'yasmine@example.dz',
  position: 'Expert-comptable',
  address: '12 Rue Didouche Mourad, Alger Centre',
  city: 'Alger',
  idNumber: '109412345678',
};

describe('resolveConsultantContractVariables', () => {
  it('resolves every consultant-side token from the mentor record', () => {
    const values = resolveConsultantContractVariables({
      mentor: MENTOR,
      commissionRate: 0.2,
      payoutMethod: 'BANK_TRANSFER',
      payoutDetails: 'RIB ••••7890 — Yasmine Belkacem',
      metwork: null,
    });

    expect(values.consultant_name).toBe('Yasmine Belkacem');
    expect(values.consultant_phone).toBe('+213770112233');
    expect(values.consultant_email).toBe('yasmine@example.dz');
    expect(values.consultant_position).toBe('Expert-comptable');
    expect(values.commission_rate).toBe('20 %');
    expect(values.consultant_share).toBe('80 %');
    expect(values.payout_method).toBe('Virement bancaire');
    expect(values.payout_details).toBe('RIB ••••7890 — Yasmine Belkacem');
  });

  it('formats rates without floating-point noise', () => {
    const values = resolveConsultantContractVariables({
      mentor: MENTOR,
      commissionRate: 0.3,
      payoutMethod: 'CCP',
      payoutDetails: null,
      metwork: null,
    });
    expect(values.commission_rate).toBe('30 %');
    expect(values.consultant_share).toBe('70 %');
    expect(values.payout_method).toBe('Virement CCP (Algérie Poste)');
  });

  it('renders CHEQUE with no payout details as an empty token', () => {
    const values = resolveConsultantContractVariables({
      mentor: MENTOR,
      commissionRate: 0.2,
      payoutMethod: 'CHEQUE',
      payoutDetails: null,
      metwork: null,
    });
    expect(values.payout_method).toBe('Chèque');
    expect(values.payout_details).toBe('');
  });

  it('resolves metwork_* tokens when a party is given, blank when not', () => {
    const withParty = resolveConsultantContractVariables({
      mentor: MENTOR,
      commissionRate: 0.2,
      payoutMethod: 'BANK_TRANSFER',
      payoutDetails: null,
      metwork: { name: 'EURL METWORK', address: '12 rue, Oran', commercialRegNumber: '31/00-1234567 B 24', nif: '002431012345678' },
    });
    expect(withParty.metwork_name).toBe('EURL METWORK');
    expect(withParty.metwork_address).toBe('12 rue, Oran');
    expect(withParty.metwork_rc).toBe('31/00-1234567 B 24');
    expect(withParty.metwork_nif).toBe('002431012345678');

    const withoutParty = resolveConsultantContractVariables({
      mentor: MENTOR,
      commissionRate: 0.2,
      payoutMethod: 'BANK_TRANSFER',
      payoutDetails: null,
      metwork: null,
    });
    expect(withoutParty.metwork_name).toBe('');
    expect(withoutParty.metwork_rc).toBe('');
  });

  it('falls back to empty strings for a consultant with no phone or email on file', () => {
    const values = resolveConsultantContractVariables({
      mentor: { fullName: 'Karim Haddad', phone: undefined, email: undefined, position: 'Consultant' },
      commissionRate: 0.2,
      payoutMethod: 'BANK_TRANSFER',
      payoutDetails: null,
      metwork: null,
    });
    expect(values.consultant_phone).toBe('');
    expect(values.consultant_email).toBe('');
  });
});

describe('renderConsultantContractTemplate', () => {
  it('substitutes every whitelisted token', () => {
    const values = resolveConsultantContractVariables({
      mentor: MENTOR,
      commissionRate: 0.2,
      payoutMethod: 'BANK_TRANSFER',
      payoutDetails: 'RIB ••••7890',
      metwork: { name: 'EURL METWORK', address: null, commercialRegNumber: null, nif: null },
    });
    const rendered = renderConsultantContractTemplate(
      '{{consultant_name}} signe avec {{metwork_name}} pour {{commission_rate}}, réglé par {{payout_method}} ({{payout_details}}).',
      values,
    );
    expect(rendered).toBe(
      'Yasmine Belkacem signe avec EURL METWORK pour 20 %, réglé par Virement bancaire (RIB ••••7890).',
    );
  });

  it('renders an unknown or mistyped token as empty rather than throwing', () => {
    const rendered = renderConsultantContractTemplate(
      'Bonjour {{consultant_name}}, réf {{consultant_naem}}, code {{totally_made_up}}.',
      { consultant_name: 'Yasmine Belkacem' },
    );
    expect(rendered).toBe('Bonjour Yasmine Belkacem, réf , code .');
  });

  it('rejects a token that belongs to the OTHER contract engine (space-booking)', () => {
    // {{client_name}} / {{incubator_nif}} are real tokens — just not THIS
    // engine's. The two whitelists must never cross-pollinate.
    const rendered = renderConsultantContractTemplate(
      '{{client_name}} / {{incubator_nif}} / {{consultant_name}}',
      { client_name: 'Should not leak', incubator_nif: '999', consultant_name: 'Yasmine Belkacem' },
    );
    expect(rendered).toBe(' /  / Yasmine Belkacem');
  });

  it('is a no-op on a template with no tokens at all', () => {
    expect(renderConsultantContractTemplate('Plain text, no tokens.', {})).toBe('Plain text, no tokens.');
  });

  it('leaves malformed braces untouched', () => {
    expect(renderConsultantContractTemplate('{consultant_name} and {{ }} and {{}}', { consultant_name: 'X' })).toBe(
      '{consultant_name} and {{ }} and {{}}',
    );
  });
});

describe('CONSULTANT_CONTRACT_VARIABLES catalogue', () => {
  it('lists every token renderConsultantContractTemplate actually accepts', () => {
    const probe: Record<string, string> = {};
    for (const token of CONSULTANT_CONTRACT_VARIABLES) probe[token] = `<${token}>`;

    const template = CONSULTANT_CONTRACT_VARIABLES.map((t) => `{{${t}}}`).join(' ');
    const rendered = renderConsultantContractTemplate(template, probe);

    // Every token in the catalogue must resolve to its own probe value —
    // none can be silently unknown to the renderer.
    for (const token of CONSULTANT_CONTRACT_VARIABLES) {
      expect(rendered).toContain(`<${token}>`);
    }
  });
});

describe('inferPayoutMethod', () => {
  it('infers CCP from a ccp account', () => {
    expect(inferPayoutMethod({ payoutAccount: { accountType: 'ccp', accountNumber: '123', holderName: 'X' } })).toBe('CCP');
  });

  it('defaults to BANK_TRANSFER for a bank account or no account at all', () => {
    expect(inferPayoutMethod({ payoutAccount: { accountType: 'bank', accountNumber: '123', holderName: 'X' } })).toBe('BANK_TRANSFER');
    expect(inferPayoutMethod({ payoutAccount: null })).toBe('BANK_TRANSFER');
    expect(inferPayoutMethod({ payoutAccount: undefined })).toBe('BANK_TRANSFER');
  });
});

describe('describePayoutAccount', () => {
  it('masks all but the last 4 digits and labels RIB vs CCP', () => {
    expect(describePayoutAccount({ payoutAccount: { accountType: 'bank', accountNumber: '00799999001234567890', holderName: 'Yasmine Belkacem' } }))
      .toBe('RIB ••••••••••••••••7890 — Yasmine Belkacem');
    expect(describePayoutAccount({ payoutAccount: { accountType: 'ccp', accountNumber: '1234567890', holderName: 'Karim Haddad' } }))
      .toBe('CCP ••••••7890 — Karim Haddad');
  });

  it('returns null when there is no account on file', () => {
    expect(describePayoutAccount({ payoutAccount: null })).toBeNull();
    expect(describePayoutAccount({ payoutAccount: undefined })).toBeNull();
  });
});

/* ───────────── Contract identity: address / city / ID number ───────────── */

describe('consultant identity tokens', () => {
  const resolve = (m: Partial<typeof MENTOR>) =>
    resolveConsultantContractVariables({
      mentor: { ...MENTOR, ...m },
      commissionRate: 0.2,
      payoutMethod: 'BANK_TRANSFER',
      payoutDetails: null,
      metwork: null,
    });

  it('resolves the full legal address, city and ID number', () => {
    const v = resolve({});
    expect(v.consultant_address).toBe('12 Rue Didouche Mourad, Alger Centre');
    expect(v.consultant_city).toBe('Alger');
    expect(v.consultant_id_number).toBe('109412345678');
  });

  it('renders them into a template body', () => {
    const body = renderConsultantContractTemplate(
      'Demeurant à {{consultant_address}}, pièce n° {{consultant_id_number}}. Fait à {{consultant_city}}.',
      resolve({}),
    );
    expect(body).toBe(
      'Demeurant à 12 Rue Didouche Mourad, Alger Centre, pièce n° 109412345678. Fait à Alger.',
    );
  });

  it('renders blank — never "undefined" — when the consultant has not filled them in', () => {
    const v = resolve({ address: null, city: null, idNumber: null });
    expect(v.consultant_address).toBe('');
    expect(v.consultant_city).toBe('');
    expect(v.consultant_id_number).toBe('');
    // The blocking gate lives in createDraftContract; the ENGINE must still
    // degrade to blanks rather than printing the string "undefined".
    expect(renderConsultantContractTemplate('[{{consultant_id_number}}]', v)).toBe('[]');
  });

  it('exposes all three in the catalogue the admin editor lists', () => {
    expect(CONSULTANT_CONTRACT_VARIABLES).toContain('consultant_address');
    expect(CONSULTANT_CONTRACT_VARIABLES).toContain('consultant_city');
    expect(CONSULTANT_CONTRACT_VARIABLES).toContain('consultant_id_number');
  });
});

/* ───────────────── Signature-block placement marker ───────────────── */

describe('signature block marker', () => {
  it('survives the token merge — it is a layout instruction, not a value', () => {
    const merged = renderConsultantContractTemplate(
      'Corps.\n{{signature_block}}\nAnnexe {{consultant_city}}.',
      resolveConsultantContractVariables({
        mentor: MENTOR,
        commissionRate: 0.2,
        payoutMethod: 'BANK_TRANSFER',
        payoutDetails: null,
        metwork: null,
      }),
    );
    expect(merged).toContain('{{signature_block}}');
    expect(merged).toContain('Annexe Alger.');
  });

  it('splits a body into before/after at the marker', () => {
    const [before, after] = splitAtSignatureMarker('Les clauses.\n\n{{signature_block}}\n\nANNEXE A');
    expect(before).toBe('Les clauses.');
    expect(after).toBe('ANNEXE A');
  });

  it('treats a body with no marker as all-before, so the block appends at the end', () => {
    const [before, after] = splitAtSignatureMarker('Tout le contrat.');
    expect(before).toBe('Tout le contrat.');
    expect(after).toBe('');
  });

  it('honours only the FIRST marker and strips any others', () => {
    const [before, after] = splitAtSignatureMarker('A{{signature_block}}B{{signature_block}}C');
    expect(before).toBe('A');
    expect(after).toBe('BC');
    expect(after).not.toContain('signature_block');
  });

  it('tolerates inner whitespace', () => {
    const [before, after] = splitAtSignatureMarker('A{{  signature_block  }}B');
    expect(before).toBe('A');
    expect(after).toBe('B');
  });

  it('strips the marker for on-screen preview so a reader never sees it', () => {
    expect(stripSignatureMarker('Clauses.\n{{signature_block}}\nFin.')).toBe('Clauses.\n\nFin.');
    expect(stripSignatureMarker('No marker here.')).toBe('No marker here.');
  });
});
