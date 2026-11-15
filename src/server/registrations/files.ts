/**
 * Files attached to a registration answer — naming, validation, verification.
 *
 * A "File upload" question lets an applicant attach a PDF or JPG (a startup's
 * pitch deck, say) while registering. Flow, and where each half lives:
 *
 *   POST /api/registrations/file-signature  → mints a public_id for THIS event
 *                                             and THIS question, plus a signature
 *   browser → Cloudinary                    → the bytes (never through our lambda)
 *   POST /api/registrations (free)          ┐
 *   POST /api/bookings/card (paid)          ├ each calls `resolveFileAnswers`
 *   desk add-participant                    ┘ before anything is saved
 *
 * The answer's `value` is the public_id. Everything that already treats answers
 * as strings (the required check, the CSV, pruning when a question is deleted)
 * keeps working; the verified facts about the file travel in `answer.file`,
 * which only this module writes — a request body can never supply it.
 *
 * WHY THE PATH CARRIES entityType/entityId/fieldId: the signature covers the
 * public_id, so a visitor cannot upload anywhere we did not choose, and at
 * submit a file uploaded for one question cannot be attached to another event
 * or question. It also lets cleanup recognise a file's owner from its name.
 *
 * NAMING: extensionless, like the pitch-deck and contract assets — see
 * `src/server/startups/pitch-deck.ts` for why. The browser must also send the
 * file part without an extension.
 */
import { randomUUID } from 'node:crypto';
import { jsonError } from '@/server/http/json';
import {
  MAX_REGISTRATION_FILE_BYTES,
  MAX_REGISTRATION_FILE_MB,
  REGISTRATION_FILE_FOLDER,
  REGISTRATION_FILE_MIMES,
  type RegistrationFileMime,
} from '@/lib/upload-limits';
import type {
  RegistrationAnswerFile,
  RegistrationAnswerRecord,
  RegistrationFormFieldRecord,
} from '@/server/db/store';
import { headRegistrationFile, removeRegistrationFile, statRegistrationFile } from './file-storage';

type EntityType = 'PROGRAM' | 'EVENT';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/* ─────────────────────────── Naming ─────────────────────────── */

function prefixFor(entityType: EntityType, entityId: string, fieldId: string): string {
  return `${REGISTRATION_FILE_FOLDER}/${entityType}/${entityId}/${fieldId}/`;
}

/** UUID-suffixed id scoped to one question of one program/event. */
export function buildRegistrationFilePublicId(
  entityType: EntityType,
  entityId: string,
  fieldId: string,
): string {
  return `${prefixFor(entityType, entityId, fieldId)}${randomUUID()}`;
}

/**
 * True only for an id this module could have minted FOR THIS question. Checked
 * before touching storage so an applicant cannot point an answer at any other
 * asset in the account (another event's file, a contract, a pitch deck).
 */
export function isRegistrationFilePublicId(
  publicId: string,
  entityType: EntityType,
  entityId: string,
  fieldId: string,
): boolean {
  const prefix = prefixFor(entityType, entityId, fieldId);
  if (!publicId.startsWith(prefix)) return false;
  return new RegExp(`^${UUID_RE}$`).test(publicId.slice(prefix.length));
}

/**
 * Split a public_id back into the question it belongs to — what cleanup needs
 * to decide whose file this is. Null for anything that is not one of ours.
 */
export function parseRegistrationFilePublicId(
  publicId: string,
): { entityType: EntityType; entityId: string; fieldId: string } | null {
  const m = new RegExp(
    `^${REGISTRATION_FILE_FOLDER.replace(/\//g, '\\/')}\\/(PROGRAM|EVENT)\\/(${UUID_RE})\\/(${UUID_RE})\\/${UUID_RE}$`,
  ).exec(publicId);
  return m ? { entityType: m[1] as EntityType, entityId: m[2]!, fieldId: m[3]! } : null;
}

/* ─────────────────────────── What a file really is ─────────────────────────── */

/**
 * Identify a file by its first bytes. The MIME type a browser reports is
 * whatever the visitor's machine guessed from the extension, so a renamed
 * executable would sail through a type check on it.
 */
