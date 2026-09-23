/**
 * The words on a participation certificate.
 *
 * Every rule here came out of rendering the Metwork model and looking at it:
 * the date that split across two lines, "M." stranded at the end of a line
 * away from "Rafik", "et animée par ," when a program had no trainer. They
 * are pinned because each one is invisible to a type checker and obvious on
 * paper.
 */
import { describe, it, expect } from 'vitest';
import {
  certificateNameLine,
  certificateTones,
  certificateVariables,
  emptyVariablesIn,
  fillCertificateText,
  formatCertificateDates,
  formatCertificateDay,
  isHexColor,
  parseBoldRuns,
} from '@/server/certificates/text';
import { DEFAULT_CERTIFICATE_SETTINGS } from '@/server/certificates/types';

const NB = ' ';
/** Noon-anchored, as programs are stored. */
const day = (d: string) => `${d}T11:00:00.000Z`;

describe('dates', () => {
  it('prints a one-day training as "le …", like the model', () => {
    expect(formatCertificateDates(day('2026-02-14'), day('2026-02-14'))).toBe(`le${NB}14${NB}février${NB}2026`);
  });

  it('shares the month and year across a span inside one month', () => {
    expect(formatCertificateDates(day('2026-09-08'), day('2026-09-20')))
      .toBe(`du${NB}8 au${NB}20${NB}septembre${NB}2026`);
  });

  it('names both months across a month boundary', () => {
    expect(formatCertificateDates(day('2026-09-28'), day('2026-10-03')))
      .toBe(`du${NB}28${NB}septembre au${NB}3${NB}octobre${NB}2026`);
  });

  it('names both years across a year boundary', () => {
    expect(formatCertificateDates(day('2026-12-28'), day('2027-01-03')))
      .toBe(`du${NB}28${NB}décembre${NB}2026 au${NB}3${NB}janvier${NB}2027`);
  });

  it('writes the first of the month as "1er"', () => {
    expect(formatCertificateDay(day('2026-02-01'))).toBe(`1er${NB}février${NB}2026`);
  });

  it('never lets a date break across lines', () => {
    // Every space inside a date is a no-break space; only the one before
    // "au" between two dates may break.
    const span = formatCertificateDates(day('2026-09-28'), day('2026-10-03'));
    expect(span.split(' ')).toHaveLength(2);
    expect(formatCertificateDay(day('2026-02-14'))).not.toContain(' ');
  });

  it('reads a noon-anchored date on the right day in Algeria', () => {
    // Stored at 11:00 UTC = noon in Algiers. A midnight anchor would have
    // landed the day before; this guards the anchor and the zone together.
    expect(formatCertificateDay('2026-02-14T11:00:00.000Z')).toContain('14');
  });

  it('returns nothing for an unreadable date rather than "Invalid Date"', () => {
    expect(formatCertificateDay('not a date')).toBe('');
  });
});

