/**
 * Metwork 2.0 phase 5 — the copilot knowledge base (chunking, search),
 * citation mapping, and the ask flow (quota, off-topic, cited answer) with
 * the Anthropic SDK mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db/store';
import { buildSearchIndex, chunkPages, describeDocument, search, tokenize, upsertDocument, type KbIndex } from '@/server/copilot/kb';
import { resetKbCacheForTests } from '@/server/copilot/kb-store';

const sdk = vi.hoisted(() => ({ create: vi.fn(), finalMessage: vi.fn() }));

vi.mock('@/lib/env', () => ({ serverEnvVars: { ANTHROPIC_API_KEY: 'test-key' } }));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error { status = 500; }
  class Anthropic {
    static APIError = APIError;
    beta = {
      messages: {
        create: sdk.create,
        stream: () => ({ on: () => undefined, finalMessage: sdk.finalMessage }),
      },
    };
  }
  return { default: Anthropic };
});

const { askCopilot, foldCitations, quotaFor } = await import('@/server/copilot/service');

const T0 = '2026-01-01T10:00:00.000Z';

function user(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: 'Amine Kaci', phone: '+213550000001', city: 'alger', role: 'FREELANCER', status: 'ACTIVE',
    passwordHash: 'x', phoneVerified: true, emailVerified: true, membershipCode: null, membershipTier: 'EXPLORER',
    avatarUrl: null, locale: 'fr', createdAt: T0, updatedAt: T0, ...extra,
  } as never;
}

const CIDTA = [
  'Code des impôts directs\nTitre III\nArt. 282 ter – Sont soumis au régime de l’IFU les personnes physiques dont le chiffre d’affaires annuel n’excède pas 8.000.000 DA.',
  'Art. 282sexies – Le taux de l\'impôt forfaitaire unique est fixé comme suit : 5% pour la production et vente de biens, 12% pour les autres activités, 0,5% pour les auto-entrepreneurs.\nArt. 282 septies. — Le montant de l’impôt ne peut être inférieur à 10.000 DA pour les auto-entrepreneurs.',
];
const LF2018 = ['Art. 12. — Le taux de l’impôt forfaitaire unique est fixé à 5% pour les auto-entrepreneurs et toutes activités confondues.'];

function kbIndex(): KbIndex {
  let idx: KbIndex = { version: 1, builtAt: T0, documents: [], chunks: [] };
  for (const [path, pages] of [['2026/Code_des_Impôts_Directs_2026_fr.pdf', CIDTA], ['Lois de Finance/Loi de finance 2018 bis.pdf', LF2018]] as const) {
    const meta = describeDocument(path);
    const chunks = chunkPages(meta.id, [...pages]);
    idx = upsertDocument(idx, { ...meta, pages: pages.length, chunks: chunks.length, origin: 'SYNC', addedAt: T0, sha256: 'x' }, chunks);
  }
  return idx;
}

beforeEach(async () => {
  sdk.create.mockReset();
  sdk.finalMessage.mockReset();
  resetKbCacheForTests(kbIndex());
  await db.update((d) => {
    d.users = [user('fl-1')];
    d.copilotUsage = [];
    d.freelancerProfiles = [];
    d.ventures = [];
    d.userMemberships = [];
  });
});

describe('knowledge base', () => {
  it('describes documents from their path', () => {
    expect(describeDocument('2026/Code_de_Timbre_2026_fr.pdf')).toMatchObject({ category: 'CODE', year: 2026, title: 'Code de Timbre 2026 fr' });
    expect(describeDocument('Lois de Finance/Loi de finance 2024.pdf')).toMatchObject({ category: 'FINANCE_LAW', year: 2024 });
    expect(describeDocument('Formulaires de déclaration/GN° 12 Bis définitive - 2025.pdf').category).toBe('FORM');
    expect(describeDocument('Code de commerce/Livre 1.pdf')).toMatchObject({ category: 'COMMERCE', year: null });
  });

  it('cuts on articles and keeps the page and article of each chunk', () => {
    const chunks = chunkPages('cidta', CIDTA);
    const sexies = chunks.find((c) => c.text.startsWith('Art. 282sexies'))!;
    expect(sexies.page).toBe(2);
    expect(sexies.article).toBe('Art. 282sexies');
    // The heading before the first article is merged, not a chunk of its own.
    expect(chunks[0]!.text).toContain('Art. 282 ter');
    expect(chunks.every((c) => c.id.startsWith('cidta#'))).toBe(true);
  });

  it('matches "282 sexies" with "282sexies" and accents loosely', () => {
    expect(tokenize('Art. 282sexies')).toEqual(tokenize('art 282 sexies'));
    expect(tokenize('Impôt forfaitaire')).toEqual(tokenize('impot FORFAITAIRE'));
  });

  it('ranks the article in force first', () => {
    const idx = buildSearchIndex(kbIndex());
    const [top] = search(idx, 'taux impôt forfaitaire unique auto-entrepreneur', 3);
    expect(top!.doc.year).toBe(2026);
    expect(top!.chunk.article).toBe('Art. 282sexies');
  });
});

describe('citations', () => {
  it('numbers sources in order of first use and keeps the quotes', () => {
    const idx = buildSearchIndex(kbIndex());
    const passages = search(idx, 'taux impôt forfaitaire minimum auto-entrepreneur', 4).map(({ chunk, doc }) => ({ chunk, doc }));
    const cite = (i: number, text: string) => ({ type: 'search_result_location', search_result_index: i, cited_text: text, source: passages[i]!.chunk.id, title: '', start_block_index: 0, end_block_index: 1 });
    const answer = foldCitations([
      { type: 'text', text: 'Le taux est de 0,5 %', citations: [cite(0, 'quote A')] },
      { type: 'text', text: ', avec un minimum.', citations: null },
      { type: 'text', text: ' Minimum 10 000 DA', citations: [cite(1, 'quote B'), cite(0, 'quote A')] },
    ] as never, passages);
    expect(answer.sources.map((s) => s.n)).toEqual([1, 2]);
    expect(answer.sources[0]!.quotes).toEqual(['quote A']);
    expect(answer.segments.map((s) => s.sources)).toEqual([[1], [], [2, 1]]);
  });
});

describe('ask', () => {
  it('answers from the passages and counts the question', async () => {
    sdk.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"queries":["taux impôt forfaitaire unique auto-entrepreneur"]}' }] });
    sdk.finalMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '0,5 %', citations: [{ type: 'search_result_location', search_result_index: 0, cited_text: 'x', source: 's', title: 't', start_block_index: 0, end_block_index: 1 }] }],
    });
    const r = await askCopilot({ userId: 'fl-1', question: 'ما هي نسبة الضريبة؟', history: [], lang: 'ar' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.answer.sources[0]!.article).toBe('Art. 282sexies');
      expect(r.quota).toEqual({ limit: 15, used: 1, remaining: 14 });
    }
  });

  it('refuses off-topic questions without spending one', async () => {
    sdk.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"queries":[]}' }] });
    expect(await askCopilot({ userId: 'fl-1', question: 'Write me a poem', history: [], lang: 'en' })).toEqual({ ok: false, reason: 'OFF_TOPIC' });
    const d = await db.read();
    expect(quotaFor(d, d.users[0]!).used).toBe(0);
    expect(sdk.finalMessage).not.toHaveBeenCalled();
  });

  it('stops at the Free monthly limit, unlimited on Premium', async () => {
    const month = new Date().toISOString().slice(0, 7);
    await db.update((d) => { d.copilotUsage = [{ userId: 'fl-1', month, questions: 15, updatedAt: T0 }]; });
    expect(await askCopilot({ userId: 'fl-1', question: 'Taux IFU ?', history: [], lang: 'fr' })).toEqual({ ok: false, reason: 'QUOTA_EXCEEDED' });
    expect(sdk.create).not.toHaveBeenCalled();
    await db.update((d) => {
      Object.assign(d.users[0]!, { membershipCode: 'FREELANCER_PREMIUM', membershipTier: 'FOUNDER', membershipExpiresAt: '2030-01-01T00:00:00.000Z' });
    });
    const d = await db.read();
    expect(quotaFor(d, d.users[0]!)).toEqual({ limit: null, used: 15, remaining: null });
  });
});
