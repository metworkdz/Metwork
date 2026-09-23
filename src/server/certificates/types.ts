/**
 * Participation certificates — the shapes shared by the renderer, the settings
 * stored on a program, and the routes that issue them.
 *
 * Pure types, no runtime: the editor on the client imports this file too.
 */

/**
 * Every template speaks the visual language of the certificate Metwork already
 * hands out — heavy geometric title, a notched ribbon under it, the logo top
 * left, a single hand-signing line bottom right — and differs only in the
 * decoration around it.
 */
export type CertificateTemplate = 'VAGUES' | 'DIAGONALES' | 'CADRE' | 'LATERAL';

/**
 * The typefaces a host may pick. All are open-licensed and vendored as STATIC
 * files: fontkit cannot instance a variable font, and one silently falls back
 * to Helvetica. The Metwork model is set in Stem, a commercial face that
 * cannot be redistributed; Montserrat is its closest free match.
 */
export type CertificateFont = 'MONTSERRAT' | 'POPPINS' | 'LATO' | 'SPECTRAL' | 'CORMORANT';

/** The model is A5 landscape; A4 is offered for hosts who frame them. */
export type CertificatePageSize = 'A5' | 'A4';

/**
 * PRINT leaves the signature lines blank and draws no stamp — the certificate
 * is printed, then signed and stamped by hand, which is how Metwork issues
 * them today. DIGITAL draws the signature images and, if chosen, the stamp,
 * because a certificate emailed after an online training cannot be stamped.
 */
export type CertificateMode = 'PRINT' | 'DIGITAL';

export interface CertificateSignatory {
  /** Printed under the line. May be empty — the model shows only "SIGNATURE". */
  name: string;
  /** Printed as the line's label, uppercase. Empty → "SIGNATURE". */
  role: string;
  /** Drawn or uploaded signature. Used in DIGITAL mode only. */
  imageUrl?: string | null;
}

export interface CertificateSettings {
  template: CertificateTemplate;
  font: CertificateFont;
  pageSize: CertificatePageSize;
  /** Ribbon and the main decorative band, "#rrggbb". */
  primaryColor: string;
  /** The deepest band, in the corner, "#rrggbb". */
  darkColor: string;
  /** Big word at the top — "ATTESTATION". */
  title: string;
  /** Inside the ribbon — "DE PARTICIPATION". */
  subtitle: string;
  /** Line above the name — "Nous certifions par la présente que". */
  intro: string;
  /**
   * The paragraph under the name. Takes {variables} (see CERTIFICATE_VARIABLES),
   * **bold** runs — the model sets the date in bold — and [[optional]]
   * passages, dropped whole when a variable inside them is empty, so a program
   * with no trainer does not print "et animée par ,".
   */
  body: string;
  /** Fills {formateur}. The program does not store who taught it. */
  trainerName?: string | null;
  /** Fills {heures}, e.g. "24 heures". */
  hours?: string | null;
  /** One or two. */
  signatories: CertificateSignatory[];
  /** Print the organizer's stamp — DIGITAL mode only. */
  showStamp: boolean;
  /** Certificate number and a QR code linking to its public verification page. */
  showVerification: boolean;
}

/** What the program contributes to the text. */
export interface CertificateContext {
  programTitle: string;
  /** The incubator's or the consultant's name — fills {organisme}. */
  organizer: string;
  city: string;
  /** ISO timestamps, stored noon-anchored so the day survives the timezone. */
  startDate: string;
  endDate: string;
}

export type Civility = 'M.' | 'Mme' | null;

export interface CertificateRecipient {
  fullName: string;
  /** Printed before the name, not uppercased — "Mme. AMARA DJIHENE HIND". */
  civility?: Civility;
  /** "ATT-2026-0041". Absent until the certificate is issued. */
  number?: string | null;
  /** Encoded in the QR. */
  verifyUrl?: string | null;
}

/** The variables a host can put in the body, and what each becomes. */
export const CERTIFICATE_VARIABLES = [
  '{programme}',
  '{organisme}',
  '{formateur}',
  '{dates}',
  '{date}',
  '{ville}',
  '{heures}',
  '{nom}',
] as const;

/**
 * The Metwork model, as settings. A new program starts here — or from the
 * host's previous program, once they have one.
 */
export const DEFAULT_CERTIFICATE_SETTINGS: CertificateSettings = {
  template: 'VAGUES',
  font: 'MONTSERRAT',
  pageSize: 'A5',
  primaryColor: '#3fb34f',
  darkColor: '#0b7a3d',
  title: 'ATTESTATION',
  subtitle: 'DE PARTICIPATION',
  intro: 'Nous certifions par la présente que',
  body:
    'A participé avec succès à la formation « {programme} », organisée par {organisme}'
    + '[[, et animée par {formateur}]], tenue **{dates}**, à {ville}, Algérie.',
  trainerName: null,
  hours: null,
  signatories: [{ name: '', role: 'Signature', imageUrl: null }],
  showStamp: false,
  showVerification: true,
};
