/**
 * French labels for the CRM's DB enums. One place, reused by every list,
 * form and timeline component that renders these values — the alternative is
 * six components each hand-rolling the same label map and drifting apart.
 */

export const ORG_TYPE_LABELS: Record<string, string> = {
  ENTREPRISE: 'Entreprise',
  STARTUP: 'Startup',
  INCUBATEUR: 'Incubateur',
  ACCELERATEUR: 'Accélérateur',
  UNIVERSITE: 'Université',
  INSTITUTION_PUBLIQUE: 'Institution publique',
  ONG_ASSOCIATION: 'ONG / Association',
  INVESTISSEUR: 'Investisseur',
  MEDIA: 'Média',
  AUTRE: 'Autre',
};

export const ORG_SIZE_LABELS: Record<string, string> = {
  '1-10': '1 à 10',
  '11-50': '11 à 50',
  '51-200': '51 à 200',
  '201-500': '201 à 500',
  '500+': '500 et plus',
};

/** Shared by Organizations and Contacts — both use RECORD_STATUSES. */
export const RECORD_STATUS_LABELS: Record<string, string> = {
  PROSPECT: 'Prospect',
  ACTIF: 'Actif',
  INACTIF: 'Inactif',
  ARCHIVE: 'Archivé',
};

export const CONTACT_LANGUAGE_LABELS: Record<string, string> = {
  fr: 'Français',
  ar: 'Arabe',
  en: 'Anglais',
};

export const INTERACTION_TYPE_LABELS: Record<string, string> = {
  APPEL: 'Appel',
  EMAIL: 'E-mail',
  WHATSAPP: 'WhatsApp',
  LINKEDIN: 'LinkedIn',
  REUNION: 'Réunion',
  VISIO: 'Visio',
  VISITE: 'Visite',
  RELANCE: 'Relance',
  PROPOSITION: 'Proposition',
  DOCUMENT_ENVOYE: 'Document envoyé',
  AUTRE: 'Autre',
};

export const INTERACTION_DIRECTION_LABELS: Record<string, string> = {
  INBOUND: 'Entrant',
  OUTBOUND: 'Sortant',
};

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  URGENTE: 'Urgente',
  HAUTE: 'Haute',
  MOYENNE: 'Moyenne',
  BASSE: 'Basse',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  INBOX: 'Inbox',
  A_FAIRE: 'À faire',
  EN_COURS: 'En cours',
  EN_ATTENTE: 'En attente',
  TERMINEE: 'Terminée',
};

/** Badge colour (existing shared Badge variants) per task priority. */
export const TASK_PRIORITY_BADGE: Record<string, 'danger' | 'warning' | 'info' | 'default'> = {
  URGENTE: 'danger',
  HAUTE: 'warning',
  MOYENNE: 'info',
  BASSE: 'default',
};

/** Badge colour per record status (Organizations + Contacts). */
export const RECORD_STATUS_BADGE: Record<string, 'success' | 'info' | 'default' | 'outline'> = {
  PROSPECT: 'info',
  ACTIF: 'success',
  INACTIF: 'default',
  ARCHIVE: 'outline',
};
