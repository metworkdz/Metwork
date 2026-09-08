/**
 * The layout shared by the consultant contract and the space-rental contract
 * (`src/server/pdf/contract-layout.ts`).
 *
 * The heading cases are quoted VERBATIM from the templates in production —
 * both space templates and the consultant one — because heading detection is
 * pattern-matching against whatever an admin typed, and a rule that only works
 * on invented examples is worthless.
 */
import { describe, it, expect } from 'vitest';
import { isHeadingLine, isSubHeadingLine } from '@/server/pdf/contract-layout';
import { generateContractPdf } from '@/server/contracts/contract-pdf';

describe('isHeadingLine', () => {
  it('recognises the numbered, capitalised form the space templates use', () => {
    for (const line of [
      '1. OBJET DU CONTRAT',
      '2. DURÉE',
      '3. SERVICES FOURNIS',
      '9. DISPOSITIONS GÉNÉRALES',
    ]) {
      expect(isHeadingLine(line)).toBe(true);
    }
  });

  it('still recognises the article form the consultant template uses', () => {
    for (const line of [
      'Article 1 — Objet du contrat',
      'Article 2 – Durée et horaires de location',
      'ARTICLE 3 : Commission',
      'Chapitre 2 — Dispositions',
    ]) {
      expect(isHeadingLine(line)).toBe(true);
    }
  });

  it('leaves an ordinary numbered list as body text', () => {
    // The capitalisation is what separates a heading from the first item of a
    // list; without it, a numbered clause would be set at heading size.
    for (const line of [
      '1. Le Client s’engage à respecter le règlement intérieur.',
      '2) Les parties conviennent de ce qui suit.',
    ]) {
      expect(isHeadingLine(line)).toBe(false);
    }
  });

  it('does not promote prose, sub-headings or long lines', () => {
    for (const line of [
      'Le Client s’engage à :',
      "déduction faite de la commission prévue à l'Article 3.",
      '4.1 – Responsabilité du Locataire',
      '',
      'Article premier de la loi n° 18-07 relative à la protection des personnes physiques dans le traitement des données à caractère personnel et autres dispositions.',
    ]) {
      expect(isHeadingLine(line)).toBe(false);
    }
  });
});

describe('isSubHeadingLine', () => {
  it('recognises the decimal subdivisions in the training-room template', () => {
    expect(isSubHeadingLine('4.1 – Responsabilité du Locataire')).toBe(true);
    expect(isSubHeadingLine('4.2 – Responsabilité de Metwork')).toBe(true);
    expect(isSubHeadingLine('1.1 Objet')).toBe(true);
  });

  it('leaves figures in running prose alone', () => {
    // "2.5 %" opens a sentence about money, not a section.
    expect(isSubHeadingLine('2.5 % du montant encaissé sont retenus.')).toBe(false);
    expect(isSubHeadingLine('Le prix de la location est fixé à : 18 000 DZD')).toBe(false);
    expect(isSubHeadingLine('1. OBJET DU CONTRAT')).toBe(false);
  });
});

describe('space contract PDF', () => {
  const base = {
    incubator: { name: 'Metwork', logoUrl: null },
    contractNumber: 'CT-METW-4A91C3D7',
    title: 'CONTRAT DE LOCATION D’ESPACE DE COWORKING',
    metworkBrand: true,
  };

  it('renders a valid PDF with the brand wordmark embedded', async () => {
    const pdf = await generateContractPdf({
      ...base,
      lang: 'fr',
      body: '1. OBJET DU CONTRAT\nLe présent contrat…\n•\tUn poste de travail,\n•\tUne connexion Internet.',
    });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toContain('EOF');
    // The wordmark is there. (It counts as two image objects, not one: a PNG
    // with an alpha channel carries a soft mask alongside the image itself.)
    expect((pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length).toBeGreaterThan(0);
  });

  it('sets a French contract in Times', async () => {
    const pdf = await generateContractPdf({ ...base, lang: 'fr', body: 'Corps du contrat.' });
    expect(pdf.toString('latin1')).toContain('Tinos');
  });

  it('sets an Arabic contract in Amiri, which Times cannot render', async () => {
    // Tinos has no Arabic coverage — an `ar` template set in it would come out
    // blank, so the face has to switch, not just the alignment.
    const pdf = await generateContractPdf({
      ...base,
      lang: 'ar',
      title: 'عقد إيجار مساحة عمل مشتركة',
      body: '1. موضوع العقد\nيهدف هذا العقد إلى تحديد شروط وضع مكتب تحت تصرف العميل.',
    });
    expect(pdf.toString('latin1')).toContain('Amiri');
    expect(pdf.subarray(-6).toString('latin1')).toContain('EOF');
  });

  it('falls back to the incubator logo when the issuer is not Metwork', async () => {
    // No wordmark, and a null logoUrl fetches nothing — the contract still
    // renders rather than failing on a missing image.
    const pdf = await generateContractPdf({
      ...base,
      metworkBrand: false,
      incubator: { name: 'Algiers Incubator', logoUrl: null },
      lang: 'fr',
      body: 'Corps du contrat.',
    });
    expect((pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length).toBe(0);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
