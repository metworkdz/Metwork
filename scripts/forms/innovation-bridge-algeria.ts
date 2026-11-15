/**
 * Innovation Bridge Algeria — application form.
 *
 * The questions an applicant answers, in the order they are asked, in the shape
 * the form builder saves (`POST /api/incubator/registration-form`). Applied with
 * `scripts/apply-registration-form.ts`.
 *
 * LANGUAGES. The questions are written in English (`sourceLocale`) and carry
 * French and Arabic translations, so each visitor reads the form in their own
 * language. Answers are ALWAYS recorded as the English option — "Oui" and "نعم"
 * both become "Yes" — so results and exports stay in one language.
 *   • The wilaya names are the official ones from `src/config/cities.ts`
 *     (French, Arabic and English); the stored value is the French name.
 *   • Everything else was translated by a model-assisted draft and is saved
 *     flagged as "AI draft — check it" (`TRANSLATION_DRAFTED`) until someone
 *     who reads French and Arabic marks it as checked in the builder.
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

type Locale = 'en' | 'fr' | 'ar';
export type Translation = { label?: string; options?: string[] };

export type FormField = {
  label: string;
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'DROPDOWN' | 'MULTIPLE_CHOICE' | 'CHECKBOX' | 'FILE';
  options?: string[];
  required: boolean;
  translations: Partial<Record<Locale, Translation>>;
};

/** The language the questions above are written in. */
export const SOURCE_LOCALE: Locale = 'en';

/** Translations that were drafted, not yet read by a person (flagged in the builder). */
export const TRANSLATION_DRAFTED: Locale[] = ['fr', 'ar'];

const YES_NO = ['Yes', 'No'];

/** This year back to 2015, then everything older. Update the range when the call reopens. */
const LAST_YEAR = 2026;
const YEARS = [...Array.from({ length: LAST_YEAR - 2015 + 1 }, (_, i) => String(LAST_YEAR - i)), '2014 or earlier'];

