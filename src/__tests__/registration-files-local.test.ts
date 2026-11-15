/**
 * The dev-only local storage fallback, against a real folder.
 *
 * With no Cloudinary credentials a developer still needs to try the feature, so
 * files go to a git-ignored folder OUTSIDE `public/`. This runs the full path
 * for real — sign (proxy mode) → upload → verify at submit → delete — because
 * it is the only part of the storage layer that can be exercised without the
 * vendor.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { db } from '@/server/db/store';

vi.mock('@/lib/cloudinary', () => ({
  isConfigured: () => false,
  getAuthenticatedRawResource: async () => { throw new Error('must not be called in local mode'); },
  readAuthenticatedRawHead: async () => { throw new Error('must not be called in local mode'); },
  destroyAuthenticatedRaw: async () => { throw new Error('must not be called in local mode'); },
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimitDistributed: vi.fn(async () => true) }));

import { POST as uploadRoute } from '@/app/api/registrations/file-upload/route';
import { resolveFileAnswers } from '@/server/registrations/files';
import {
  removeRegistrationFile,
  statRegistrationFile,
  writeLocalRegistrationFile,
} from '@/server/registrations/file-storage';

const EVENT = '33333333-3333-4333-8333-333333333333';
const FIELD = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-01-01T00:00:00.000Z';
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4096, 3)]);

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metwork-local-uploads-'));
  process.env.LOCAL_UPLOADS_DIR = dir;
  await db.update((d) => {
    d.programs = [];
    d.events = [{ id: EVENT, isActive: true, eventDate: '2099-01-01T00:00:00.000Z' } as never];
    d.registrationFormFields = [{
      id: FIELD, entityType: 'EVENT', entityId: EVENT, incubatorId: 'i', mentorId: null, label: 'Pitch deck',
      labelKey: null, type: 'FILE', options: null, optionKeys: null, required: false, order: 0,
      showWhen: null, createdAt: NOW, updatedAt: NOW,
    }] as never;
  });
});

afterEach(async () => {
  delete process.env.LOCAL_UPLOADS_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

function uploadReq(file: File | null, over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('entityType', 'EVENT');
  fd.append('entityId', EVENT);
  fd.append('fieldId', FIELD);
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  if (file) fd.append('file', file);
  return new NextRequest('http://localhost/api/registrations/file-upload', { method: 'POST', body: fd });
}

describe('local registration-file storage', () => {
  it('uploads, verifies and deletes a PDF for real', async () => {
    const res = await uploadRoute(uploadReq(new File([PDF], 'deck', { type: 'application/pdf' })));
    expect(res.status).toBe(201);
    const { publicId } = await res.json();

    expect(await statRegistrationFile(publicId)).toEqual({ bytes: PDF.length });

    const [answer] = await resolveFileAnswers(await db.read(), 'EVENT', EVENT, [
      { fieldId: FIELD, value: publicId, fileName: 'My deck.pdf' },
    ]);
    expect(answer!.file).toEqual({ name: 'My deck.pdf', bytes: PDF.length, contentType: 'application/pdf' });

    await removeRegistrationFile(publicId);
    expect(await statRegistrationFile(publicId)).toBeNull();
  });

  it('refuses a renamed executable at upload time', async () => {
    const res = await uploadRoute(uploadReq(new File([Buffer.from('MZ\x90\x00')], 'deck.pdf', { type: 'application/pdf' })));
    expect(res.status).toBe(415);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('refuses an upload for a question that is not a file question', async () => {
    const res = await uploadRoute(uploadReq(new File([PDF], 'deck'), { fieldId: '88888888-8888-4888-8888-888888888888' }));
    expect(res.status).toBe(404);
  });

  it('never writes outside its folder', async () => {
    await expect(writeLocalRegistrationFile('../escape', PDF)).rejects.toThrow(/outside/);
    expect(await statRegistrationFile('../escape')).toBeNull();
  });

  it('is refused in production, where Cloudinary is the only storage', async () => {
    const env = process.env as Record<string, string | undefined>;
    const before = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      const res = await uploadRoute(uploadReq(new File([PDF], 'deck')));
      expect(res.status).toBe(404);
    } finally {
      env.NODE_ENV = before;
    }
  });
});
