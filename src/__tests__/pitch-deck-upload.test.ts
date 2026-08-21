/**
 * Pitch deck upload — the direct browser → Cloudinary flow.
 *
 * The old flow streamed the PDF through POST /api/startups/:id/pitch-deck, but
 * Vercel Functions reject request bodies over 4.5 MB and drop the connection
 * mid-upload, so the browser only ever saw `TypeError: Failed to fetch`. Decks
 * now go straight to Cloudinary with a signature we mint, and only the file
 * reference comes back for verification.
 *
 * Covered here:
 *   • signature: ownership guard, PDF-only, 10 MB ceiling, proxy fallback
 *   • confirm:   public_id shape guard, true byte size re-check, persistence
 *   • the dev multipart fallback still works when Cloudinary is unconfigured
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import { MAX_PITCH_DECK_BYTES } from '@/lib/upload-limits';

const FOUNDER_ID = 'user-founder-1';
const OTHER_ID   = 'user-other-1';
const STARTUP_ID = '22222222-2222-4222-8222-222222222222';

const currentUser = { id: FOUNDER_ID, email: 'f@x.com', role: 'ENTREPRENEUR', approvalStatus: 'APPROVED' };

vi.mock('@/server/auth/api-guards', () => {
  const ok = async () => ({ ok: true, user: currentUser });
  return {
    requireApiRole: vi.fn(ok),
    requireApprovedApiRole: vi.fn(ok),
    requireApiSession: vi.fn(ok),
    requireApprovedApiSession: vi.fn(ok),
  };
});

// Cloudinary is stubbed: these tests assert OUR contract, not the vendor's.
// The vendor contract (signed raw upload, delivery, tamper rejection) was
// verified separately against the live account.
const cloudinaryState = {
  configured: true,
  resource: null as { secureUrl: string; bytes: number } | null,
  destroyed: [] as string[],
  lookupThrows: false,
};
vi.mock('@/lib/cloudinary', () => ({
  isConfigured: () => cloudinaryState.configured,
  isSupportedDocumentMime: (t: string) => t === 'application/pdf',
  signRawUpload: (publicId: string) => ({
    cloudName: 'test-cloud',
    apiKey:    'test-key',
    timestamp: 1_700_000_000,
    publicId,
    signature: 'sig-' + publicId,
    uploadUrl: 'https://api.cloudinary.com/v1_1/test-cloud/raw/upload',
  }),
  getRawResource: async () => {
    if (cloudinaryState.lookupThrows) throw new Error('Admin API unreachable');
    return cloudinaryState.resource;
  },
  destroyRawResource: async (id: string) => { cloudinaryState.destroyed.push(id); },
  uploadBuffer: async () => 'https://res.cloudinary.com/test-cloud/raw/upload/metwork/pitch-decks/x',
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
}));

import { POST as signRoute } from '@/app/api/startups/[id]/pitch-deck/signature/route';
import { POST as deckRoute } from '@/app/api/startups/[id]/pitch-deck/route';

const params = { params: Promise.resolve({ id: STARTUP_ID }) };

function jsonReq(body: unknown, url = `http://localhost/api/startups/${STARTUP_ID}/pitch-deck`) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function multipartReq(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return new NextRequest(`http://localhost/api/startups/${STARTUP_ID}/pitch-deck`, {
    method: 'POST',
    body: fd,
  });
}

function pdfFile(bytes: number, type = 'application/pdf', name = 'deck.pdf') {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(async () => {
  currentUser.id = FOUNDER_ID;
  cloudinaryState.configured = true;
  cloudinaryState.resource = null;
  cloudinaryState.destroyed = [];
  cloudinaryState.lookupThrows = false;
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
  await db.update((d) => {
    d.startupListings = [{
      id: STARTUP_ID,
      founderId: FOUNDER_ID,
      name: 'Acme',
      description: 'desc',
      industry: 'SaaS',
      fundingGoal: 1_000_000,
      equityOffered: 10,
      valuation: null,
      maturityStage: 'SEED',
      pitchDeckUrl: null,
      websiteUrl: null,
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never];
  });
});

describe('POST /api/startups/:id/pitch-deck/signature', () => {
  it('mints a folder-scoped signature for a PDF under the limit', async () => {
    const res = await signRoute(jsonReq({ size: 6 * 1024 * 1024, mimeType: 'application/pdf' }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('direct');
    expect(body.publicId).toMatch(/^metwork\/pitch-decks\/pitch-deck-[0-9a-f-]{36}$/);
    expect(body.uploadUrl).toBe('https://api.cloudinary.com/v1_1/test-cloud/raw/upload');
    expect(body.signature).toBeTruthy();
    // The secret itself never leaves the server.
    expect(JSON.stringify(body)).not.toContain('api_secret');
  });

  it('accepts a 9 MB deck — the size that the old 4.5 MB platform cap killed', async () => {
    const res = await signRoute(jsonReq({ size: 9 * 1024 * 1024, mimeType: 'application/pdf' }), params);
    expect(res.status).toBe(200);
  });

  it('rejects a file over the 10 MB limit with a readable message', async () => {
    const res = await signRoute(jsonReq({ size: MAX_PITCH_DECK_BYTES + 1, mimeType: 'application/pdf' }), params);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe('FILE_TOO_LARGE');
    expect(body.error.message).toBe('File exceeds the 10 MB limit.');
  });

  it('rejects a non-PDF', async () => {
    const res = await signRoute(jsonReq({ size: 1024, mimeType: 'image/jpeg' }), params);
    expect(res.status).toBe(415);
    expect((await res.json()).error.message).toBe('Pitch deck must be a PDF file.');
  });

  it("refuses to sign for someone else's startup", async () => {
    currentUser.id = OTHER_ID;
    const res = await signRoute(jsonReq({ size: 1024, mimeType: 'application/pdf' }), params);
    expect(res.status).toBe(403);
  });

  it('falls back to proxy mode when Cloudinary is unconfigured', async () => {
    cloudinaryState.configured = false;
    const res = await signRoute(jsonReq({ size: 1024, mimeType: 'application/pdf' }), params);
    expect((await res.json()).mode).toBe('proxy');
  });
});

describe('POST /api/startups/:id/pitch-deck (confirm)', () => {
  const PUBLIC_ID = 'metwork/pitch-decks/pitch-deck-3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const SECURE_URL = `https://res.cloudinary.com/test-cloud/raw/upload/v1787269364/${PUBLIC_ID}`;

  it('persists the verified URL onto the listing', async () => {
    cloudinaryState.resource = { secureUrl: SECURE_URL, bytes: 8 * 1024 * 1024 };
    const res = await deckRoute(jsonReq({ publicId: PUBLIC_ID, secureUrl: SECURE_URL }), params);
    expect(res.status).toBe(201);
    // The version segment must survive — a versionless raw URL 404s on delivery.
    expect((await res.json()).url).toBe(SECURE_URL);

    const data = await db.read();
    expect(data.startupListings[0]!.pitchDeckUrl).toBe(SECURE_URL);
  });

  it('still persists when the Cloudinary size lookup fails', async () => {
    cloudinaryState.lookupThrows = true;
    const res = await deckRoute(jsonReq({ publicId: PUBLIC_ID, secureUrl: SECURE_URL }), params);
    expect(res.status).toBe(201);
    expect((await res.json()).url).toBe(SECURE_URL);
  });

  it('rejects a public_id outside the pitch-deck folder without touching the listing', async () => {
    const res = await deckRoute(jsonReq({
      publicId: 'metwork/mentors/someone-elses-file',
      secureUrl: 'https://res.cloudinary.com/test-cloud/raw/upload/v1/metwork/mentors/someone-elses-file',
    }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_PUBLIC_ID');

    const data = await db.read();
    expect(data.startupListings[0]!.pitchDeckUrl).toBeNull();
  });

  it('rejects a URL pointing at a different cloud than ours', async () => {
    cloudinaryState.resource = { secureUrl: SECURE_URL, bytes: 1024 };
    const res = await deckRoute(jsonReq({
      publicId: PUBLIC_ID,
      secureUrl: `https://res.cloudinary.com/attacker-cloud/raw/upload/v1/${PUBLIC_ID}`,
    }), params);
    expect(res.status).toBe(400);

    const data = await db.read();
    expect(data.startupListings[0]!.pitchDeckUrl).toBeNull();
  });

  it('rejects a URL whose public_id does not match the confirmed one', async () => {
    cloudinaryState.resource = { secureUrl: SECURE_URL, bytes: 1024 };
    const res = await deckRoute(jsonReq({
      publicId: PUBLIC_ID,
      secureUrl: 'https://res.cloudinary.com/test-cloud/raw/upload/v1/metwork/pitch-decks/pitch-deck-00000000-0000-4000-8000-000000000000',
    }), params);
    expect(res.status).toBe(400);
  });

  it('deletes and rejects an upload that turns out to exceed 10 MB', async () => {
    cloudinaryState.resource = {
      secureUrl: `https://res.cloudinary.com/test-cloud/raw/upload/v1/${PUBLIC_ID}`,
      bytes: MAX_PITCH_DECK_BYTES + 1,
    };
    const res = await deckRoute(jsonReq({ publicId: PUBLIC_ID, secureUrl: SECURE_URL }), params);
    expect(res.status).toBe(413);
    expect(cloudinaryState.destroyed).toEqual([PUBLIC_ID]);

    const data = await db.read();
    expect(data.startupListings[0]!.pitchDeckUrl).toBeNull();
  });

  it('404s when the referenced upload does not exist', async () => {
    cloudinaryState.resource = null;
    const res = await deckRoute(jsonReq({ publicId: PUBLIC_ID, secureUrl: SECURE_URL }), params);
    expect(res.status).toBe(404);
  });

  it("refuses to write to someone else's startup", async () => {
    currentUser.id = OTHER_ID;
    const res = await deckRoute(jsonReq({ publicId: PUBLIC_ID, secureUrl: SECURE_URL }), params);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/startups/:id/pitch-deck (dev multipart fallback)', () => {
  beforeEach(() => { cloudinaryState.configured = false; });

  it('rejects a non-PDF with a readable message', async () => {
    const res = await deckRoute(multipartReq(pdfFile(64, 'image/jpeg', 'photo.jpg')), params);
    expect(res.status).toBe(415);
    expect((await res.json()).error.message).toBe('Pitch deck must be a PDF file.');
  });

  it('rejects a file over the 10 MB limit', async () => {
    const res = await deckRoute(multipartReq(pdfFile(MAX_PITCH_DECK_BYTES + 1)), params);
    expect(res.status).toBe(413);
    expect((await res.json()).error.message).toBe('File exceeds the 10 MB limit.');
  });

  it('rejects an empty file', async () => {
    const res = await deckRoute(multipartReq(pdfFile(0)), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('EMPTY_FILE');
  });
});
