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

/**
 * Files attached to a registration form answer (e.g. a startup's pitch deck on
 * an event application). Private: stored as Cloudinary `authenticated` assets
 * and readable only by the owning incubator / consultant.
 *
 * Like pitch decks they go browser → Cloudinary directly, so the 10 MB ceiling
 * is not bound by Vercel's 4.5 MB request-body cap.
 */
export const MAX_REGISTRATION_FILE_BYTES = 10 * 1024 * 1024;

/** Human-readable form of {@link MAX_REGISTRATION_FILE_BYTES}, for UI copy + errors. */
export const MAX_REGISTRATION_FILE_MB = MAX_REGISTRATION_FILE_BYTES / (1024 * 1024);

/** The only MIME types accepted for a registration file: a PDF or a JPG. */
export const REGISTRATION_FILE_MIMES = ['application/pdf', 'image/jpeg'] as const;
export type RegistrationFileMime = (typeof REGISTRATION_FILE_MIMES)[number];

/** Value for an `<input type="file" accept>`. */
export const REGISTRATION_FILE_ACCEPT = '.pdf,.jpg,.jpeg,application/pdf,image/jpeg';

/** Cloudinary folder every registration file lands in. The signature is scoped to it. */
export const REGISTRATION_FILE_FOLDER = 'metwork/registration-files';
