/**
 * Startup Academy phase 0 — the shared rules (prices, shares, watch-time caps),
 * translated titles, settings, the VdoCipher adapter, the viewer watermark and
 * the progress / watch-time storage (memory backend; Postgres is the same
 * interface with the cap applied in SQL).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db/store';
import {
  ACADEMY_DEFAULTS,
  coursePriceError,
  creditableWatchSeconds,
  mentorShareRate,
  passPrices,
} from '@/lib/academy';
import { isLocalizedText, localizedText, missingLocales, resolveText, withTranslation } from '@/lib/localized-text';
import {
  getAcademyPricing,
  getAcademySettings,
  listAcademyFields,
  setMentorAcademyShare,
  updateAcademySettings,
} from '@/server/academy/settings';
import { createVdoCipherProvider, isVdoCipherId, mapVdoStatus } from '@/server/academy/video/vdocipher';
import { createMockVideoProvider } from '@/server/academy/video/mock';
import { accountCode, maskPhone, watermarkLabel } from '@/server/academy/watermark';
import { createMemoryAcademyRepo } from '@/server/academy/repo';
import { isAcademyAnnounced, isAcademyEnabled, isAcademyStudioEnabled } from '@/config/feature-flags';

const ADMIN = { id: 'admin-1', email: 'admin@metwork.dz' };
const VID = '0123456789abcdef0123456789abcdef';

beforeEach(async () => {
  await db.update((d) => {
    d.academySettings = null;
    d.academyFields = [];
    d.mentors = [{ id: 'm-1', fullName: 'Yacine Kheddaoui' } as never];
  });
});

describe('prices and shares (owner decisions of 2026-10-26)', () => {
  it('Pass: 3 500 DA a month, yearly −20 %, Premium −20 % on both', () => {
    expect(passPrices(ACADEMY_DEFAULTS)).toEqual({ monthly: 3500, annual: 33600, monthlyPremium: 2800, annualPremium: 26880 });
  });

  it('course price: whole dinars, never below 2 900', () => {
    expect(coursePriceError(2900)).toBeNull();
    expect(coursePriceError(2899)).toBe('BELOW_MINIMUM');
    expect(coursePriceError(2900.5)).toBe('NOT_A_NUMBER');
    expect(coursePriceError('2900')).toBe('NOT_A_NUMBER');
    expect(coursePriceError(5_000_000)).toBe('TOO_HIGH');
  });

  it('mentor share: own override, else the 30 % default; an invalid override falls back', () => {
    expect(mentorShareRate(null, ACADEMY_DEFAULTS)).toBe(0.3);
    expect(mentorShareRate({ academyShareRate: 0.4 }, ACADEMY_DEFAULTS)).toBe(0.4);
    expect(mentorShareRate({ academyShareRate: 0 }, ACADEMY_DEFAULTS)).toBe(0);
    expect(mentorShareRate({ academyShareRate: 1.5 }, ACADEMY_DEFAULTS)).toBe(0.3);
  });
});

describe('watch-time caps', () => {
  it('a heartbeat credits at most 35 s, and never a negative or NaN amount', () => {
    expect(creditableWatchSeconds({ elapsedSec: 30, alreadyTodaySec: 0, lessonDurationSec: 120 })).toBe(30);
    expect(creditableWatchSeconds({ elapsedSec: 600, alreadyTodaySec: 0, lessonDurationSec: 1200 })).toBe(35);
    expect(creditableWatchSeconds({ elapsedSec: -5, alreadyTodaySec: 0, lessonDurationSec: 120 })).toBe(0);
    expect(creditableWatchSeconds({ elapsedSec: Number.NaN, alreadyTodaySec: 0, lessonDurationSec: 120 })).toBe(0);
  });

  it('a lesson counts at most twice its length per day (looping earns nothing)', () => {
    expect(creditableWatchSeconds({ elapsedSec: 30, alreadyTodaySec: 230, lessonDurationSec: 120 })).toBe(10);
    expect(creditableWatchSeconds({ elapsedSec: 30, alreadyTodaySec: 240, lessonDurationSec: 120 })).toBe(0);
  });
});

describe('translated titles', () => {
  it('reader language first, then the original, never empty while any text exists', () => {
    const t = withTranslation(localizedText('fr', 'Trouver et valider son idée'), 'en', 'Find and validate your idea');
    expect(resolveText(t, 'en')).toBe('Find and validate your idea');
    expect(resolveText(t, 'ar')).toBe('Trouver et valider son idée');
    expect(resolveText(t, 'xx')).toBe('Trouver et valider son idée');
    expect(resolveText({ source: 'fr', fr: '  ', ar: 'فكرة' }, 'en')).toBe('فكرة');
    expect(missingLocales(t)).toEqual(['ar']);
  });

  it('machine drafts are tracked until a person writes that language', () => {
    let t = withTranslation(localizedText('fr', 'Titre'), 'ar', 'عنوان', true);
    expect(t.drafted).toEqual(['ar']);
    t = withTranslation(t, 'ar', 'العنوان');
    expect(t.drafted).toBeUndefined();
    expect(withTranslation(localizedText('fr', 'Titre'), 'fr', 'Nouveau', true).drafted).toBeUndefined();
  });

  it('rejects malformed text from a request body', () => {
    expect(isLocalizedText({ source: 'fr', fr: 'ok' })).toBe(true);
    expect(isLocalizedText({ source: 'fr', en: 'only english' })).toBe(false);
    expect(isLocalizedText({ source: 'de', de: 'x' })).toBe(false);
    expect(isLocalizedText({ source: 'fr', fr: 'ok', en: 3 })).toBe(false);
    expect(isLocalizedText({ source: 'fr', fr: 'ok', drafted: ['xx'] })).toBe(false);
  });
});

describe('Academy settings', () => {
  it('read the defaults until an admin saves, without writing on read', async () => {
    expect(await getAcademyPricing()).toEqual(ACADEMY_DEFAULTS);
    expect((await db.read()).academySettings).toBeNull();
  });

  it('the admin changes the Pass price; the change is audited', async () => {
    const res = await updateAcademySettings({ passMonthlyPriceDzd: 3900 }, ADMIN);
    expect(res.ok).toBe(true);
    const s = await getAcademySettings();
    expect(s.passMonthlyPriceDzd).toBe(3900);
    expect(s.defaultMentorShareRate).toBe(0.3);
    expect(s.updatedBy).toBe('admin-1');
    await vi.waitFor(async () => {
      const log = (await db.read()).auditLogs.find((l) => l.action === 'ACADEMY_SETTINGS_UPDATED');
      expect(log?.details).toEqual({ before: { passMonthlyPriceDzd: 3500 }, after: { passMonthlyPriceDzd: 3900 } });
    });
  });

  it('refuses bad values and leaves the store untouched', async () => {
    expect(await updateAcademySettings({ passMonthlyPriceDzd: 0 }, ADMIN)).toEqual({ ok: false, code: 'INVALID_PRICE' });
    expect(await updateAcademySettings({ passMonthlyPriceDzd: 3500.5 }, ADMIN)).toEqual({ ok: false, code: 'INVALID_PRICE' });
    expect(await updateAcademySettings({ defaultMentorShareRate: 1 }, ADMIN)).toEqual({ ok: false, code: 'INVALID_RATE' });
    expect(await updateAcademySettings({ certificateStampUrl: 'http://evil.example/stamp.png' }, ADMIN)).toEqual({ ok: false, code: 'INVALID_STAMP_URL' });
    expect(await updateAcademySettings({ certificateStampUrl: 'https://evil.example/stamp.png' }, ADMIN)).toEqual({ ok: false, code: 'INVALID_STAMP_URL' });
    expect((await db.read()).academySettings).toBeNull();
  });

  it('stores the certificate stamp (Cloudinary only) and lets the admin clear it', async () => {
    await updateAcademySettings({ certificateStampUrl: 'https://res.cloudinary.com/metwork/image/upload/stamp.png' }, ADMIN);
    expect((await getAcademySettings()).certificateStampUrl).toContain('stamp.png');
    await updateAcademySettings({ certificateStampUrl: null }, ADMIN);
    expect((await getAcademySettings()).certificateStampUrl).toBeNull();
  });

  it('sets and clears a mentor override', async () => {
    expect(await setMentorAcademyShare('m-1', 0.4, ADMIN)).toEqual({ ok: true });
    expect((await db.read()).mentors[0]!.academyShareRate).toBe(0.4);
    expect(await setMentorAcademyShare('m-1', null, ADMIN)).toEqual({ ok: true });
    expect((await db.read()).mentors[0]!.academyShareRate).toBeNull();
    expect(await setMentorAcademyShare('nope', 0.4, ADMIN)).toEqual({ ok: false, code: 'MENTOR_NOT_FOUND' });
    expect(await setMentorAcademyShare('m-1', -0.1, ADMIN)).toEqual({ ok: false, code: 'INVALID_RATE' });
  });

  it('fields: the built-in nine until the admin saves a list; hidden ones stay out of public lists', async () => {
    expect((await listAcademyFields()).map((f) => f.id)).toEqual(
      ['ideation', 'legal', 'tax', 'funding', 'marketing', 'sales', 'finance', 'product', 'leadership'],
    );
    await db.update((d) => {
      d.academyFields = [
        { id: 'b', label: null, order: 1, hidden: false },
        { id: 'a', label: null, order: 0, hidden: false },
        { id: 'c', label: null, order: 2, hidden: true },
      ];
    });
    expect((await listAcademyFields()).map((f) => f.id)).toEqual(['a', 'b']);
    expect((await listAcademyFields({ includeHidden: true })).map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('VdoCipher adapter', () => {
  function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      const r = handler(url, init);
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
    }) as typeof fetch;
    return { impl, calls };
  }

  it('reserves an upload and maps the direct-upload form fields', async () => {
    const f = fakeFetch(() => ({
      status: 200,
      body: { videoId: VID, clientPayload: { uploadLink: 'https://s3.example/up', policy: 'P', key: 'K', 'x-amz-signature': 'S', 'x-amz-algorithm': 'A', 'x-amz-date': 'D', 'x-amz-credential': 'C' } },
    }));
    const ticket = await createVdoCipherProvider('secret', f.impl).createUpload({ title: 'Leçon 1\n' });
    expect(f.calls[0]!.url).toBe('https://dev.vdocipher.com/api/videos?title=Le%C3%A7on%201');
    expect(f.calls[0]!.init.method).toBe('PUT');
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Apisecret secret');
    expect(ticket).toMatchObject({ videoId: VID, url: 'https://s3.example/up', fileField: 'file' });
    expect(ticket.fields).toMatchObject({ policy: 'P', key: 'K', 'x-amz-signature': 'S', success_action_status: '201' });
  });

  it('mints a playback token with the moving watermark', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { otp: 'o', playbackInfo: 'p' } }));
    const tok = await createVdoCipherProvider('secret', f.impl).createPlaybackToken({ videoId: VID, watermark: 'Amina B. · U-ABC123', ttlSec: 300 });
    expect(tok).toMatchObject({ otp: 'o', playbackInfo: 'p' });
    const sent = JSON.parse(String(f.calls[0]!.init.body)) as { ttl: number; annotate: string };
    expect(sent.ttl).toBe(300);
    expect(JSON.parse(sent.annotate)).toEqual([expect.objectContaining({ type: 'rtext', text: 'Amina B. · U-ABC123' })]);
  });

  it('refuses anything but a VdoCipher id before building a URL', async () => {
    const f = fakeFetch(() => ({ status: 200, body: {} }));
    const p = createVdoCipherProvider('secret', f.impl);
    await expect(p.getVideo('../../users')).rejects.toMatchObject({ code: 'BAD_ID' });
    await expect(p.createPlaybackToken({ videoId: 'x?y=1', watermark: 'w', ttlSec: 60 })).rejects.toMatchObject({ code: 'BAD_ID' });
    expect(f.calls).toHaveLength(0);
    expect(isVdoCipherId(VID)).toBe(true);
    expect(isVdoCipherId(VID.toUpperCase())).toBe(false);
  });

  it('reads status and length; unknown video is null; upstream errors do not leak the body', async () => {
    const ok = fakeFetch(() => ({ status: 200, body: { id: VID, status: 'ready', length: 116.4, poster: 'https://x/p.jpg' } }));
    expect(await createVdoCipherProvider('s', ok.impl).getVideo(VID)).toEqual({ videoId: VID, status: 'READY', durationSec: 116, posterUrl: 'https://x/p.jpg' });
    const missing = fakeFetch(() => ({ status: 404 }));
    expect(await createVdoCipherProvider('s', missing.impl).getVideo(VID)).toBeNull();
    const boom = fakeFetch(() => ({ status: 500, body: { message: 'secret detail' } }));
    await expect(createVdoCipherProvider('s', boom.impl).createPlaybackToken({ videoId: VID, watermark: 'w', ttlSec: 60 }))
      .rejects.toThrow(/^VdoCipher otp failed \(500\)$/);
    expect(['PRE-Upload', 'Queued', 'Processing', 'ready', 'Error'].map(mapVdoStatus)).toEqual(['UPLOADING', 'PROCESSING', 'PROCESSING', 'READY', 'FAILED']);
  });

  it('the mock serves the same interface and records each watermark', async () => {
    const p = createMockVideoProvider();
    const { videoId } = await p.createUpload({ title: 't' });
    expect((await p.getVideo(videoId))?.status).toBe('READY');
    await p.createPlaybackToken({ videoId, watermark: 'w', ttlSec: 60 });
    expect(p.tokens).toEqual([{ videoId, watermark: 'w' }]);
  });
});

describe('viewer watermark', () => {
  it('first name, initial, masked phone and a keyed account code', () => {
    const label = watermarkLabel({ id: 'u-1', fullName: 'Amina Belaïd', phone: '+213 555 12 34 12' }, 'k'.repeat(32));
    expect(label).toBe(`Amina B. · •• •• •• 12 · U-${accountCode('u-1', 'k'.repeat(32))}`);
    expect(label).not.toContain('555');
    expect(accountCode('u-1', 'a'.repeat(32))).not.toBe(accountCode('u-1', 'b'.repeat(32)));
    expect(accountCode('u-1', 'a'.repeat(32))).toMatch(/^[0-9A-F]{6}$/);
  });

  it('works without a name or phone, and strips control characters', () => {
    expect(maskPhone('12')).toBeNull();
    expect(watermarkLabel({ id: 'u-2' }, 'k'.repeat(32))).toMatch(/^U-[0-9A-F]{6}$/);
    expect(watermarkLabel({ id: 'u-3', fullName: 'Ali\u0000\nBen' }, 'k'.repeat(32))).toMatch(/^Ali B\. · U-/);
  });
});

describe('progress and watch-time storage', () => {
  const repo = createMemoryAcademyRepo();
  beforeEach(() => repo.reset());
  const watch = (extra: Partial<Parameters<typeof repo.addWatch>[0]> = {}) => repo.addWatch({
    userId: 'u-1', lessonId: 'l-1', courseId: 'c-1', mentorId: 'm-1', access: 'PASS', day: '2026-10-26',
    elapsedSec: 30, lessonDurationSec: 60, ...extra,
  });

  it('resume point updates; completion sticks', async () => {
    await repo.saveProgress({ userId: 'u-1', courseId: 'c-1', lessonId: 'l-1', positionSec: 40.7, completed: true });
    await repo.saveProgress({ userId: 'u-1', courseId: 'c-1', lessonId: 'l-1', positionSec: 5 });
    const [p] = await repo.progressFor('u-1', 'c-1');
    expect(p).toMatchObject({ positionSec: 5 });
    expect(p!.completedAt).not.toBeNull();
  });

  it('caps the day at twice the lesson and totals Pass time per subscriber and mentor', async () => {
    for (let i = 0; i < 6; i++) await watch();
    expect(await watch()).toEqual({ credited: 0, totalToday: 120 });
    await watch({ lessonId: 'l-2', mentorId: 'm-2' });
    await watch({ lessonId: 'l-3', access: 'OWNED' });
    await watch({ day: '2026-11-01' });
    expect(await repo.watchTotals('2026-10-01', '2026-10-31', 'PASS')).toEqual([
      { userId: 'u-1', mentorId: 'm-1', seconds: 120 },
      { userId: 'u-1', mentorId: 'm-2', seconds: 30 },
    ]);
    await expect(repo.watchTotals('2026-10-01; drop', '2026-10-31', 'PASS')).rejects.toThrow('Invalid day');
  });

  it('erases a deleted account', async () => {
    await watch();
    await repo.saveProgress({ userId: 'u-1', courseId: 'c-1', lessonId: 'l-1', positionSec: 1 });
    await repo.deleteUser('u-1');
    expect(await repo.progressFor('u-1', 'c-1')).toEqual([]);
    expect(await repo.watchTotals('2026-10-01', '2026-10-31', 'PASS')).toEqual([]);
  });
});

describe('launch flag', () => {
  it('open by link, not announced, closed to consultants; the preview env turns everything on', () => {
    const before = process.env.NEXT_PUBLIC_ACADEMY_PREVIEW;
    delete process.env.NEXT_PUBLIC_ACADEMY_PREVIEW;
    expect(isAcademyEnabled()).toBe(true);
    expect(isAcademyAnnounced()).toBe(false);
    expect(isAcademyStudioEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_ACADEMY_PREVIEW = 'true';
    expect(isAcademyAnnounced()).toBe(true);
    expect(isAcademyStudioEnabled()).toBe(true);
    if (before === undefined) delete process.env.NEXT_PUBLIC_ACADEMY_PREVIEW;
    else process.env.NEXT_PUBLIC_ACADEMY_PREVIEW = before;
  });
});
