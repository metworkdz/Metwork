/**
 * Predefined consultation domains for consultant self-signup and profiles.
 * The CODE is what's stored on `MentorRecord.field` — labels are resolved at
 * render time per locale (same pattern as `cities.ts`). Add new domains at
 * the end; never change existing codes (they're persisted on live records).
 */
export const consultationFields = [
  { code: 'strategy', fr: 'Stratégie & Business Model', en: 'Strategy & Business Model', ar: 'الاستراتيجية ونموذج الأعمال' },
  { code: 'finance', fr: 'Comptabilité & Finance', en: 'Accounting & Finance', ar: 'المحاسبة والمالية' },
  { code: 'fiscal', fr: 'Fiscalité', en: 'Taxation', ar: 'الجباية' },
  { code: 'legal', fr: 'Juridique', en: 'Legal', ar: 'القانون' },
  { code: 'marketing', fr: 'Marketing & Communication', en: 'Marketing & Communication', ar: 'التسويق والاتصال' },
  { code: 'sales', fr: 'Ventes & Développement commercial', en: 'Sales & Business Development', ar: 'المبيعات وتطوير الأعمال' },
  { code: 'hr', fr: 'Ressources humaines', en: 'Human Resources', ar: 'الموارد البشرية' },
  { code: 'tech', fr: 'Tech & Digital', en: 'Tech & Digital', ar: 'التكنولوجيا والرقمنة' },
  { code: 'fundraising', fr: 'Levée de fonds & Investissement', en: 'Fundraising & Investment', ar: 'جمع التمويل والاستثمار' },
  { code: 'export', fr: 'Commerce international & Export', en: 'International Trade & Export', ar: 'التجارة الدولية والتصدير' },
  { code: 'operations', fr: 'Opérations & Supply Chain', en: 'Operations & Supply Chain', ar: 'العمليات وسلسلة التوريد' },
  { code: 'other', fr: 'Autre', en: 'Other', ar: 'أخرى' },
] as const;

export type ConsultationFieldCode = (typeof consultationFields)[number]['code'];

/** Resolve a stored field code to its localized label. Unknown codes render as-is. */
export function getConsultationFieldLabel(code: string, locale: 'en' | 'fr' | 'ar'): string {
  const f = consultationFields.find((x) => x.code === code);
  if (!f) return code;
  return f[locale];
}