describe('filling the paragraph', () => {
  const context = {
    programTitle: 'Introduction à l’environnement juridique de l’entrepreneur',
    organizer: 'Metwork', city: 'Oran', startDate: day('2026-02-14'), endDate: day('2026-02-14'),
  };

  it('reproduces the model\'s paragraph from the default settings', () => {
    const vars = certificateVariables({ trainerName: 'M. Rafik Fethi Benabdessadok', hours: null }, context);
    const text = fillCertificateText(DEFAULT_CERTIFICATE_SETTINGS.body, vars).replace(/ /g, ' ');
    expect(text).toBe(
      'A participé avec succès à la formation « Introduction à l’environnement juridique de l’entrepreneur », '
      + 'organisée par Metwork, et animée par M. Rafik Fethi Benabdessadok, tenue **le 14 février 2026**, '
      + 'à Oran, Algérie.',
    );
  });

  it('drops an optional passage whose variable is empty', () => {
    // The reason [[…]] exists: no trainer must not print "et animée par ,".
    const vars = certificateVariables({ trainerName: '', hours: null }, context);
    const text = fillCertificateText(DEFAULT_CERTIFICATE_SETTINGS.body, vars);
    expect(text).not.toContain('animée par');
    expect(text).toContain('organisée par Metwork, tenue');
  });

  it('keeps an optional passage when its variable is filled', () => {
    const text = fillCertificateText('Formation[[ de {heures}]].', { '{heures}': '24 heures' });
    expect(text).toBe('Formation de 24 heures.');
  });

  it('leaves an unknown variable visible, so a typo shows on the preview', () => {
    expect(fillCertificateText('Tenue à {vile}.', { '{ville}': 'Oran' })).toBe('Tenue à {vile}.');
  });

  it('tidies the comma an empty variable leaves behind', () => {
    expect(fillCertificateText('Par {organisme} , à Oran.', { '{organisme}': '' })).toBe('Par, à Oran.');
  });

  it('keeps a title with the name that follows it', () => {
    const text = fillCertificateText('animée par M. Rafik et Mme Amina', {});
    expect(text).toContain(`M.${NB}Rafik`);
    expect(text).toContain(`Mme${NB}Amina`);
  });

  it('keeps the guillemets with what they quote', () => {
    expect(fillCertificateText('la formation « Excel »', {})).toBe(`la formation «${NB}Excel${NB}»`);
  });

  it('names the variables that would come out empty, ignoring optional passages', () => {
    const vars = certificateVariables({ trainerName: '', hours: '' }, context);
    expect(emptyVariablesIn('Durée : {heures}. [[Par {formateur}.]]', vars)).toEqual(['{heures}']);
  });
});

describe('bold runs', () => {
  it('splits plain and bold text', () => {
    expect(parseBoldRuns('tenue **le 14 février**, à Oran')).toEqual([
      { text: 'tenue ', bold: false },
      { text: 'le 14 février', bold: true },
      { text: ', à Oran', bold: false },
    ]);
  });

  it('prints an unmatched ** rather than bolding the rest of the paragraph', () => {
    expect(parseBoldRuns('tenue **le 14 février')).toEqual([{ text: 'tenue **le 14 février', bold: false }]);
  });
});

describe('the name line', () => {
  it('prints the civility as typed and the name in capitals, like the model', () => {
    expect(certificateNameLine({ fullName: 'Amara Djihene Hind', civility: 'Mme' })).toBe('Mme. AMARA DJIHENE HIND');
    expect(certificateNameLine({ fullName: 'karim hadjadj', civility: 'M.' })).toBe('M. KARIM HADJADJ');
  });

  it('keeps French accents through the capitals', () => {
    expect(certificateNameLine({ fullName: 'Hélène Chérif' })).toBe('HÉLÈNE CHÉRIF');
  });

  it('prints an Arabic name exactly as registered', () => {
    expect(certificateNameLine({ fullName: 'أمينة بن علي', civility: 'Mme' })).toBe('Mme. أمينة بن علي');
  });

  it('collapses stray spaces a desk entry might carry', () => {
    expect(certificateNameLine({ fullName: '  Amina   Benali ' })).toBe('AMINA BENALI');
  });
});

describe('colors', () => {
  it('derives the model\'s four greens from two picked colors', () => {
    const t = certificateTones('#3fb34f', '#0b7a3d');
    expect(t.dark).toBe('#0b7a3d');
    expect(t.mid).toBe('#3fb34f');
    // Softer tones sit between the primary and white.
    expect(Number.parseInt(t.soft.slice(1), 16)).toBeGreaterThan(Number.parseInt(t.mid.slice(1), 16));
    expect(Number.parseInt(t.pale.slice(1), 16)).toBeGreaterThan(Number.parseInt(t.soft.slice(1), 16));
  });

  it('falls back to the model\'s greens on a malformed color, never crashes', () => {
    expect(certificateTones('green', 'nope')).toMatchObject({ mid: '#3fb34f', dark: '#0b7a3d' });
    expect(isHexColor('#12ABef')).toBe(true);
    expect(isHexColor('12ABef')).toBe(false);
  });
});
