/**
 * The typefaces a certificate can be set in.
 *
 * Kept in their OWN directory on purpose. nft resolves
 * `path.join(process.cwd(), '<dir>')` and traces the whole directory into
 * every route that imports the loader — verified by building with no
 * outputFileTracingIncludes at all. Were these ~7 MB of faces added to
 * src/server/pdf/fonts, every invoice, receipt and contract function would
 * carry them. Here, only the certificate routes do.
 *
 * Montserrat's three text weights already live in src/server/pdf/fonts for the
 * invoices and are read from there rather than duplicated.
 *
 * Only the chosen family is registered on a document — four faces, not twenty.
 */
import fs from 'node:fs';
import path from 'node:path';
import type PDFDocument from 'pdfkit';

import type { CertificateFont } from './types';

type Doc = InstanceType<typeof PDFDocument>;

const CERT_DIR = path.join(process.cwd(), 'src/server/certificates/fonts');
const PDF_DIR = path.join(process.cwd(), 'src/server/pdf/fonts');

/**
 * Four roles a certificate needs. Where a family has no exact weight the
 * nearest one stands in — Lato has no Medium, Cormorant no Regular worth using
 * at body size.
 */
export type FontRole = 'regular' | 'medium' | 'bold' | 'heavy';

type Face = { dir: 'cert' | 'pdf'; file: string };

export const CERTIFICATE_FONT_FILES: Record<CertificateFont, Record<FontRole, Face>> = {
  MONTSERRAT: {
    regular: { dir: 'pdf', file: 'Montserrat-Regular.ttf' },
    medium: { dir: 'pdf', file: 'Montserrat-Medium.ttf' },
    bold: { dir: 'pdf', file: 'Montserrat-Bold.ttf' },
    heavy: { dir: 'cert', file: 'Montserrat-ExtraBold.ttf' },
  },
  POPPINS: {
    regular: { dir: 'cert', file: 'Poppins-Regular.ttf' },
    medium: { dir: 'cert', file: 'Poppins-Medium.ttf' },
    bold: { dir: 'cert', file: 'Poppins-Bold.ttf' },
    heavy: { dir: 'cert', file: 'Poppins-ExtraBold.ttf' },
  },
  LATO: {
    regular: { dir: 'cert', file: 'Lato-Regular.ttf' },
    medium: { dir: 'cert', file: 'Lato-Regular.ttf' },
    bold: { dir: 'cert', file: 'Lato-Bold.ttf' },
    heavy: { dir: 'cert', file: 'Lato-Black.ttf' },
  },
  SPECTRAL: {
    regular: { dir: 'cert', file: 'Spectral-Regular.ttf' },
    medium: { dir: 'cert', file: 'Spectral-Medium.ttf' },
    bold: { dir: 'cert', file: 'Spectral-Bold.ttf' },
    heavy: { dir: 'cert', file: 'Spectral-ExtraBold.ttf' },
  },
  CORMORANT: {
    regular: { dir: 'cert', file: 'CormorantGaramond-Medium.ttf' },
    medium: { dir: 'cert', file: 'CormorantGaramond-SemiBold.ttf' },
    bold: { dir: 'cert', file: 'CormorantGaramond-Bold.ttf' },
    heavy: { dir: 'cert', file: 'CormorantGaramond-Bold.ttf' },
  },
};

/** Shown in the picker. */
export const CERTIFICATE_FONT_LABELS: Record<CertificateFont, string> = {
  MONTSERRAT: 'Montserrat',
  POPPINS: 'Poppins',
  LATO: 'Lato',
  SPECTRAL: 'Spectral',
  CORMORANT: 'Cormorant Garamond',
};

const ARABIC_FACE: Face = { dir: 'pdf', file: 'Amiri-Regular.ttf' };

const cache = new Map<string, Buffer>();
function load(face: Face): Buffer {
  const full = path.join(face.dir === 'cert' ? CERT_DIR : PDF_DIR, face.file);
  const hit = cache.get(full);
  if (hit) return hit;
  // Unlike the invoice loader this THROWS on a missing face. A certificate in
  // the wrong typeface is the kind of error nobody notices until it is framed
  // on someone's wall; failing the request loudly is the better outcome.
  const buf = fs.readFileSync(full);
  cache.set(full, buf);
  return buf;
}

/** The pdfkit font name for a role, after `registerCertificateFonts`. */
export function certFont(role: FontRole | 'arabic'): string {
  return `Cert-${role}`;
}

/** Register the chosen family (and the Arabic fallback) on a document. */
export function registerCertificateFonts(doc: Doc, family: CertificateFont): void {
  const faces = CERTIFICATE_FONT_FILES[family] ?? CERTIFICATE_FONT_FILES.MONTSERRAT;
  for (const role of ['regular', 'medium', 'bold', 'heavy'] as const) {
    doc.registerFont(certFont(role), load(faces[role]));
  }
  doc.registerFont(certFont('arabic'), load(ARABIC_FACE));
}

/** Every file the registry names, for the "is it really on disk" test. */
export function allCertificateFontPaths(): string[] {
  const faces = Object.values(CERTIFICATE_FONT_FILES).flatMap((f) => Object.values(f));
  return [...new Set([...faces, ARABIC_FACE].map((f) => path.join(f.dir === 'cert' ? CERT_DIR : PDF_DIR, f.file)))];
}
