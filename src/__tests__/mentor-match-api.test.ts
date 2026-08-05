/**
 * Contract test for POST /api/mentors/match — the AI-assisted mentor
 * recommendation endpoint. Mocks the Anthropic integration (no real network
 * calls) to verify the non-blocking contract: any failure degrades to
 * `{ matches: [] }` with a 200, never a 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { db, type MentorRecord } from '@/server/db/store';

const matchMentorsViaClaude = vi.fn();
vi.mock('@/server/integrations/anthropic-mentor-match', () => ({
  matchMentorsViaClaude: (...args: unknown[]) => matchMentorsViaClaude(...args),
  AnthropicMatchError: class AnthropicMatchError extends Error {},
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitDistributed: vi.fn(async () => true),
}));

function seedMentor(over: Partial<MentorRecord> = {}): Promise<unknown> {
  return db.update((d) => {
    d.mentors = [
      {
        id: 'm1',
        fullName: 'Amina Test',
        position: 'Growth Advisor',
        imageUrl: 'https://example.com/a.jpg',
        bio: null,
        linkedinUrl: null,
        consultationFee: 4000,
        createdAt: '2026-01-01T00:00:00Z',
        ...over,
      } as MentorRecord,
    ];
  });
}

function req(body: unknown) {
  return new NextRequest('http://localhost/api/mentors/match', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  matchMentorsViaClaude.mockReset();
  await db.update((d) => { d.mentors = []; });
});

describe('POST /api/mentors/match', () => {
  it('returns matches on success (works without auth)', async () => {
    await seedMentor();
    matchMentorsViaClaude.mockResolvedValue([{ mentorId: 'm1', reason: 'Great fit for growth' }]);

    const { POST } = await import('@/app/api/mentors/match/route');
    const res = await POST(req({ query: 'I need help scaling my startup' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { matches: Array<{ mentorId: string }> };
    expect(body.matches).toEqual([{ mentorId: 'm1', reason: 'Great fit for growth' }]);
  });

  it('falls back to empty matches (200, not 500) when the integration throws', async () => {
    await seedMentor();
    matchMentorsViaClaude.mockRejectedValue(new Error('boom'));

    const { POST } = await import('@/app/api/mentors/match/route');
    const res = await POST(req({ query: 'I need help scaling my startup' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { matches: unknown[] };
    expect(body.matches).toEqual([]);
  });

  it('rejects an empty query with 422 (validation, not a silent fallback)', async () => {
    const { POST } = await import('@/app/api/mentors/match/route');
    const res = await POST(req({ query: '' }));
    expect(res.status).toBe(422);
  });

  it('rejects malformed JSON body with 400', async () => {
    const { POST } = await import('@/app/api/mentors/match/route');
    const badReq = new NextRequest('http://localhost/api/mentors/match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
  });

  it('is rate-limited per IP', async () => {
    const rateLimit = await import('@/lib/rate-limit');
    vi.mocked(rateLimit.checkRateLimitDistributed).mockResolvedValueOnce(false);

    const { POST } = await import('@/app/api/mentors/match/route');
    const res = await POST(req({ query: 'test query' }));
    expect(res.status).toBe(429);
  });
});
