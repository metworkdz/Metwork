/**
 * Participation certificates → PDF, one page per participant.
 *
 * THE LAYOUT IS THE METWORK MODEL'S. Every position below was measured off the
 * certificate Metwork already hands out (A5 landscape, set in Stem): the logo
 * top left, "ATTESTATION" heavy and centred, "DE PARTICIPATION" white in a
 * notched ribbon, the intro line, the name in bold capitals over a hairline,
 * the paragraph with the date in bold, and one signing line bottom right. The
 * templates differ only in the decoration drawn behind that — the model's own
 * sweeping bands being the first of them.
 *
 * Coordinates are written for A5 landscape and scaled, so A4 is the same
 * certificate, larger.
 *
 * Nothing here decides WHO gets a certificate or what number it carries —
 * callers pass the recipients in. This only draws.
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import { collectBuffer } from '@/server/notifications/receipt';
import { fetchCertificateImage } from './images';
import { certFont, registerCertificateFonts, type FontRole } from './fonts';
import {
  certificateNameParts,
  certificateTones,
  certificateVariables,
  fillCertificateText,
  isArabicText,
  parseBoldRuns,
  type TextRun,
} from './text';
import type {
  CertificateContext,
  CertificateMode,
  CertificateRecipient,
  CertificateSettings,
  CertificateTemplate,
} from './types';

type Doc = InstanceType<typeof PDFDocument>;
type Tones = ReturnType<typeof certificateTones>;

const PAGE: Record<CertificateSettings['pageSize'], [number, number]> = {
  A5: [595.28, 419.53],
  A4: [841.89, 595.28],
};
/** Width everything below is measured against. */
const BASE_W = 595.28;

const INK = '#141414';
const BODY_INK = '#1f1f1f';
const HAIRLINE = '#8f8f8f';
const LABEL_INK = '#474747';
const WHITE = '#ffffff';

/* ─────────────────── Layout per template ─────────────────── */

interface Layout {
  /** Horizontal centre of the text column. */
  cx: number;
  /** Widest a paragraph line may run — the first line. */
  bodyW: number;
  /**
   * How much narrower each following line is. The model's paragraph is an
   * inverted pyramid, and that shape is what keeps it clear of the sweep that
   * climbs in from the bottom-left corner.
   */
  taper: number;
  /** Right edge of the first signing line. */
  sigRight: number;
  /** Where the number and QR sit — whichever corner the decoration leaves white. */
  verify: 'right' | 'left';
  logoX: number;
  logoY: number;
}

function layoutFor(template: CertificateTemplate): Layout {
  const centred: Layout = {
    cx: BASE_W / 2, bodyW: 410, taper: 28, sigRight: 555, verify: 'right', logoX: 29.5, logoY: 36.6,
  };
  // Nothing encroaches inside a frame, so the paragraph keeps its width.
  if (template === 'CADRE') return { ...centred, taper: 0, bodyW: 440, logoX: 40, logoY: 40, sigRight: 545 };
  // The side band takes the right-hand edge, so the column moves left and the
  // number drops to the free corner.
  if (template === 'LATERAL') return { ...centred, cx: 262, bodyW: 380, taper: 0, sigRight: 470, verify: 'left' };
  return centred;
}

/* ─────────────────── Decoration ─────────────────── */

/**
 * The model's sweeping bands. Nested regions, lightest and largest first, each
 * bounded by one Bézier from a page edge to the adjacent edge and closed
 * through the corner; a white region between two of them leaves the thin
 * light line the model has along the inside of each sweep.
 *
 * The curves BOW TOWARD THEIR CORNER — the white of the page bulges into the
 * green, not the other way round. Bowing them outward (the first attempt)
 * swells every band into the middle of the page and straight through the
 * name. Each pair is [where it meets one edge, where it meets the other],
 * measured off the model.
 */
