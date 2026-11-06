/**
 * The subtitle endpoints, shared by the admin and the mentor Studio routes
 * (each route does its own auth and passes who may touch the lesson).
 *   GET    ?lang=fr       → the WebVTT text of one language (to read / check)
 *   POST   { lang, vtt }  → upload the author's file for one language
 *   DELETE ?lang=fr       → remove a language
 *   POST …/translate      → draft the other languages with Haiku 4.5
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, jsonError } from '@/server/http/json';
import { VTT_MAX_BYTES } from '@/lib/vtt';
import { draftSubtitleTranslations, getSubtitleText, removeSubtitle, uploadSubtitle } from './subtitles';
import { parseBody, rateLimited } from './http';
import type { SubtitleLang } from './repo';

const LANG = z.enum(['fr', 'en', 'ar']);
const STATUS: Record<string, number> = { NOT_FOUND: 404, NO_VIDEO: 409, INVALID_VTT: 422, TOO_LARGE: 413, NO_SOURCE: 409, UNAVAILABLE: 503, FAILED: 502, UPSTREAM: 502 };

const langOf = (req: NextRequest): SubtitleLang | null => {
  const p = LANG.safeParse(req.nextUrl.searchParams.get('lang'));
  return p.success ? p.data : null;
};

export async function subtitleGet(req: NextRequest, courseId: string, lessonId: string) {
  const lang = langOf(req);
  if (!lang) return jsonError(422, 'BAD_LANG', 'lang must be fr, en or ar');
  const vtt = await getSubtitleText(courseId, lessonId, lang);
  return vtt === null ? jsonError(404, 'NOT_FOUND', 'No subtitles in this language') : json({ lang, vtt });
}

export async function subtitlePost(req: NextRequest, courseId: string, lessonId: string, actorKey: string) {
  const limited = await rateLimited(`academy:subs:${actorKey}`, 60, 60 * 60_000);
  if (limited) return limited;
  const body = await parseBody(req, z.object({ lang: LANG, vtt: z.string().min(6).max(VTT_MAX_BYTES) }));
  if (!body.ok) return body.response;
  const res = await uploadSubtitle(courseId, lessonId, body.data.lang, body.data.vtt);
  return res.ok ? json(res, { status: 201 }) : jsonError(STATUS[res.code] ?? 422, res.code, res.code);
}

export async function subtitleDelete(req: NextRequest, courseId: string, lessonId: string) {
  const lang = langOf(req);
  if (!lang) return jsonError(422, 'BAD_LANG', 'lang must be fr, en or ar');
  return (await removeSubtitle(courseId, lessonId, lang)) ? json({ ok: true }) : jsonError(404, 'NOT_FOUND', 'No subtitles in this language');
}

export async function subtitleTranslate(courseId: string, lessonId: string, actorKey: string) {
  // A paid AI call per language and lesson.
  const limited = await rateLimited(`academy:subs-ai:${actorKey}`, 20, 60 * 60_000);
  if (limited) return limited;
  const res = await draftSubtitleTranslations(courseId, lessonId);
  return res.ok ? json(res) : jsonError(STATUS[res.code] ?? 422, res.code, res.code);
}
