/**
 * The consultant welcome email and its attached starter guide.
 *
 * Two things are worth pinning here. The copy describes the product AS BUILT —
 * a paid booking confirms itself — and the LinkedIn carousel this email is
 * based on says the opposite ("approuvez la demande en un clic"), so a future
 * edit that copies the carousel wording back in should fail. And the guide
 * attachment must degrade to "no attachment" rather than attaching whatever
 * bytes came back, because a signed-link failure answers 200 with an HTML body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { consultantWelcomeEmailHtml } from '@/server/notifications/email';
import {
  loadConsultantGuidePdf,
  clearConsultantGuideCache,
  CONSULTANT_GUIDE_FILENAME,
} from '@/server/notifications/consultant-guide';

vi.mock('@/lib/cloudinary', () => ({
  isConfigured: () => true,
  signedRawDownloadUrl: () => 'https://cdn.example/guide',
}));

const render = (over: Partial<Parameters<typeof consultantWelcomeEmailHtml>[0]> = {}) =>
  consultantWelcomeEmailHtml({
    fullName: 'Mohamed Amine Benali',
    portalUrl: 'https://metwork.dz/mentordashboard',
    guideAttached: true,
    ...over,
  });

describe('consultantWelcomeEmailHtml', () => {
  it('greets by first name only', () => {
    expect(render()).toContain('Bienvenue, Mohamed.');
    // A consultant with a single-word name still gets a sentence, not "Bienvenue, ."
    expect(render({ fullName: 'Karim' })).toContain('Bienvenue, Karim.');
    expect(render({ fullName: '  ' })).toContain('Bienvenue.');
  });

  it('walks the full arc, profile through first client to payout', () => {
    const html = render();
    for (const step of [
      'Complétez votre profil',
      'Ouvrez vos disponibilités',
      'Fixez votre tarif horaire',
      'Signez votre contrat consultant',
      'Partagez votre lien de réservation',
      'Recevez votre premier client',
      'Suivez vos revenus et retirez vos gains',
    ]) {
      expect(html).toContain(step);
    }
  });

  it('states the commission rather than leaving it to the contract', () => {
    const html = render();
    expect(html).toContain('20&nbsp;% sur les consultations');
    expect(html).toContain('5&nbsp;% sur les programmes');
  });

  it('describes booking as self-confirming, not consultant-approved', () => {
    // The carousel promises an approval button. The product has none — a paid
    // booking is confirmed on payment (see the consultation approval model).
    const html = render();
    expect(html).toContain('confirmée automatiquement');
    expect(html).not.toMatch(/Approuvez la demande/i);
  });

  it('mentions the attachment only when there is one', () => {
    expect(render({ guideAttached: true })).toContain('joint à cet email');
    expect(render({ guideAttached: false })).not.toContain('joint à cet email');
    // Either way the reader is invited to reply.
    expect(render({ guideAttached: false })).toContain('Répondez simplement à ce message');
  });

  it('links to the portal and signs off in the language it is written in', () => {
    const html = render();
    expect(html).toContain('https://metwork.dz/mentordashboard');
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('Tous droits réservés');
    expect(html).not.toContain('All rights reserved');
  });
});

describe('loadConsultantGuidePdf', () => {
  const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.alloc(2048, 0x20)]);

  beforeEach(() => clearConsultantGuideCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    clearConsultantGuideCache();
  });

  function stubFetch(impl: () => Promise<Response> | Response) {
    vi.stubGlobal('fetch', vi.fn(impl));
  }

  it('returns the bytes when the asset really is a PDF', async () => {
    stubFetch(() => new Response(PDF, { status: 200 }));
    const buf = await loadConsultantGuidePdf();
    expect(buf?.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('refuses an HTML error page answered with 200', async () => {
    // A failed signed link does exactly this. Attaching it would deliver a file
    // named Guide-consultant-Metwork.pdf that no reader can open.
    stubFetch(() => new Response('<html>Not authorized</html>', { status: 200 }));
    expect(await loadConsultantGuidePdf()).toBeNull();
  });

  it('returns null rather than throwing when the fetch fails', async () => {
    stubFetch(() => Promise.reject(new Error('network down')));
    expect(await loadConsultantGuidePdf()).toBeNull();
  });

  it('fetches once and serves the rest from cache', async () => {
    const spy = vi.fn(() => new Response(PDF, { status: 200 }));
    vi.stubGlobal('fetch', spy);
    await loadConsultantGuidePdf();
    await loadConsultantGuidePdf();
    await loadConsultantGuidePdf();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('names the attachment something a consultant will recognise', () => {
    expect(CONSULTANT_GUIDE_FILENAME).toMatch(/\.pdf$/);
    expect(CONSULTANT_GUIDE_FILENAME).toContain('Guide-consultant');
  });
});