function drawWaves(doc: Doc, W: number, H: number, s: number, t: Tones): void {
  const topRight: Array<[string, number, number]> = [
    [t.pale, 245, 244], [WHITE, 254, 234], [t.soft, 342, 226], [t.mid, 368, 204], [t.dark, 476, 106],
  ];
  for (const [color, x0b, y3b] of topRight) {
    const x0 = x0b * s; const y3 = y3b * s; const dx = W - x0;
    doc.moveTo(x0, 0)
      .bezierCurveTo(x0 + 0.42 * dx, 0.16 * y3, x0 + 0.84 * dx, 0.52 * y3, W, y3)
      .lineTo(W, 0).closePath().fill(color);
  }
  const bottomLeft: Array<[string, number, number]> = [
    [t.pale, 106, 296], [WHITE, 116, 287], [t.soft, 124, 256], [t.mid, 158, 226], [t.dark, 254, 157],
  ];
  for (const [color, yLb, xBb] of bottomLeft) {
    const yL = yLb * s; const xB = xBb * s; const dy = H - yL;
    doc.moveTo(0, yL)
      .bezierCurveTo(0.16 * xB, yL + 0.42 * dy, 0.52 * xB, yL + 0.84 * dy, xB, H)
      .lineTo(0, H).closePath().fill(color);
  }
}

/** The same composition in straight cuts — sharper, more architectural. */
function drawDiagonals(doc: Doc, W: number, H: number, s: number, t: Tones): void {
  // A straight cut runs further from its corner than the model's bowed one,
  // so these sit tighter to keep the title and the paragraph just as clear.
  const topRight: Array<[string, number, number]> = [
    [t.pale, 300, 180], [WHITE, 312, 170], [t.soft, 380, 150], [t.mid, 410, 128], [t.dark, 490, 70],
  ];
  for (const [color, x0b, y3b] of topRight) {
    doc.moveTo(x0b * s, 0).lineTo(W, 0).lineTo(W, y3b * s).closePath().fill(color);
  }
  const bottomLeft: Array<[string, number, number]> = [
    [t.pale, 170, 220], [WHITE, 182, 208], [t.soft, 206, 186], [t.mid, 236, 160], [t.dark, 300, 104],
  ];
  for (const [color, yLb, xBb] of bottomLeft) {
    doc.moveTo(0, yLb * s).lineTo(0, H).lineTo(xBb * s, H).closePath().fill(color);
  }
}

