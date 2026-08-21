/**
 * Upload limits shared between client components and API routes.
 *
 * Deliberately dependency-free (no `cloudinary` import) so client bundles can
 * import it without pulling the Cloudinary SDK into the browser.
 *
 * Scoped per upload kind on purpose: the pitch-deck limit must never be
 * repurposed for avatars / logos / space images, whose server routes keep
 * using `MAX_UPLOAD_BYTES` from `@/lib/cloudinary`.
 */

/**
 * Pitch decks upload straight from the browser to Cloudinary (see
 * `/api/startups/:id/pitch-deck/signature`), so they are NOT bound by Vercel's
 * 4.5 MB serverless request-body cap the way the image routes are.
 */
export const MAX_PITCH_DECK_BYTES = 10 * 1024 * 1024;

/** Human-readable form of {@link MAX_PITCH_DECK_BYTES}, for UI copy + errors. */
export const MAX_PITCH_DECK_MB = MAX_PITCH_DECK_BYTES / (1024 * 1024);

/** The only MIME type accepted for a pitch deck. */
export const PITCH_DECK_MIME = 'application/pdf';

/** Cloudinary folder every pitch deck lands in. The signature is scoped to it. */
export const PITCH_DECK_FOLDER = 'metwork/pitch-decks';
