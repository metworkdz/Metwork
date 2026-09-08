/**
 * Space-rental contract PDF (coworking, training room, private office,
 * domiciliation).
 *
 * Renders a filled contract — variables already substituted upstream by the
 * variable engine — as the SAME document the consultant contract is: wordmark
 * top-right, centred underlined title, Times body at 12 pt with 14 pt article
 * headings, "Page N / T" in the foot. That shared look lives in
 * `@/server/pdf/contract-layout`; this module owns only what is particular to a
 * rental contract, which is the title and contract-number line.
 *
 * NO SIGNATURE BLOCK is drawn, and there is no e-signature. These contracts are
 * generated, downloaded and signed by hand, and the templates already end with
 * their own "Pour EURL METWORK / Nom / Signature : ____" lines.
 *
 * THE TEMPLATE IS THE WHOLE DOCUMENT. This module used to also draw a
 * letterhead block — company name, RC, NIF, address — above the body. Dropped
 * deliberately: the real templates open by naming the parties in prose ("EURL
 * METWORK, société à responsabilité unipersonnelle …, RC …, NIF …"), so the
 * generated block printed the same identity a second time. Anyone who prefers
 * the other arrangement still has the `{{incubator_name}}`,
 * `{{incubator_address}}`, `{{incubator_cr}}` and `{{incubator_nif}}` tokens.
 * This is the same decision the consultant contract already made, for the same
 * reason.
 *
 * Arabic ('ar') templates render right-to-left in Amiri: Tinos (the Times face)
 * has no Arabic coverage at all, and fontkit applies Arabic contextual shaping
 * automatically for embedded OpenType fonts. Amiri also covers Latin, so an
 * Arabic client name inside a French contract still renders — see
 * `typographyFor` and `hasArabic`.
 */
import type PDFDocument from 'pdfkit';
import type { IncubatorRecord } from '@/server/db/store';
import {
  CONTENT_W,
  DARK,
  GRAY,
  MARGIN,
  collectBuffer,
  fetchImageBuffer,
  makeDoc,
} from '@/server/notifications/receipt';
import { hasArabic } from '@/server/pdf/fonts';
import {
  SIZE,
  drawContractLogo,
  drawPageNumbers,
  loadBrandLogo,
  typographyFor,
  writeContractBody,
} from '@/server/pdf/contract-layout';
import type { ContractLang } from './variables';

/* ─────────────────── i18n labels ─────────────────── */

const LABELS: Record<ContractLang, { title: string; number: string; issuedOn: string }> = {
  en: { title: 'CONTRACT', number: 'No.', issuedOn: 'Issued on' },
  fr: { title: 'CONTRAT',  number: 'N°',  issuedOn: 'Établi le' },
  ar: { title: 'عقد',      number: 'رقم', issuedOn: 'حرر في' },
};

/* ─────────────────── Input ─────────────────── */

export interface ContractPdfInput {
  incubator: Pick<IncubatorRecord, 'name' | 'logoUrl'>;
  lang: ContractLang;
  /** Displayed contract title (the template name). Falls back to a generic word. */
  title?: string;
  /** Unique contract number (from the variable engine). */
  contractNumber: string;
  /** Fully-rendered contract body — `{{tokens}}` already substituted. */
  body: string;
  /**
   * Is the issuing party Metwork itself?
   *
   * Metwork's own spaces are let under the admin-as-incubator profile, and
   * those contracts carry the Metwork wordmark. A third-party incubator letting
   * their own space is a different legal person, so their contract carries
   * THEIR logo — putting our mark on someone else's contract would misstate who
   * is bound by it. Decided by the caller, which is the only place that knows.
   */
  metworkBrand?: boolean;
}

/* ─────────────────── Main ─────────────────── */

type Doc = InstanceType<typeof PDFDocument>;

/**
 * Title and contract number, centred under the wordmark.
 *
 * The title is the template's own name — "CONTRAT DE LOCATION D'ESPACE DE
 * COWORKING", "CONTRAT DE LOCATION DE LA SALLE DE FORMATION" — so a new kind of
 * contract needs a new template, not new code.
 */
function drawTitle(doc: Doc, input: ContractPdfInput, bold: string, regular: string): void {
  const isAr = input.lang === 'ar';
  const labels = LABELS[input.lang];
  const raw = (input.title && input.title.trim()) || labels.title;

  doc.font(bold).fillColor(DARK).fontSize(SIZE.title)
    .text(isAr ? raw : raw.toUpperCase(), MARGIN, doc.y, {
      width: CONTENT_W,
      align: 'center',
      underline: true,
    });

  const today = new Date().toLocaleDateString(
    input.lang === 'fr' ? 'fr-DZ' : input.lang === 'ar' ? 'ar-DZ' : 'en-GB',
    { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' },
  );
  doc.moveDown(0.4);
  doc.font(regular).fillColor(GRAY).fontSize(9)
    .text(`${labels.number} ${input.contractNumber}  ·  ${labels.issuedOn} ${today}`, MARGIN, doc.y, {
      width: CONTENT_W,
      align: 'center',
      underline: false,
    });
  doc.moveDown(1.6);
}

export async function generateContractPdf(input: ContractPdfInput): Promise<Buffer> {
  // Amiri whenever the document IS Arabic or merely contains Arabic (an Arabic
  // client name in a French contract is routine in Algeria).
  const typo = typographyFor(input.lang === 'ar' || hasArabic(input.body));

  // Metwork's mark is embedded in the bundle; an incubator's is a remote URL,
  // and the fetch is null-safe — a logo that won't load must not stop a
  // contract from being generated.
  const logo = input.metworkBrand ? loadBrandLogo() : await fetchImageBuffer(input.incubator.logoUrl);

  // bufferPages: the "Page N / T" footer can only be written once the total is
  // known, i.e. after the whole body has flowed.
  const doc = makeDoc({ bufferPages: true });

  // Top-right in every language, including Arabic: this is the platform's
  // letterhead position, and the two contract documents are meant to be
  // recognisably the same stationery.
  drawContractLogo(doc, logo);
  drawTitle(doc, input, typo.bold, typo.regular);

  writeContractBody(doc, input.body, typo, { startY: doc.y });

  drawPageNumbers(doc, typo.regular);

  return collectBuffer(doc);
}