export function sniffRegistrationFile(head: Uint8Array): RegistrationFileMime | null {
  if (
    head.length >= 5 &&
    head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d
  ) {
    return 'application/pdf'; // %PDF-
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

export function isAllowedRegistrationFileMime(type: string): type is RegistrationFileMime {
  return (REGISTRATION_FILE_MIMES as readonly string[]).includes(type);
}

/**
 * A name safe to show and to put in a Content-Disposition header later: no
 * path parts, no control characters, bounded length, and an extension that
 * matches what the file really is (the browser sent us an extensionless name).
 */
export function sanitizeRegistrationFileName(
  raw: string | undefined | null,
  contentType: RegistrationFileMime,
): string {
  const ext = contentType === 'application/pdf' ? 'pdf' : 'jpg';
  const base = (raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\/<>:|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.(pdf|jpe?g)$/i, '')
    .slice(0, 100)
    .trim();
  return `${base || 'file'}.${ext}`;
}

/* ─────────────────────────── Errors ─────────────────────────── */

export type RegistrationFileErrorCode =
  | 'INVALID_FILE'
  | 'FILE_NOT_FOUND'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'STORAGE_UNAVAILABLE';

export class RegistrationFileError extends Error {
  constructor(
    public readonly code: RegistrationFileErrorCode,
    public readonly fieldId: string,
    public readonly label: string,
  ) {
    super(`${code}: "${label}"`);
    this.name = 'RegistrationFileError';
  }
}

/** The HTTP answer for a rejected file — shared by every route that calls `resolveFileAnswers`. */
export function registrationFileErrorResponse(err: RegistrationFileError) {
  const details = { fieldId: err.fieldId };
  switch (err.code) {
    case 'FILE_TOO_LARGE':
      return jsonError(413, err.code, `The file for "${err.label}" exceeds the ${MAX_REGISTRATION_FILE_MB} MB limit.`, details);
    case 'UNSUPPORTED_FILE_TYPE':
      return jsonError(415, err.code, `The file for "${err.label}" must be a PDF or a JPG.`, details);
    case 'FILE_NOT_FOUND':
      return jsonError(422, err.code, `The file for "${err.label}" was not uploaded. Please attach it again.`, details);
    case 'STORAGE_UNAVAILABLE':
      return jsonError(503, err.code, 'File storage is unavailable. Please try again later.', details);
    default:
      return jsonError(422, 'INVALID_FILE', `The file for "${err.label}" is not valid. Please attach it again.`, details);
  }
}

/* ─────────────────────────── Who may upload where ─────────────────────────── */

interface UploadTargetData {
  registrationFormFields?: RegistrationFormFieldRecord[];
  programs?: Array<{ id: string; isActive?: boolean }>;
  events?: Array<{ id: string; isActive?: boolean }>;
}

export type UploadTargetResult =
  | { ok: true; field: RegistrationFormFieldRecord }
  | { ok: false; reason: 'ENTITY_NOT_FOUND' | 'FIELD_NOT_FOUND' | 'NOT_A_FILE_FIELD' };

/**
 * May a file be uploaded for this question right now? The listing must exist
 * and be active, and the question must be a FILE question OF THAT listing — a
 * signature is a licence to write into our storage, so it is only issued for a
 * form that is actually asking for one.
 */
export function findUploadTarget(
  data: UploadTargetData,
  entityType: EntityType,
  entityId: string,
  fieldId: string,
): UploadTargetResult {
  const listing = (entityType === 'PROGRAM' ? data.programs : data.events)?.find((l) => l.id === entityId);
  if (!listing || listing.isActive === false) return { ok: false, reason: 'ENTITY_NOT_FOUND' };

  const field = (data.registrationFormFields ?? []).find(
    (f) => f.id === fieldId && f.entityType === entityType && f.entityId === entityId,
  );
  if (!field) return { ok: false, reason: 'FIELD_NOT_FOUND' };
  if (field.type !== 'FILE') return { ok: false, reason: 'NOT_A_FILE_FIELD' };
  return { ok: true, field };
}

/* ─────────────────────────── Verifying answers ─────────────────────────── */

export interface IncomingAnswer {
  fieldId: string;
  value: string | string[];
  /** The name the browser showed — display only, sanitised before it is stored. */
  fileName?: string;
}

/**
 * Turn the answers a visitor submitted into the answers we store.
 *
 *   • Non-file answers pass through untouched (minus any `fileName`).
 *   • A FILE answer must be a public_id minted for this exact question, point at
 *     a file that exists, fit the size limit, and BE a PDF or JPG by its bytes.
 *     It is stored with the facts WE measured, never the client's.
 *   • An empty FILE answer is dropped, so "required" sees it as missing.
 *
 * A file that fails verification is deleted: it was uploaded for this
 * submission and nothing else will ever reference it.
 *
 * Throws {@link RegistrationFileError}; the caller maps it with
 * {@link registrationFileErrorResponse}.
 */
export async function resolveFileAnswers(
  data: { registrationFormFields?: RegistrationFormFieldRecord[] },
  entityType: EntityType,
  entityId: string,
  answers: IncomingAnswer[],
): Promise<RegistrationAnswerRecord[]> {
  const fields = (data.registrationFormFields ?? []).filter(
    (f) => f.entityType === entityType && f.entityId === entityId,
  );
  const out: RegistrationAnswerRecord[] = [];
  const seenFileFields = new Set<string>();

  for (const answer of answers) {
    const field = fields.find((f) => f.id === answer.fieldId);
    if (field?.type !== 'FILE') {
      out.push({ fieldId: answer.fieldId, value: answer.value });
      continue;
    }
    if (seenFileFields.has(field.id)) continue;
    seenFileFields.add(field.id);

    const fail = (code: RegistrationFileErrorCode) => new RegistrationFileError(code, field.id, field.label);

    if (Array.isArray(answer.value)) throw fail('INVALID_FILE');
    const publicId = answer.value.trim();
    if (!publicId) continue;
    if (!isRegistrationFilePublicId(publicId, entityType, entityId, field.id)) throw fail('INVALID_FILE');

    let stat: { bytes: number } | null;
    let head: Buffer | null = null;
    try {
      stat = await statRegistrationFile(publicId);
      if (stat && stat.bytes > 0 && stat.bytes <= MAX_REGISTRATION_FILE_BYTES) {
        head = await headRegistrationFile(publicId, 8);
      }
    } catch (err) {
      console.error('[registration-files] Storage lookup failed:', err);
      throw fail('STORAGE_UNAVAILABLE');
    }
    if (!stat || stat.bytes === 0) throw fail('FILE_NOT_FOUND');
    if (stat.bytes > MAX_REGISTRATION_FILE_BYTES) {
      await removeRegistrationFile(publicId);
      throw fail('FILE_TOO_LARGE');
    }

    const contentType = head ? sniffRegistrationFile(head) : null;
    if (!contentType) {
      await removeRegistrationFile(publicId);
      throw fail(head ? 'UNSUPPORTED_FILE_TYPE' : 'STORAGE_UNAVAILABLE');
    }

    const file: RegistrationAnswerFile = {
      name: sanitizeRegistrationFileName(answer.fileName, contentType),
      bytes: stat.bytes,
      contentType,
    };
    out.push({ fieldId: field.id, value: publicId, file });
  }

  return out;
}

/** Public_ids of every file the answers point at — what a delete path must remove. */
export function registrationFileIds(
  answers: ReadonlyArray<{ value: string | string[]; file?: unknown }>,
): string[] {
  return answers
    .filter((a) => a.file && typeof a.value === 'string')
    .map((a) => a.value as string);
}

/** Remove the files behind a set of answers. Best effort; never throws. */
export async function removeRegistrationFiles(
  answers: ReadonlyArray<{ value: string | string[]; file?: unknown }>,
): Promise<void> {
  await Promise.all(registrationFileIds(answers).map((id) => removeRegistrationFile(id)));
}