export const innovationBridgeFields: FormField[] = [
  // 1. Applicant information
  {
    label: 'Wilaya of residence',
    type: 'DROPDOWN',
    // Stored value: the French name (what the host reads in exports).
    options: algerianCities.map((c) => c.nameFr),
    required: true,
    translations: {
      en: { options: algerianCities.map((c) => c.nameEn) },
      fr: { label: 'Wilaya de résidence', options: algerianCities.map((c) => c.nameFr) },
      ar: { label: 'ولاية الإقامة', options: algerianCities.map((c) => c.nameAr) },
    },
  },
  {
    label: 'Are you applying as a project holder or on behalf of a startup?',
    type: 'MULTIPLE_CHOICE',
    options: ['Project holder', 'On behalf of a startup'],
    required: true,
    translations: {
      fr: {
        label: 'Candidatez-vous en tant que porteur de projet ou au nom d’une startup ?',
        options: ['Porteur de projet', 'Au nom d’une startup'],
      },
      ar: {
        label: 'هل تتقدم بصفتك صاحب مشروع أم نيابةً عن مؤسسة ناشئة؟',
        options: ['صاحب مشروع', 'نيابةً عن مؤسسة ناشئة'],
      },
    },
  },

  // 2. Startup information
  {
    label: 'Startup / Project name',
    type: 'SHORT_TEXT',
    required: true,
    translations: { fr: { label: 'Nom de la startup / du projet' }, ar: { label: 'اسم المؤسسة الناشئة / المشروع' } },
  },
  {
    label: 'Your role in the project',
    type: 'SHORT_TEXT',
    required: true,
    translations: { fr: { label: 'Votre rôle dans le projet' }, ar: { label: 'دورك في المشروع' } },
  },
  // A dropdown, not free text: the builder has no number field, so "Year of
  // creation" typed by hand accepted anything ("soon", "2O19"). The last
  // option catches older companies without a 40-line list.
  {
    label: 'Year of creation',
    type: 'DROPDOWN',
    options: YEARS,
    required: true,
    translations: {
      fr: { label: 'Année de création', options: [...YEARS.slice(0, -1), '2014 ou avant'] },
      ar: { label: 'سنة التأسيس', options: [...YEARS.slice(0, -1), '2014 أو قبل'] },
    },
  },
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
    translations: {
      fr: {
        label: 'Votre startup/projet est-il officiellement labellisé ?',
        options: [
          'Label Startup',
          'Label Projet Innovant',
          'Demande déposée, en attente de validation',
          'Aucun label / Aucune demande déposée',
        ],
      },
      ar: {
        label: 'هل مؤسستك الناشئة/مشروعك حاصل رسمياً على علامة (Label)؟',
        options: [
          'Label Startup',
          'Label Projet Innovant',
          'تم إيداع الطلب، في انتظار الموافقة',
          'لا توجد علامة / لم يُودَع أي طلب',
        ],
      },
    },
  },
  {
    label: 'Upload your label certificate or proof of application (if applicable)',
    type: 'FILE',
    required: false,
    translations: {
      fr: { label: 'Téléversez votre certificat de label ou la preuve de dépôt de votre demande (le cas échéant)' },
      ar: { label: 'ارفع شهادة العلامة أو إثبات إيداع الطلب (إن وُجد)' },
    },
  },

  // 3. Your solution
  {
    label: 'Briefly describe your solution (what does it do?)',
    type: 'LONG_TEXT',
    required: true,
    translations: {
      fr: { label: 'Décrivez brièvement votre solution (que fait-elle ?)' },
      ar: { label: 'صِف حلّك باختصار (ماذا يفعل؟)' },
    },
  },
  {
    label: 'What problem does it solve?',
    type: 'LONG_TEXT',
    required: true,
    translations: { fr: { label: 'Quel problème résout-elle ?' }, ar: { label: 'ما المشكلة التي يحلّها؟' } },
  },
  {
    label: 'What makes your solution innovative?',
    type: 'LONG_TEXT',
    required: true,
    translations: {
      fr: { label: 'Qu’est-ce qui rend votre solution innovante ?' },
      ar: { label: 'ما الذي يجعل حلّك مبتكراً؟' },
    },
  },
  {
    label: 'What stage is your solution at?',
    type: 'MULTIPLE_CHOICE',
    options: ['Functional prototype', 'MVP', 'Tested solution', 'Already commercialized'],
    required: true,
    translations: {
      fr: {
        label: 'À quel stade se trouve votre solution ?',
        options: ['Prototype fonctionnel', 'MVP', 'Solution testée', 'Déjà commercialisée'],
      },
      ar: {
        label: 'في أي مرحلة يوجد حلّك؟',
        options: ['نموذج أولي وظيفي', 'MVP', 'حل تمت تجربته', 'تم تسويقه بالفعل'],
      },
    },
  },
  {
    label: 'Do you have a presentation or pitch deck? Upload it (optional)',
    type: 'FILE',
    required: false,
    translations: {
      fr: { label: 'Avez-vous une présentation ou un pitch deck ? Téléversez-le (facultatif)' },
      ar: { label: 'هل لديك عرض تقديمي أو Pitch Deck؟ ارفعه (اختياري)' },
    },
  },

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
    translations: {
      fr: {
        label: 'Quels domaines de défis votre solution adresse-t-elle ? (Plusieurs choix possibles)',
        options: [
          'Production et excellence industrielle',
          'Maintenance et gestion des actifs',
          'FoodTech et Agritech',
          'Supply Chain et logistique',
          'Qualité, HSE et conformité',
          'Énergie, environnement et durabilité',
          'RH, administration et opérations',
          'IA, données et transformation digitale',
          'Matériaux, chimie et innovation produit',
          'Infrastructures, construction et gestion des installations',
        ],
      },
      ar: {
        label: 'ما مجالات التحدي التي يعالجها حلّك؟ (اختيارات متعددة)',
        options: [
          'الإنتاج والتميّز الصناعي',
          'الصيانة وإدارة الأصول',
          'التكنولوجيا الغذائية والزراعية (FoodTech & Agritech)',
          'سلاسل التوريد والخدمات اللوجستية',
          'الجودة والصحة والسلامة والبيئة (HSE) والامتثال',
          'الطاقة والبيئة والاستدامة',
          'الموارد البشرية والإدارة والعمليات التجارية',
          'الذكاء الاصطناعي والبيانات والتحول الرقمي',
          'المواد والكيمياء وابتكار المنتجات',
          'البنية التحتية والبناء وإدارة المرافق',
        ],
      },
    },
  },
  {
    label: 'Briefly explain how your solution could address a real business challenge.',
    type: 'LONG_TEXT',
    required: true,
    translations: {
      fr: { label: 'Expliquez brièvement comment votre solution pourrait répondre à un défi réel des entreprises.' },
      ar: { label: 'اشرح باختصار كيف يمكن لحلّك أن يعالج تحدياً حقيقياً تواجهه الشركات.' },
    },
  },

  // 5. Participation
  {
    label: 'Are you available to participate in the preparation phase if selected?',
    type: 'MULTIPLE_CHOICE',
    options: YES_NO,
    required: true,
    translations: {
      fr: {
        label: 'Êtes-vous disponible pour participer à la phase de préparation si vous êtes sélectionné(e) ?',
        options: ['Oui', 'Non'],
      },
      ar: { label: 'هل أنت متاح للمشاركة في مرحلة التحضير في حال اختيارك؟', options: ['نعم', 'لا'] },
    },
  },
  {
    label: 'Can you travel to Oran for the final pitch in January 2027?',
    type: 'MULTIPLE_CHOICE',
    options: YES_NO,
    required: true,
    translations: {
      fr: { label: 'Pouvez-vous vous déplacer à Oran pour le pitch final en janvier 2027 ?', options: ['Oui', 'Non'] },
      ar: { label: 'هل يمكنك السفر إلى وهران لحضور العرض النهائي في جانفي 2027؟', options: ['نعم', 'لا'] },
    },
  },
  {
    label: 'Who will represent the startup during the final pitch?',
    type: 'SHORT_TEXT',
    required: true,
    translations: {
      fr: { label: 'Qui représentera la startup lors du pitch final ?' },
      ar: { label: 'من سيمثّل المؤسسة الناشئة خلال العرض النهائي؟' },
    },
  },

  // 6. Declaration — each one required, each one a single tick (see the note above).
  {
    label: 'I confirm that the information provided is accurate.',
    type: 'CHECKBOX',
    options: ['I confirm'],
    required: true,
    translations: {
      fr: { label: 'Je confirme que les informations fournies sont exactes.', options: ['Je confirme'] },
      ar: { label: 'أؤكد أن المعلومات المقدَّمة صحيحة.', options: ['أؤكد'] },
    },
  },
  {
    label: 'I understand that submitting an application does not guarantee selection.',
    type: 'CHECKBOX',
    options: ['I understand'],
    required: true,
    translations: {
      fr: { label: 'Je comprends que le dépôt d’une candidature ne garantit pas la sélection.', options: ['Je comprends'] },
      ar: { label: 'أدرك أن تقديم الطلب لا يضمن الاختيار.', options: ['أدرك'] },
    },
  },
  {
    label:
      'I agree to the use of my information for the evaluation and organization of Innovation Bridge Algeria, in accordance with the applicable privacy policy.',
    type: 'CHECKBOX',
    options: ['I agree'],
    required: true,
    translations: {
      fr: {
        label:
          'J’accepte l’utilisation de mes informations pour l’évaluation et l’organisation d’Innovation Bridge Algeria, conformément à la politique de confidentialité applicable.',
        options: ['J’accepte'],
      },
      ar: {
        label:
          'أوافق على استخدام معلوماتي لأغراض تقييم وتنظيم Innovation Bridge Algeria، وفقاً لسياسة الخصوصية المعمول بها.',
        options: ['أوافق'],
      },
    },
  },
];
