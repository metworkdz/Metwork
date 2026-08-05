/**
 * Unit tests for `matchMentorsViaClaude` — the raw Anthropic integration.
 * Mocks `fetch` directly (not the route) so these actually exercise the
 * response-parsing logic, including the markdown-fence-stripping fix:
 * a live test against the real API showed Haiku 4.5 wrapping its JSON in
 * ```json fences despite being told not to — this pins that behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MentorDirectoryEntry } from '@/lib/mentor-directory';

vi.mock('@/lib/env', () => ({
  serverEnvVars: { ANTHROPIC_API_KEY: 'test-key' },
}));

const roster: MentorDirectoryEntry[] = [
  { id: 'm1', name: 'Cherif Haddad', photoUrl: null, categories: [], shortBio: 'IT & Cyber security', price: 3000, currency: 'DZD', isPriced: true },
  { id: 'm2', name: 'Amira Hamdad', photoUrl: null, categories: [], shortBio: 'Management', price: 4000, currency: 'DZD', isPriced: true },
];

function mockAnthropicText(text: string) {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
    }), { status: 200 }),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('matchMentorsViaClaude', () => {
  it('parses a well-formed JSON response', async () => {
    mockAnthropicText('{"matches": [{"mentorId": "m1", "reason": "Cybersecurity expertise"}]}');
    const { matchMentorsViaClaude } = await import('@/server/integrations/anthropic-mentor-match');
    const matches = await matchMentorsViaClaude('I need cybersecurity help', roster, 'en');
    expect(matches).toEqual([{ mentorId: 'm1', reason: 'Cybersecurity expertise' }]);
  });

  it('strips ```json markdown fences before parsing (regression: observed live from Haiku 4.5)', async () => {
    mockAnthropicText('```json\n{"matches": [{"mentorId": "m1", "reason": "Spécialiste en cybersécurité"}]}\n```');
    const { matchMentorsViaClaude } = await import('@/server/integrations/anthropic-mentor-match');
    const matches = await matchMentorsViaClaude('cybersécurité', roster, 'fr');
    expect(matches).toEqual([{ mentorId: 'm1', reason: 'Spécialiste en cybersécurité' }]);
  });

  it('strips bare ``` fences (no "json" language tag) before parsing', async () => {
    mockAnthropicText('```\n{"matches": []}\n```');
    const { matchMentorsViaClaude } = await import('@/server/integrations/anthropic-mentor-match');
    const matches = await matchMentorsViaClaude('anything', roster, 'en');
    expect(matches).toEqual([]);
  });

  it('drops a hallucinated mentorId not in the roster', async () => {
    mockAnthropicText('{"matches": [{"mentorId": "does-not-exist", "reason": "x"}, {"mentorId": "m2", "reason": "Real match"}]}');
    const { matchMentorsViaClaude } = await import('@/server/integrations/anthropic-mentor-match');
    const matches = await matchMentorsViaClaude('query', roster, 'en');
    expect(matches).toEqual([{ mentorId: 'm2', reason: 'Real match' }]);
  });

  it('caps matches to the top 2', async () => {
    mockAnthropicText('{"matches": [{"mentorId": "m1", "reason": "a"}, {"mentorId": "m2", "reason": "b"}, {"mentorId": "m1", "reason": "c"}]}');
    const { matchMentorsViaClaude } = await import('@/server/integrations/anthropic-mentor-match');
    const matches = await matchMentorsViaClaude('query', roster, 'en');
    expect(matches).toHaveLength(2);
  });

  it('throws on non-2xx response', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const { matchMentorsViaClaude, AnthropicMatchError } = await import('@/server/integrations/anthropic-mentor-match');
    await expect(matchMentorsViaClaude('query', roster, 'en')).rejects.toThrow(AnthropicMatchError);
  });

  it('throws on stop_reason: refusal', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ content: [], stop_reason: 'refusal' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const { matchMentorsViaClaude, AnthropicMatchError } = await import('@/server/integrations/anthropic-mentor-match');
    await expect(matchMentorsViaClaude('query', roster, 'en')).rejects.toThrow(AnthropicMatchError);
  });

  it('throws on genuinely malformed (non-JSON, non-fenced) text', async () => {
    mockAnthropicText('Sorry, I cannot help with that.');
    const { matchMentorsViaClaude, AnthropicMatchError } = await import('@/server/integrations/anthropic-mentor-match');
    await expect(matchMentorsViaClaude('query', roster, 'en')).rejects.toThrow(AnthropicMatchError);
  });

  it('throws when the API key is not configured', async () => {
    vi.doMock('@/lib/env', () => ({ serverEnvVars: { ANTHROPIC_API_KEY: undefined } }));
    vi.resetModules();
    const { matchMentorsViaClaude, AnthropicMatchError } = await import('@/server/integrations/anthropic-mentor-match');
    await expect(matchMentorsViaClaude('query', roster, 'en')).rejects.toThrow(AnthropicMatchError);
    vi.doUnmock('@/lib/env');
    vi.resetModules();
  });
});
