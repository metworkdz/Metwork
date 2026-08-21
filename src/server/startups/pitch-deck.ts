/**
 * Pitch-deck upload naming + validation — shared by the two halves of the
 * direct-upload flow so neither can drift from the other:
 *
 *   POST /api/startups/:id/pitch-deck/signature  → mints the public_id
 *   POST /api/startups/:id/pitch-deck            → confirms + persists it
 *
 * NAMING NOTE (verified against the live Cloudinary account, not assumed):
 * the public_id deliberately carries NO `.pdf` extension. Cloudinary's
 * "Allow delivery of PDF and ZIP files" account setting is off (its default),
 * and while it is off ANY delivery URL ending in `.pdf` returns 401 — including
 * `fl_attachment` variants. Extensionless raw assets deliver fine (200,
 * `application/octet-stream`, `Content-Disposition: attachment`), which is also
 * what the pre-existing pitch-deck and consultant-CV uploads already produce.
 *
 * Keeping it extensionless takes BOTH halves: Cloudinary appends the extension
 * of the uploaded file's *filename* to a raw public_id that has none, so the
 * browser must also send the file part without one (see the direct upload in
 * startup-profile-form.tsx). Otherwise the asset silently lands at
 * `<public_id>.pdf` — 401 on delivery, and invisible to the confirm lookup.
 *
 * If that account setting is ever enabled, append '.pdf' here and drop the
 * filename override in the client; nothing else needs to change.
 */
import { randomUUID } from 'node:crypto';
import { PITCH_DECK_FOLDER } from '@/lib/upload-limits';

const PREFIX = `${PITCH_DECK_FOLDER}/pitch-deck-`;

/** UUID-suffixed id, scoped to the pitch-deck folder. */
export function buildPitchDeckPublicId(): string {
  return `${PREFIX}${randomUUID()}`;
}

/**
 * True only for ids this module could have minted. The confirm step calls this
 * before touching the DB so a client cannot point `pitchDeckUrl` at an
 * arbitrary asset in the account (e.g. another founder's deck).
 */
export function isPitchDeckPublicId(publicId: string): boolean {
  return new RegExp(
    `^${escapeRe(PREFIX)}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
  ).test(publicId);
}

/**
 * Validates the delivery URL the browser reports back after a direct upload.
 *
 * The URL cannot be rebuilt server-side: a raw delivery URL needs Cloudinary's
 * `v<version>` segment (dropping it returns 404 — verified against the live
 * account), and the version is only known to whoever performed the upload. So
 * we take the client's value but pin every part of it that matters — host,
 * our cloud name, the raw/upload delivery type, and the public_id we minted.
 * The version digits are the only free component, and are inert.
 */
export function isPitchDeckDeliveryUrl(url: string, publicId: string): boolean {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return false;
  return new RegExp(
    `^https://res\\.cloudinary\\.com/${escapeRe(cloudName)}/raw/upload/v\\d+/${escapeRe(publicId)}$`,
  ).test(url);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}