/** A framed certificate: deep outer rule, fine inner rule, solid corner blocks. */
function drawFrame(doc: Doc, W: number, H: number, s: number, t: Tones): void {
  const outer = 14 * s;
  const inner = 22 * s;
  doc.rect(outer, outer, W - 2 * outer, H - 2 * outer).lineWidth(5 * s).strokeColor(t.dark).stroke();
  doc.rect(inner, inner, W - 2 * inner, H - 2 * inner).lineWidth(0.9 * s).strokeColor(t.mid).stroke();
  const c = 34 * s;
  const corners: Array<[number, number, number, number]> = [
    [outer, outer, 1, 1], [W - outer, outer, -1, 1], [outer, H - outer, 1, -1], [W - outer, H - outer, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    doc.moveTo(x, y).lineTo(x + dx * c, y).lineTo(x, y + dy * c).closePath().fill(t.mid);
  }
}

/** One tall wave down the right-hand edge, layered like the model's corners. */
function drawSideBand(doc: Doc, W: number, H: number, s: number, t: Tones): void {
  const bands: Array<[string, number, number]> = [
    [t.pale, 128, 84], [WHITE, 118, 74], [t.soft, 104, 60], [t.mid, 88, 44], [t.dark, 64, 22],
  ];
  for (const [color, topInset, bottomInset] of bands) {
    const xa = W - topInset * s;
    const xb = W - bottomInset * s;
    doc.moveTo(xa, 0)
      .bezierCurveTo(xa - 46 * s, H * 0.34, xb + 46 * s, H * 0.66, xb, H)
      .lineTo(W, H).lineTo(W, 0).closePath().fill(color);
  }
}

const DECORATION: Record<CertificateTemplate, (doc: Doc, W: number, H: number, s: number, t: Tones) => void> = {
  VAGUES: drawWaves,
  DIAGONALES: drawDiagonals,
  CADRE: drawFrame,
  LATERAL: drawSideBand,
};

/* ─────────────────── Text helpers ─────────────────── */

function fontFor(role: FontRole, text: string): string {
  return isArabicText(text) ? certFont('arabic') : certFont(role);
}

/** Largest size ≤ `size` at which `text` fits `maxW`, down to `min`. */
function fitSize(doc: Doc, text: string, role: FontRole, size: number, maxW: number, min: number): number {
  let current = size;
  doc.font(fontFor(role, text));
  while (current > min && doc.fontSize(current).widthOfString(text) > maxW) current -= 0.5;
  return current;
}

function centredLine(
  doc: Doc, text: string, role: FontRole, size: number, cx: number, baseline: number, color: string,
  characterSpacing = 0,
): number {
  doc.font(fontFor(role, text)).fontSize(size).fillColor(color);
  const w = doc.widthOfString(text, { characterSpacing });
  doc.text(text, cx - w / 2, baseline, { lineBreak: false, baseline: 'alphabetic', characterSpacing });
  return w;
}

/* ─────────────────── Mixed Latin / Arabic lines ─────────────────── */

/**
 * pdfkit has no bidirectional-text support. Its shaper handles ONE Arabic word
 * correctly — joined letters, right-to-left — but lays a phrase's words out
 * left to right, so "أمينة بن علي" printed as "علي بن أمينة", and a French line
 * holding an Arabic title came out scrambled around its guillemets.
 *
 * So the reordering the Unicode bidi algorithm would do is done here, per
 * line, which is also where the algorithm applies it: every run of Arabic
 * words on a line is reversed, while the neutral punctuation around it — « »,
 * the comma after — stays where French puts it. Each word is still drawn on
 * its own, so the shaper only ever sees a single word.
 */
const ARABIC_CHAR = '\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF';
const EDGE_NEUTRALS = new RegExp(`^([^${ARABIC_CHAR}]*)([\\s\\S]*?)([^${ARABIC_CHAR}]*)$`);

interface Glyphrun { text: string; role: FontRole; w: number; spaceBefore: boolean; rtl: boolean }

function measureRun(doc: Doc, text: string, role: FontRole, size: number): number {
  doc.font(fontFor(role, text)).fontSize(size);
  return doc.widthOfString(text);
}

/** Split "«\u00a0مدخل" into the neutral "«\u00a0" and the Arabic "مدخل". */
function splitEdges(doc: Doc, run: Omit<Glyphrun, 'w' | 'rtl'>, size: number): Glyphrun[] {
  const mk = (text: string, spaceBefore: boolean): Glyphrun => ({
    text, role: run.role, spaceBefore, rtl: isArabicText(text), w: measureRun(doc, text, run.role, size),
  });
  if (!isArabicText(run.text)) return [mk(run.text, run.spaceBefore)];
  const m = EDGE_NEUTRALS.exec(run.text);
  if (!m) return [mk(run.text, run.spaceBefore)];
  const [, lead = '', core = '', trail = ''] = m;
  const out: Glyphrun[] = [];
  if (lead) out.push(mk(lead, run.spaceBefore));
  out.push(mk(core, lead ? false : run.spaceBefore));
  if (trail) out.push(mk(trail, false));
  return out;
}

/** Reverse each maximal run of Arabic pieces, keeping the gaps between them. */
function reorderLine(pieces: Glyphrun[]): Glyphrun[] {
  const out: Glyphrun[] = [];
  let i = 0;
  while (i < pieces.length) {
    if (!pieces[i]!.rtl) { out.push(pieces[i]!); i++; continue; }
    let j = i;
    while (j + 1 < pieces.length && pieces[j + 1]!.rtl) j++;
    const group = pieces.slice(i, j + 1);
    // The gap in front of the group stays in front; the gaps inside it are
    // mirrored along with the words.
    const gaps = group.map((g) => g.spaceBefore);
    const reversed = [...group].reverse().map((g, k) => ({
      ...g, spaceBefore: k === 0 ? gaps[0]! : gaps[group.length - k]!,
    }));
    out.push(...reversed);
    i = j + 1;
  }
  return out;
}

/** Draw one line of pieces centred on `cx`, in visual order. Returns its width. */
function drawLine(
  doc: Doc, pieces: Array<{ text: string; role: FontRole; spaceBefore: boolean }>, size: number,
  cx: number, baseline: number, color: string,
): number {
  const split = pieces.filter((p) => p.text).flatMap((p) => splitEdges(doc, p, size));
  const visual = reorderLine(split);
  doc.font(certFont('regular')).fontSize(size);
  const space = doc.widthOfString(' ');
  const total = visual.reduce((a, p, k) => a + p.w + (k > 0 && p.spaceBefore ? space : 0), 0);
  let x = cx - total / 2;
  visual.forEach((p, k) => {
    if (k > 0 && p.spaceBefore) x += space;
    doc.font(fontFor(p.role, p.text)).fontSize(size).fillColor(color)
      .text(p.text, x, baseline, { lineBreak: false, baseline: 'alphabetic' });
    x += p.w;
  });
  return total;
}

/** "Mme. أمينة بن علي" as pieces — words split so each can be reordered. */
function namePieces(civility: string, name: string): Array<{ text: string; role: FontRole; spaceBefore: boolean }> {
  const words = [civility, ...name.split(' ')].filter(Boolean);
  return words.map((text, i) => ({ text, role: 'bold' as FontRole, spaceBefore: i > 0 }));
}

function lineWidth(doc: Doc, pieces: Array<{ text: string; role: FontRole; spaceBefore: boolean }>, size: number): number {
  doc.font(certFont('regular')).fontSize(size);
  const space = doc.widthOfString(' ');
  return pieces.reduce((a, p, k) => a + measureRun(doc, p.text, p.role, size) + (k > 0 && p.spaceBefore ? space : 0), 0);
}

interface Piece { text: string; role: FontRole; w: number }
interface Word { pieces: Piece[]; w: number }

/**
 * Lay the paragraph out word by word.
 *
 * Done by hand rather than with pdfkit's `continued` text, because the model
 * mixes weights inside a centred line ("tenue **le 14 février 2026**, à Oran")
 * and pdfkit's centring of mixed-font runs is unreliable. A piece glued to the
 * previous one — the comma after the bold date — never starts a new line.
 */
/** A forced line break — the host typed a newline. */
const BREAK: Word = { pieces: [], w: 0 };

function layoutParagraph(
  doc: Doc, runs: TextRun[], size: number, widthOf: (line: number) => number,
): { lines: Word[][]; space: number } {
  const words: Word[] = [];
  let glue = false;
  for (const run of runs) {
    const role: FontRole = run.bold ? 'bold' : 'regular';
    // Split on ordinary spaces and newlines ONLY. A no-break space (U+00A0)
    // stays inside its token, which is how a date like "le 14 février 2026"
    // is kept on one line — splitting on \s would break it right back up.
    const tokens = run.text.split(/([ \t]+|\n)/);
    for (const tok of tokens) {
      if (tok === '') continue;
      if (tok === '\n') { words.push(BREAK); glue = false; continue; }
      if (/^[ \t]+$/.test(tok)) { glue = false; continue; }
      const prev = words[words.length - 1];
      doc.font(fontFor(role, tok)).fontSize(size);
      const piece: Piece = { text: tok, role, w: doc.widthOfString(tok) };
      if (glue && prev && prev !== BREAK) { prev.pieces.push(piece); prev.w += piece.w; }
      else words.push({ pieces: [piece], w: piece.w });
      glue = true;
    }
    // A run that ends without whitespace glues onto whatever comes next.
  }
  doc.font(certFont('regular')).fontSize(size);
  const space = doc.widthOfString(' ');

  const lines: Word[][] = [];
  let line: Word[] = [];
  let width = 0;
  for (const word of words) {
    if (word === BREAK) {
      lines.push(line);
      line = [];
      width = 0;
      continue;
    }
    const next = line.length === 0 ? word.w : width + space + word.w;
    if (line.length > 0 && next > widthOf(lines.length)) {
      lines.push(line);
      line = [word];
      width = word.w;
    } else {
      line.push(word);
      width = next;
    }
  }
  if (line.length) lines.push(line);
  return { lines, space };
}

function drawParagraph(
  doc: Doc, runs: TextRun[], cx: number, firstBaseline: number, maxW: number, taper: number, s: number,
  maxLines: number,
): void {
  // The first line is the widest; each one after it narrower by `taper`, with
  // a floor so a long paragraph never tapers to nothing.
  const widthOf = (line: number) => Math.max(maxW * 0.55, maxW - line * taper);
  // Shrink a long paragraph rather than let it run into the signature.
  let size = 12.4 * s;
  let laid = layoutParagraph(doc, runs, size, widthOf);
  while (laid.lines.length > maxLines && size > 9.5 * s) {
    size -= 0.4 * s;
    laid = layoutParagraph(doc, runs, size, widthOf);
  }

  // Balance: the narrowest measure that still gives the same number of lines
  // — CSS's text-wrap: balance, by bisection. Greedy wrapping fills every
  // line but the last, which leaves "à Oran, Algérie." stranded on its own.
  const count = laid.lines.length;
  if (count > 1) {
    let lo = 0.6;
    let hi = 1;
    let best = laid;
    for (let i = 0; i < 12; i++) {
      const f = (lo + hi) / 2;
      const trial = layoutParagraph(doc, runs, size, (line) => widthOf(line) * f);
      if (trial.lines.length === count) { best = trial; hi = f; } else { lo = f; }
    }
    laid = best;
  }
  const pitch = size * 1.18;

  laid.lines.forEach((words, i) => {
    const pieces = words.flatMap((word, wi) =>
      word.pieces.map((piece, pi) => ({ text: piece.text, role: piece.role, spaceBefore: wi > 0 && pi === 0 })));
    drawLine(doc, pieces, size, cx, firstBaseline + i * pitch, BODY_INK);
  });
}

/* ─────────────────── The ribbon ─────────────────── */

/** "DE PARTICIPATION" in white on a band with swallow-tail ends, as on the model. */
function drawRibbon(doc: Doc, text: string, cx: number, s: number, color: string): void {
  const size = fitSize(doc, text, 'medium', 13.5 * s, 380 * s, 9 * s);
  doc.font(fontFor('medium', text)).fontSize(size);
  const textW = doc.widthOfString(text, { characterSpacing: 0.2 * s });
  const w = Math.max(213 * s, textW + 68 * s);
  const h = 20.3 * s;
  const y = 143.4 * s;
  const notch = 8.5 * s;
  const x = cx - w / 2;
  doc.moveTo(x, y).lineTo(x + w, y).lineTo(x + w - notch, y + h / 2).lineTo(x + w, y + h)
    .lineTo(x, y + h).lineTo(x + notch, y + h / 2).closePath().fill(color);
  centredLine(doc, text, 'medium', size, cx, y + h / 2 + size * 0.36, WHITE, 0.2 * s);
}

/* ─────────────────── Signatures ─────────────────── */

interface SignatureAssets { images: Array<Buffer | null>; stamp: Buffer | null }

/**
 * Where the signing line sits.
 *
 * PRINT is the model exactly: one line at 326pt, signed by hand. DIGITAL needs
 * room ABOVE the line for a signature image, and at 326 that room is the
 * paragraph's last line — the first two-signatory render put a drawn signature
 * straight onto it. So a digital certificate's signatures sit lower, and the
 * paragraph is held to four lines to make space.
 */
function signingLineY(mode: CertificateMode, s: number): number {
  return (mode === 'DIGITAL' ? 350 : 326) * s;
}

function drawSignatures(
  doc: Doc, settings: CertificateSettings, layout: Layout, s: number, mode: CertificateMode,
  assets: SignatureAssets,
): void {
  const lineW = 84 * s;
  const lineY = signingLineY(mode, s);
  const gap = 44 * s;
  const signatories = settings.signatories.slice(0, 2);
  if (signatories.length === 0) signatories.push({ name: '', role: 'Signature' });

  signatories.forEach((sig, i) => {
    // The first signatory takes the model's place, bottom right; a second one
    // sits to its left on the same line, clear of the decoration.
    const right = layout.sigRight * s - i * (lineW + gap);
    const left = right - lineW;
    const mid = (left + right) / 2;

    const image = mode === 'DIGITAL' ? assets.images[i] : null;
    if (image) {
      try {
        doc.image(image, mid - 52 * s, lineY - 32 * s, {
          fit: [104 * s, 30 * s], align: 'center', valign: 'bottom',
        });
      } catch { /* an unreadable image leaves the line to be signed by hand */ }
    }

    doc.moveTo(left, lineY).lineTo(right, lineY).lineWidth(0.6 * s).strokeColor(LABEL_INK).stroke();
    const label = (sig.role.trim() || 'Signature').toLocaleUpperCase('fr-FR');
    const labelSize = fitSize(doc, label, 'bold', 6.6 * s, lineW + 30 * s, 5 * s);
    centredLine(doc, label, 'bold', labelSize, mid, lineY + 8.5 * s, LABEL_INK, 0.8 * s);
    if (sig.name.trim()) {
      centredLine(doc, sig.name.trim(), 'regular', 7 * s, mid, lineY + 17.5 * s, LABEL_INK);
    }
  });

  // The stamp sits ON the first signature, as a real one does — over the
  // line and its label, never up into the paragraph. Only on a DIGITAL
  // certificate: a printed one is stamped by hand.
  if (mode === 'DIGITAL' && settings.showStamp && assets.stamp) {
    const mid = layout.sigRight * s - lineW / 2;
    const w = 96 * s;
    const h = 60 * s;
    try {
      doc.image(assets.stamp, mid - w / 2, lineY - 38 * s, {
        fit: [w, h], align: 'center', valign: 'center',
      });
    } catch { /* skip an unreadable stamp */ }
  }
}

/* ─────────────────── Verification ─────────────────── */

async function qrPng(url: string): Promise<Buffer | null> {
  try {
    return await QRCode.toBuffer(url, {
      margin: 0, errorCorrectionLevel: 'M', width: 240,
      color: { dark: '#1c1c1c', light: '#ffffff' },
    });
  } catch {
    return null;
  }
}

function drawVerification(
  doc: Doc, recipient: CertificateRecipient, qr: Buffer | null, layout: Layout, W: number, H: number, s: number,
  mode: CertificateMode,
): void {
  if (!recipient.number) return;
  // A digital certificate's signatures sit lower, so the code moves down and
  // shrinks a little to stay clear of the signatory's name.
  const size = (mode === 'DIGITAL' ? 26 : 30) * s;
  const bottom = H - (mode === 'DIGITAL' ? 12 : 22) * s;
  const numberText = `N° ${recipient.number}`;
  doc.font(certFont('medium')).fontSize(6 * s).fillColor(LABEL_INK);
  const tw = doc.widthOfString(numberText);

  if (layout.verify === 'right') {
    const x = layout.sigRight * s - size;
    if (qr) doc.image(qr, x, bottom - size, { width: size, height: size });
    doc.text(numberText, (qr ? x - 6 * s : layout.sigRight * s) - tw, bottom - 1.5 * s, {
      lineBreak: false, baseline: 'alphabetic',
    });
  } else {
    const x = 29.5 * s;
    if (qr) doc.image(qr, x, bottom - size, { width: size, height: size });
    doc.text(numberText, qr ? x + size + 6 * s : x, bottom - 1.5 * s, { lineBreak: false, baseline: 'alphabetic' });
  }
}

/* ─────────────────── One page ─────────────────── */

function drawCertificate(
  doc: Doc,
  settings: CertificateSettings,
  context: CertificateContext,
  recipient: CertificateRecipient,
  assets: { logo: Buffer | null; qr: Buffer | null } & SignatureAssets,
  mode: CertificateMode,
): void {
  const [W, H] = PAGE[settings.pageSize] ?? PAGE.A5;
  const s = W / BASE_W;
  const layout = layoutFor(settings.template);
  const tones = certificateTones(settings.primaryColor, settings.darkColor);
  const cx = layout.cx * s;

  (DECORATION[settings.template] ?? drawWaves)(doc, W, H, s, tones);

  // Logo, top left — or the organizer's name when there is none, so the
  // certificate always says who issued it.
  if (assets.logo) {
    try {
      // `fit` without a valign anchors the image to the box's top-left.
      doc.image(assets.logo, layout.logoX * s, layout.logoY * s, { fit: [165 * s, 31 * s] });
    } catch { /* fall through to no logo */ }
  } else if (context.organizer.trim()) {
    doc.font(fontFor('bold', context.organizer)).fontSize(15 * s).fillColor(tones.mid)
      .text(context.organizer.trim(), layout.logoX * s, layout.logoY * s + 18 * s, {
        lineBreak: false, baseline: 'alphabetic',
      });
  }

  // "ATTESTATION"
  const title = settings.title.trim() || 'ATTESTATION';
  // Sized to the model's WIDTH (~305pt), not its point size: every free face
  // here runs wider than Stem, and matching the size would push the title
  // into the top-right sweep.
  const titleSize = fitSize(doc, title, 'heavy', 46 * s, 305 * s, 24 * s);
  centredLine(doc, title, 'heavy', titleSize, cx, 127.5 * s, INK, -0.3 * s);

  // "DE PARTICIPATION"
  if (settings.subtitle.trim()) drawRibbon(doc, settings.subtitle.trim(), cx, s, tones.mid);

  // "Nous certifions par la présente que"
  if (settings.intro.trim()) {
    const introSize = fitSize(doc, settings.intro.trim(), 'medium', 12.8 * s, layout.bodyW * s, 9 * s);
    centredLine(doc, settings.intro.trim(), 'medium', introSize, cx, 192 * s, INK);
  }

  // "Mme. AMARA DJIHENE HIND" over a hairline — drawn as runs so an Arabic
  // name keeps its word order next to a Latin "Mme.".
  const parts = certificateNameParts(recipient);
  const nameLine = namePieces(parts.civility, parts.name);
  let nameSize = 17.5 * s;
  while (nameSize > 11 * s && lineWidth(doc, nameLine, nameSize) > (layout.bodyW + 30) * s) nameSize -= 0.5;
  const nameW = drawLine(doc, nameLine, nameSize, cx, 236 * s, INK);
  const ruleW = Math.min((layout.bodyW + 20) * s, Math.max(246 * s, nameW + 26 * s));
  doc.moveTo(cx - ruleW / 2, 243.3 * s).lineTo(cx + ruleW / 2, 243.3 * s)
    .lineWidth(0.7 * s).strokeColor(HAIRLINE).stroke();

  // The paragraph
  const vars = certificateVariables(settings, context, recipient);
  const runs = parseBoldRuns(fillCertificateText(settings.body, vars));
  // Four lines when the signing zone needs the room — a digital certificate,
  // or a second signatory, whose line is centred right under the paragraph.
  const maxLines = mode === 'DIGITAL' || settings.signatories.length > 1 ? 4 : 5;
  drawParagraph(doc, runs, cx, 261.5 * s, layout.bodyW * s, layout.taper * s, s, maxLines);

  drawSignatures(doc, settings, layout, s, mode, assets);
  if (settings.showVerification) drawVerification(doc, recipient, assets.qr, layout, W, H, s, mode);
}

/* ─────────────────── Entry point ─────────────────── */

export interface RenderCertificatesInput {
  settings: CertificateSettings;
  context: CertificateContext;
  /** One page each, in this order. */
  recipients: CertificateRecipient[];
  mode: CertificateMode;
  logoUrl?: string | null;
  /** The organizer's stamp — drawn only in DIGITAL mode with showStamp. */
  stampUrl?: string | null;
  /**
   * Images already fetched by `loadCertificateImages` — for a caller drawing
   * many one-page PDFs (one email each) from the same settings.
   */
  images?: CertificateImages;
}

/** The logo, stamp and signature images a batch of certificates is drawn with. */
export interface CertificateImages {
  logo: Buffer | null;
  stamp: Buffer | null;
  signatures: Array<Buffer | null>;
}

export async function loadCertificateImages(
  input: Pick<RenderCertificatesInput, 'settings' | 'mode' | 'logoUrl' | 'stampUrl'>,
): Promise<CertificateImages> {
  const { settings, mode } = input;
  const wantSignatures = mode === 'DIGITAL';
  // Through the certificate fetcher, not the shared one: our own Cloudinary
  // account only, size-capped — see ./images.ts.
  const [logo, stamp, ...signatures] = await Promise.all([
    fetchCertificateImage(input.logoUrl ?? null),
    mode === 'DIGITAL' && settings.showStamp ? fetchCertificateImage(input.stampUrl ?? null) : Promise.resolve(null),
    ...settings.signatories.slice(0, 2).map((sig) =>
      wantSignatures ? fetchCertificateImage(sig.imageUrl ?? null) : Promise.resolve(null)),
  ]);
  return { logo: logo ?? null, stamp: stamp ?? null, signatures };
}

export async function renderCertificatesPdf(input: RenderCertificatesInput): Promise<Buffer> {
  const { settings, context, recipients, mode } = input;
  const [W, H] = PAGE[settings.pageSize] ?? PAGE.A5;

  // Images are fetched ONCE for the whole batch, not per page: a class of
  // thirty is one download of the logo, not thirty.
  const { logo, stamp, signatures: signatureImages } = input.images ?? await loadCertificateImages(input);

  const doc = new PDFDocument({
    size: [W, H],
    margin: 0,
    autoFirstPage: false,
    info: {
      Title: `${settings.title} ${settings.subtitle}`.trim(),
      Creator: 'Metwork',
      Producer: 'Metwork',
    },
  });
  registerCertificateFonts(doc, settings.font);

  for (const recipient of recipients) {
    const qr = settings.showVerification && recipient.verifyUrl ? await qrPng(recipient.verifyUrl) : null;
    doc.addPage({ size: [W, H], margin: 0 });
    drawCertificate(doc, settings, context, recipient, {
      logo, qr, stamp, images: signatureImages,
    }, mode);
  }

  return collectBuffer(doc);
}
