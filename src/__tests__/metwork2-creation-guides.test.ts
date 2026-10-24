/**
 * Metwork 2.0 phase C2 — business-creation guides: the chooser's advice,
 * the step lists, progress storage and its API, the guide passages the
 * copilot answers from, and the translations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import en from '@/i18n/messages/en.json';
import fr from '@/i18n/messages/fr.json';
import ar from '@/i18n/messages/ar.json';

let actor: { id: string; role: string } | null = null;
vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async (roles: string[]) => actor && roles.includes(actor.role)
    ? { ok: true, user: actor }
    : { ok: false, response: new Response('forbidden', { status: 403 }) }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimitDistributed: vi.fn(async () => true) }));

import { db } from '@/server/db/store';
import { GUIDE_IDS, GUIDE_STEPS, STEP_IDS, nextStep, recommend, stepsOf } from '@/lib/creation-guides';
import { guideProgressLine, guideProgressOf, saveGuideProgress } from '@/server/copilot/guides';
import { guideIndex } from '@/server/copilot/guide-kb';
import { search } from '@/server/copilot/kb';
import { GET, PUT, DELETE } from '@/app/api/copilot/guide/route';

const put = (body: unknown) => PUT(new Request('http://x/api/copilot/guide', { method: 'PUT', body: JSON.stringify(body) }) as never);

beforeEach(async () => {
  actor = { id: 'fl-1', role: 'FREELANCER' };
  await db.update((d) => { d.guideProgress = []; });
});

describe('chooser', () => {
  it('follows Metwork’s advice', () => {
    expect(recommend({ offer: 'PRODUCTS', partners: 'PARTNERS', capital: 'SMALL' }).guide).toBe('SARL');
    expect(recommend({ offer: 'SERVICES', partners: 'PARTNERS', capital: 'LARGE' }).guide).toBe('SARL');
    expect(recommend({ offer: 'PRODUCTS', partners: 'ALONE', capital: 'LARGE' }).guide).toBe('EURL');
    expect(recommend({ offer: 'SERVICES', partners: 'ALONE', capital: 'SMALL' }).guide).toBe('AE');
    expect(recommend({ offer: 'SERVICES', partners: 'ALONE', capital: 'MEDIUM' }).guide).toBe('AE');
    expect(recommend({ offer: 'PRODUCTS', partners: 'ALONE', capital: 'SMALL' }).guide).toBe('PP');
    expect(recommend({ offer: 'PRODUCTS', partners: 'ALONE', capital: 'MEDIUM' }).guide).toBe('PP');
  });
});

describe('steps', () => {
  it('drops the statuts and the NIS for a personne physique, keeps fees and cachet', () => {
    expect(GUIDE_STEPS.SARL).toHaveLength(10);
    expect(GUIDE_STEPS.PP).not.toContain('statuts');
    expect(GUIDE_STEPS.PP).not.toContain('nis');
    expect(GUIDE_STEPS.PP).toEqual(expect.arrayContaining(['quittance', 'cachet', 'existence']));
    expect(GUIDE_STEPS.AE).toEqual(['anaeAccount', 'aeCard', 'aeNif', 'aeCasnos']);
  });

  it('offers the G08 form, and the file is shipped', () => {
    const existence = stepsOf('SARL').find((s) => s.id === 'existence')!;
    expect(existence.download?.href).toBe('/forms/g08.pdf');
    expect(existsSync(join(process.cwd(), 'public/forms/g08.pdf'))).toBe(true);
  });

  it('links only to official https sites', () => {
    for (const g of GUIDE_IDS) for (const s of stepsOf(g)) for (const l of s.links) expect(l.href).toMatch(/^https:\/\/[a-z.]+\.dz\//);
  });

  it('has every step and guide translated in fr, en and ar', () => {
    for (const m of [fr, en, ar]) {
      for (const id of STEP_IDS) {
        const s = (m.guides.steps as Record<string, { title: string; body: string }>)[id];
        expect(s?.title, id).toBeTruthy();
        expect(s?.body, id).toBeTruthy();
      }
      for (const g of GUIDE_IDS) expect(m.guides.kinds[g].name).toBeTruthy();
    }
    expect(fr.guides.steps.cachet.title).toBe('Cachet');
    expect(fr.guides.steps.aeCasnos.body).toContain('24 000 DA');
    expect(fr.guides.steps.quittance.body).toContain('4 000 DA');
  });
});

describe('progress', () => {
  it('keeps only real steps of the guide, in order', async () => {
    const p = await saveGuideProgress('fl-1', 'PP', ['cachet', 'statuts', 'local', 'local', 'nis']);
    expect(p.done).toEqual(['local', 'cachet']);
    expect(nextStep('PP', p.done)).toBe('quittance');
  });

  it('carries shared steps over when switching guide', async () => {
    await saveGuideProgress('fl-1', 'SARL', ['statuts', 'local', 'quittance']);
    const p = await saveGuideProgress('fl-1', 'EURL', guideProgressOf(await db.read(), 'fl-1')!.done);
    expect(p.done).toEqual(['statuts', 'local', 'quittance']);
    const pp = await saveGuideProgress('fl-1', 'PP', p.done);
    expect(pp.done).toEqual(['local', 'quittance']);
  });

  it('tells the copilot where the user is', async () => {
    await saveGuideProgress('fl-1', 'AE', ['anaeAccount']);
    expect(guideProgressLine(await db.read(), 'fl-1')).toContain('next step: aeCard');
    expect(guideProgressLine(await db.read(), 'nobody')).toBe('');
  });
});

describe('API', () => {
  it('saves and reads the caller’s own progress only', async () => {
    expect((await put({ guide: 'SARL', done: ['statuts'] })).status).toBe(200);
    actor = { id: 'fl-2', role: 'FREELANCER' };
    expect(await (await GET()).json()).toEqual({ progress: null });
    actor = { id: 'fl-1', role: 'FREELANCER' };
    expect(((await (await GET()).json()) as { progress: { done: string[] } }).progress.done).toEqual(['statuts']);
    expect((await DELETE()).status).toBe(204);
    expect(guideProgressOf(await db.read(), 'fl-1')).toBeNull();
  });

  it('rejects unknown guides, unknown steps and extra fields', async () => {
    expect((await put({ guide: 'SPA', done: [] })).status).toBe(422);
    expect((await put({ guide: 'SARL', done: ['hack'] })).status).toBe(422);
    expect((await put({ guide: 'SARL', done: [], userId: 'fl-2' })).status).toBe(422);
  });

  it('is closed to other roles and to guests', async () => {
    actor = { id: 'inc-1', role: 'INCUBATOR' };
    expect((await put({ guide: 'SARL', done: [] })).status).toBe(403);
    actor = null;
    expect((await GET()).status).toBe(403);
  });
});

describe('copilot passages', () => {
  it('finds the right guide for typical questions', () => {
    const idx = guideIndex();
    expect(search(idx, 'registre de commerce CNRC quittance', 3)[0]!.doc.id).toMatch(/metwork-guide-(sarl|pp)/);
    expect(guideIndex().docs.has('metwork-guide-eurl')).toBe(false);
    expect(search(idx, 'carte auto-entrepreneur ANAE', 3)[0]!.doc.id).toBe('metwork-guide-ae');
    expect(search(idx, 'différence personne physique personne morale choisir', 3)[0]!.doc.id).toBe('metwork-guide-choisir');
  });

  it('carries the links and the G08 download in the passage text', () => {
    const sarl = guideIndex().chunks.find((c) => c.docId === 'metwork-guide-sarl')!.text;
    expect(sarl).toContain('https://tabioucom.mf.gov.dz/acheter');
    expect(sarl).toContain('https://nifenligne.mf.gov.dz/DIDindexDemande2.asp');
    expect(sarl).toContain('G08');
  });
});
