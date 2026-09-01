/**
 * One place that turns PDF bytes into an HTTP response a browser will RENDER.
 *
 * The headers here are the whole point, and each is load-bearing:
 *   • `application/pdf` — without it the browser downloads instead of showing.
 *   • `inline` — `attachment` is what made the signed contract open as a blank
 *     tab; the consultant is meant to read this, not receive a mystery file.
 *   • a filename ending in `.pdf` — our Cloudinary public_ids are
 *     deliberately extensionless, so the name has to be supplied here or the
 *     saved file will not open by double-click.
 *   • `no-store` — these are short-lived, per-request documents carrying the
 *     consultant's phone, bank details and signature; they must not sit in a
 *     shared cache.
 */

/** A filename that is safe in a Content-Disposition header. */
function sanitize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/** `Contrat-METWORK-<name>-<date>.pdf`, always ASCII-safe. */
export function contractPdfFilename(name: string, signedAt?: string | null): string {
  const date = (signedAt ?? new Date().toISOString()).slice(0, 10);
  const who = sanitize(name) || 'consultant';
  return `Contrat-METWORK-${who}-${date}.pdf`;
}

/** Draft filename — visibly not the executed document. */
export function contractPreviewFilename(name: string): string {
  const who = sanitize(name) || 'consultant';
  return `Contrat-METWORK-${who}-PROJET.pdf`;
}

export function pdfResponse(bytes: Buffer, filename: string): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
