/**
 * Minimal WebVTT handling for lesson subtitles: parse the cues the whisper
 * pipeline writes, and write them back with new text (translations keep the
 * timings). Client-safe: the builder validates a file before uploading it.
 */

export interface VttCue { start: string; end: string; settings: string; text: string }

export const VTT_MAX_BYTES = 1_000_000;
export const VTT_MAX_CUES = 5000;

const TIME = String.raw`(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}`;
const TIMING_RE = new RegExp(String.raw`^(${TIME})\s+-->\s+(${TIME})(.*)$`);

/** Cues of a WebVTT file (SRT-style commas accepted), or null when it is not one. */
export function parseVtt(raw: string): VttCue[] | null {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text)) return null;
  const cues: VttCue[] = [];
  for (const block of text.split(/\n{2,}/).slice(1)) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    const at = lines.findIndex((l) => TIMING_RE.test(l));
    if (at === -1) continue; // NOTE / STYLE / REGION blocks
    const m = TIMING_RE.exec(lines[at]!)!;
    const body = lines.slice(at + 1).join('\n').trim();
    if (!body) continue;
    cues.push({ start: m[1]!.replace(',', '.'), end: m[2]!.replace(',', '.'), settings: m[3]!.trim(), text: body });
    if (cues.length > VTT_MAX_CUES) return null;
  }
  return cues.length ? cues : null;
}

export function serializeVtt(cues: VttCue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${c.start} --> ${c.end}${c.settings ? ` ${c.settings}` : ''}\n${c.text}`).join('\n\n')}\n`;
}
