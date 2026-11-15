/**
 * Innovation Bridge Algeria — application form.
 *
 * The questions an applicant answers, in the order they are asked, in the shape
 * the form builder saves (`POST /api/incubator/registration-form`). Applied with
 * `scripts/apply-registration-form.ts`.
 *
 * NOT repeated here: full name, email and phone. The public form already asks
 * those on its first step for every listing, and asking them twice is a
 * wasted screen on a phone.
 *
 * Choices the builder cannot express, and how they are handled:
 *  • SECTIONS ("1. Applicant information"…). The builder has no headings, so the
 *    sections are not rendered; the order of the questions follows them.
 *  • "Tick all three" declarations. A required checkbox question is satisfied by
 *    ticking ANY option, so a single question with three options would let an
 *    applicant confirm one and skip the rest. Each declaration is therefore its
 *    own required question with a single option.
 *  • "Label upload — if applicable". The "ask only if" rule matches ONE answer,
 *    and this applies to three of the four, so the upload is simply optional.
 */
import { algerianCities } from '../../src/config/cities';

export type FormField = {
  label: string;
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'DROPDOWN' | 'MULTIPLE_CHOICE' | 'CHECKBOX' | 'FILE';
  options?: string[];
  required: boolean;
};

const YES_NO = ['Yes', 'No'];

/** This year back to 2015, then everything older. Update the range when the call reopens. */
const LAST_YEAR = 2026;
const YEARS = [...Array.from({ length: LAST_YEAR - 2015 + 1 }, (_, i) => String(LAST_YEAR - i)), '2014 or earlier'];

export const innovationBridgeFields: FormField[] = [
  // 1. Applicant information
  { label: 'Wilaya of residence', type: 'DROPDOWN', options: algerianCities.map((c) => c.nameFr), required: true },
  {
    label: 'Are you applying as a project holder or on behalf of a startup?',
    type: 'MULTIPLE_CHOICE',
    options: ['Project holder', 'On behalf of a startup'],
    required: true,
  },

  // 2. Startup information
  { label: 'Startup / Project name', type: 'SHORT_TEXT', required: true },
  { label: 'Your role in the project', type: 'SHORT_TEXT', required: true },
  // A dropdown, not free text: the builder has no number field, so "Year of
  // creation" typed by hand accepted anything ("soon", "2O19"). The last
  // option catches older companies without a 40-line list.
  { label: 'Year of creation', type: 'DROPDOWN', options: YEARS, required: true },
  {
    label: 'Is your startup/project officially labelled?',
    type: 'MULTIPLE_CHOICE',
    options: [
      'Label Startup',
      'Label Projet Innovant',
      'Application submitted, awaiting approval',
      'No label / No application submitted',
    ],
    required: true,
  },
  { label: 'Upload your label certificate or proof of application (if applicable)', type: 'FILE', required: false },

  // 3. Your solution
  { label: 'Briefly describe your solution (what does it do?)', type: 'LONG_TEXT', required: true },
  { label: 'What problem does it solve?', type: 'LONG_TEXT', required: true },
  { label: 'What makes your solution innovative?', type: 'LONG_TEXT', required: true },
  {
    label: 'What stage is your solution at?',
    type: 'MULTIPLE_CHOICE',
    options: ['Functional prototype', 'MVP', 'Tested solution', 'Already commercialized'],
    required: true,
  },
  { label: 'Do you have a presentation or pitch deck? Upload it (optional)', type: 'FILE', required: false },

  // 4. Challenge areas
  {
    label: 'Which challenge areas does your solution address? (Multiple choices)',
    type: 'CHECKBOX',
    options: [
      'Production & Industrial Excellence',
      'Maintenance & Asset Management',
      'FoodTech & Agritech',
      'Supply Chain & Logistics',
      'Quality, HSE & Compliance',
      'Energy, Environment & Sustainability',
      'HR, Administration & Business Operations',
      'AI, Data & Digital Transformation',
      'Materials, Chemistry & Product Innovation',
      'Infrastructure, Construction & Facility Management',
    ],
    required: true,
  },
  { label: 'Briefly explain how your solution could address a real business challenge.', type: 'LONG_TEXT', required: true },

  // 5. Participation
  { label: 'Are you available to participate in the preparation phase if selected?', type: 'MULTIPLE_CHOICE', options: YES_NO, required: true },
  { label: 'Can you travel to Oran for the final pitch in January 2027?', type: 'MULTIPLE_CHOICE', options: YES_NO, required: true },
  { label: 'Who will represent the startup during the final pitch?', type: 'SHORT_TEXT', required: true },

  // 6. Declaration — each one required, each one a single tick (see the note above).
  { label: 'I confirm that the information provided is accurate.', type: 'CHECKBOX', options: ['I confirm'], required: true },
  { label: 'I understand that submitting an application does not guarantee selection.', type: 'CHECKBOX', options: ['I understand'], required: true },
  {
    label:
      'I agree to the use of my information for the evaluation and organization of Innovation Bridge Algeria, in accordance with the applicable privacy policy.',
    type: 'CHECKBOX',
    options: ['I agree'],
    required: true,
  },
];
