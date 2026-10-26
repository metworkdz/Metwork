/**
 * Module 1 of the Startup Academy, as filmed and edited by Metwork
 * ("Startup Academy/Module 01 - Trouver et valider son idée startup/Catalogue.md").
 * French is the original; the English and Arabic texts are drafts to review
 * (marked `drafted`, so the builder flags them).
 *
 * Owner decision (2026-10-26): mentor Yacine Kheddaoui; this is the first
 * module of a course that will grow, so it starts with this one module.
 */
import type { LocalizedText } from '@/lib/localized-text';

const tx = (fr: string, en: string, ar: string): LocalizedText => ({ source: 'fr', fr, en, ar, drafted: ['en', 'ar'] });

export const MODULE1_MENTOR_NAME = 'Yacine Kheddaoui';
export const MODULE1_SLUG = 'trouver-et-valider-son-idee-startup';

export const MODULE1_COURSE = {
  title: tx('Trouver et valider son idée startup', 'Find and validate your startup idea', 'إيجاد فكرة شركتك الناشئة والتحقق منها'),
  subtitle: tx(
    'Le bon état d’esprit, les bonnes questions et le Design Thinking pour savoir si votre idée tient la route.',
    'The right mindset, the right questions and Design Thinking to know whether your idea holds up.',
    'العقلية الصحيحة والأسئلة الصحيحة ومنهجية التفكير التصميمي لتعرف إن كانت فكرتك صالحة.',
  ),
  description: tx(
    'Ce module aide les porteurs de projet à adopter le bon état d’esprit, à se poser les bonnes questions avant de se lancer, et à évaluer leur idée avec la méthode du Design Thinking.',
    'This module helps project founders adopt the right mindset, ask themselves the right questions before starting, and assess their idea with the Design Thinking method.',
    'تساعد هذه الوحدة أصحاب المشاريع على تبنّي العقلية الصحيحة، وطرح الأسئلة المناسبة قبل الانطلاق، وتقييم فكرتهم بمنهجية التفكير التصميمي.',
  ),
  outcomes: [
    tx('Reconnaître les croyances qui bloquent un projet', 'Recognise the beliefs that hold a project back', 'التعرّف على المعتقدات التي تعرقل المشروع'),
    tx('Passer d’un fixed mindset à un growth mindset', 'Move from a fixed mindset to a growth mindset', 'الانتقال من العقلية الثابتة إلى عقلية النمو'),
    tx('Tester une idée : désirable, faisable, viable', 'Test an idea: desirable, feasible, viable', 'اختبار الفكرة: مرغوبة، قابلة للتنفيذ، مجدية'),
    tx('Appliquer les 5 phases du Design Thinking', 'Apply the 5 phases of Design Thinking', 'تطبيق المراحل الخمس للتفكير التصميمي'),
    tx('Évaluer la pertinence de son idée', 'Assess how relevant your idea is', 'تقييم مدى ملاءمة فكرتك'),
  ],
  moduleTitle: tx('Trouver et valider son idée startup', 'Find and validate your startup idea', 'إيجاد فكرة شركتك الناشئة والتحقق منها'),
  lessons: [
    tx('Introduction : ce que vous allez apprendre', 'Introduction: what you will learn', 'مقدمة: ماذا ستتعلّم'),
    tx('L’état d’esprit entrepreneurial', 'The entrepreneurial mindset', 'العقلية الريادية'),
    tx('L’introspection : pourquoi je me lance ?', 'Looking inward: why am I starting?', 'التأمل الذاتي: لماذا أنطلق؟'),
    tx('Fixed mindset vs Growth mindset', 'Fixed mindset vs growth mindset', 'العقلية الثابتة مقابل عقلية النمو'),
    tx('Les 3 questions pour valider une idée', 'The 3 questions to validate an idea', 'الأسئلة الثلاثة للتحقق من الفكرة'),
    tx('Les 5 phases du Design Thinking', 'The 5 phases of Design Thinking', 'المراحل الخمس للتفكير التصميمي'),
    tx('Évaluer la pertinence d’une idée', 'Assessing how relevant an idea is', 'تقييم مدى ملاءمة الفكرة'),
  ],
} as const;
