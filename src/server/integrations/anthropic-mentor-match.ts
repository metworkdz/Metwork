/**
 * AI-assisted mentor matching — calls the Anthropic Messages API directly
 * via `fetch` (no SDK dependency, per spec) to recommend 1-2 mentors from a
 * free-text problem description.
 *
 * Throws `AnthropicMatchError` on ANY failure (missing key, network error,
 * non-2xx, refusal, malformed JSON, schema mismatch) — never swallows its
 * own errors. The caller decides the fallback. Mirrors the established
 * non-blocking-integration contract in `src/server/integrations/zoom.ts`
 * (`createZoomMeeting` throws; `lifecycle.ts` catches and falls back).
 */
import { serverEnvVars } from '@/lib/env';
import type { MentorDirectoryEntry } from '@/lib/mentor-directory';
import type { Locale } from '@/i18n/config';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;

export class AnthropicMatchError extends Error {}

export interface MentorMatch {
  mentorId: string;
  reason: string;
}

/** Lean per-mentor roster line sent to Claude — id, name, categories, short bio only. No unnecessary fields, to keep input tokens low. */
function buildRosterLine(m: MentorDirectoryEntry): string {
  return JSON.stringify({
    id: m.id,
    name: m.name,
    categories: m.categories.map((c) => c.label),
    shortBio: m.shortBio,
  });
}

function buildSystemPrompt(roster: MentorDirectoryEntry[], locale: Locale): string {
  const rosterLines = roster.map(buildRosterLine).join('\n');
  return [
    'You match an entrepreneur\'s free-text problem description to the best-fitting mentor(s) from a roster.',
    '',
    'Mentor roster (one JSON object per line — id, name, categories, shortBio):',
    rosterLines,
    '',
    `Respond in this locale for the "reason" text: ${locale}.`,
    'Return ONLY valid JSON, no markdown code fences, no preamble, no explanation outside the JSON.',
    'Shape: {"matches": [{"mentorId": string, "reason": string}]}',
    'Return the top 1-2 matches, ranked best first. Each "reason" must be a single short phrase, roughly 12 words or fewer, explaining why that mentor fits.',
    'If nothing in the roster is a reasonable fit, return {"matches": []}.',
    'Only use mentorId values that appear in the roster above — never invent one.',
  ].join('\n');
}

interface AnthropicMessageResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
}

/**
 * Haiku 4.5 sometimes wraps JSON in ```json fences despite being told not
 * to (observed live: "```json\n{...}\n```"). Strip a leading/trailing
 * fence defensively before parsing rather than rejecting an otherwise
 * well-formed response.
 */
function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

/**
 * Calls Claude Haiku 4.5 to rank the roster against `query`. Throws on any
 * failure — the route handler catches and falls back to `{ matches: [] }`.
 */
export async function matchMentorsViaClaude(
  query: string,
  roster: MentorDirectoryEntry[],
  locale: Locale,
): Promise<MentorMatch[]> {
  const apiKey = serverEnvVars.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnthropicMatchError('ANTHROPIC_API_KEY not configured');
  }
  if (roster.length === 0) {
    return [];
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(roster, locale),
      messages: [{ role: 'user', content: query }],
    }),
  });

  if (!res.ok) {
    throw new AnthropicMatchError(`Anthropic API error (${res.status})`);
  }

  const data = (await res.json()) as AnthropicMessageResponse;

  if (data.stop_reason === 'refusal') {
    throw new AnthropicMatchError('Anthropic declined the request');
  }

  const textBlock = data.content?.find((b) => b.type === 'text');
  if (!textBlock?.text) {
    throw new AnthropicMatchError('Anthropic response had no text content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownFences(textBlock.text));
  } catch {
    throw new AnthropicMatchError('Anthropic response was not valid JSON');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { matches?: unknown }).matches)
  ) {
    throw new AnthropicMatchError('Anthropic response did not match the expected shape');
  }

  const rosterIds = new Set(roster.map((m) => m.id));
  const matches = (parsed as { matches: unknown[] }).matches
    .filter(
      (m): m is MentorMatch =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as MentorMatch).mentorId === 'string' &&
        typeof (m as MentorMatch).reason === 'string' &&
        rosterIds.has((m as MentorMatch).mentorId),
    )
    .slice(0, 2);

  return matches;
}
