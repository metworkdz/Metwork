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

export const LINK_STATUS_LABELS: Record<string, string> = {
  LINKED: 'Lié à la plateforme',
  CRM_ONLY: 'CRM uniquement',
};

export const OPPORTUNITY_TYPE_LABELS: Record<string, string> = {
  COWORKING: 'Coworking',
  SALLE: 'Salle',
  PACK: 'Pack',
  INCUBATION: 'Incubation',
  ACCELERATION: 'Accélération',
  PRE_INCUBATION: 'Pré-incubation',
  CONSULTING: 'Conseil',
  FORMATION: 'Formation',
  AUTRE: 'Autre',
};

export const OPPORTUNITY_STAGE_LABELS: Record<string, string> = {
  NOUVEAU_LEAD: 'Nouveau lead',
  CONTACTE: 'Contacté',
  BESOIN_IDENTIFIE: 'Besoin identifié',
  PROPOSITION_ENVOYEE: 'Proposition envoyée',
  RELANCE: 'Relance',
  NEGOCIATION: 'Négociation',
  GAGNE: 'Gagné',
  PERDU: 'Perdu',
};

export const OPPORTUNITY_STAGE_BADGE: Record<string, 'success' | 'info' | 'default' | 'warning' | 'danger'> = {
  NOUVEAU_LEAD: 'default',
  CONTACTE: 'info',
  BESOIN_IDENTIFIE: 'info',
  PROPOSITION_ENVOYEE: 'warning',
  RELANCE: 'warning',
  NEGOCIATION: 'warning',
  GAGNE: 'success',
  PERDU: 'danger',
};

export const STARTUP_STAGE_LABELS: Record<string, string> = {
  LEAD: 'Lead',
  DIAGNOSTIC: 'Diagnostic',
  BESOINS_IDENTIFIES: 'Besoins identifiés',
  PROGRAMME_PACK: 'Programme / Pack',
  ONBOARDING: 'Onboarding',
  ACTIF: 'Actif',
  TERMINE: 'Terminé',
  ALUMNI: 'Alumni',
};

export const STARTUP_STAGE_BADGE: Record<string, 'success' | 'info' | 'default' | 'warning'> = {
  LEAD: 'default',
  DIAGNOSTIC: 'info',
  BESOINS_IDENTIFIES: 'info',
  PROGRAMME_PACK: 'warning',
  ONBOARDING: 'warning',
  ACTIF: 'success',
  TERMINE: 'success',
  ALUMNI: 'default',
};

export const EXPERT_STAGE_LABELS: Record<string, string> = {
  PROSPECT: 'Prospect',
  CONTACTE: 'Contacté',
  ENTRETIEN: 'Entretien',
  VALIDE: 'Validé',
  CONVENTION: 'Convention',
  ACTIF: 'Actif',
  INACTIF: 'Inactif',
};

export const EXPERT_STAGE_BADGE: Record<string, 'success' | 'info' | 'default' | 'warning'> = {
  PROSPECT: 'default',
  CONTACTE: 'info',
  ENTRETIEN: 'info',
  VALIDE: 'warning',
  CONVENTION: 'warning',
  ACTIF: 'success',
  INACTIF: 'default',
};

export const PARTNERSHIP_TYPE_LABELS: Record<string, string> = {
  CORPORATE: 'Entreprise',
  INCUBATEUR: 'Incubateur',
  ACCELERATEUR: 'Accélérateur',
  UNIVERSITE: 'Université',
  INSTITUTION: 'Institution',
  ONG: 'ONG',
  MEDIA: 'Média',
  INVESTISSEUR: 'Investisseur',
  AUTRE: 'Autre',
};

export const PARTNERSHIP_STAGE_LABELS: Record<string, string> = {
  PROSPECT: 'Prospect',
  CONTACTE: 'Contacté',
  CONVERSATION: 'Conversation',
  REUNION: 'Réunion',
  PROPOSITION: 'Proposition',
  NEGOCIATION: 'Négociation',
  ACTIF: 'Actif',
  TERMINE: 'Terminé',
};

export const PARTNERSHIP_STAGE_BADGE: Record<string, 'success' | 'info' | 'default' | 'warning'> = {
  PROSPECT: 'default',
  CONTACTE: 'info',
  CONVERSATION: 'info',
  REUNION: 'warning',
  PROPOSITION: 'warning',
  NEGOCIATION: 'warning',
  ACTIF: 'success',
  TERMINE: 'success',
};

/** Open Innovation pipeline — product spec's 10-stage journey, in order. */
export const OI_STAGE_LABELS: Record<string, string> = {
  ENTREPRISE_IDENTIFIEE: 'Entreprise identifiée',
  PROBLEME_IDENTIFIE: 'Problème identifié',
  DIAGNOSTIC: 'Diagnostic',
  DEFI_DEFINI: 'Défi défini',
  RECHERCHE_SOLUTION: 'Recherche de solution',
  STARTUPS_EXPERTS_MOBILISES: 'Startups/experts mobilisés',
  POC: 'POC',
  EXPERIMENTATION: 'Expérimentation',
  DEPLOIEMENT: 'Déploiement',
  TERMINE: 'Terminé',
};

export const OI_PARTICIPANT_STATUS_LABELS: Record<string, string> = {
  PRESSENTIE: 'Pressentie',
  MOBILISEE: 'Mobilisée',
  RETENUE: 'Retenue',
  ECARTEE: 'Écartée',
};

export const OI_PARTICIPANT_STATUS_BADGE: Record<string, 'success' | 'info' | 'default' | 'danger'> = {
  PRESSENTIE: 'default',
  MOBILISEE: 'info',
  RETENUE: 'success',
  ECARTEE: 'danger',
};

export const PROGRAM_TYPE_LABELS: Record<string, string> = {
  FORMATION: 'Formation',
  BOOTCAMP: 'Bootcamp',
  INCUBATION: 'Incubation',
  ACCELERATION: 'Accélération',
  EVENEMENT: 'Événement',
  WEBINAIRE: 'Webinaire',
  AUTRE: 'Autre',
};

/** Programs & Events pipeline — product spec's 8-stage journey, in order. */
export const PROGRAM_STAGE_LABELS: Record<string, string> = {
  IDEE: 'Idée',
  PLANIFICATION: 'Planification',
  FORMATEUR_CONFIRME: 'Formateur confirmé',
  PROMOTION: 'Promotion',
  INSCRIPTIONS: 'Inscriptions',
  EN_COURS: 'En cours',
  TERMINE: 'Terminé',
  REPORTING: 'Reporting',
};

export const PARTICIPANT_STATUS_LABELS: Record<string, string> = {
  INSCRIT: 'Inscrit',
  CONFIRME: 'Confirmé',
  PRESENT: 'Présent',
  ABSENT: 'Absent',
  ANNULE: 'Annulé',
};

export const PARTICIPANT_STATUS_BADGE: Record<string, 'success' | 'info' | 'default' | 'danger' | 'warning'> = {
  INSCRIT: 'default',
  CONFIRME: 'info',
  PRESENT: 'success',
  ABSENT: 'warning',
  ANNULE: 'danger',
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  CONVENTION: 'Convention',
  CONTRAT: 'Contrat',
  PROPOSITION: 'Proposition',
  PRESENTATION: 'Présentation',
  DEVIS: 'Devis',
  FACTURE: 'Facture',
  NDA: 'NDA',
  PROGRAMME: 'Programme',
  SUPPORT_FORMATION: 'Support de formation',
  RAPPORT: 'Rapport',
  AUTRE: 'Autre',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  EN_ATTENTE: 'En attente',
  RELANCE_1: 'Relance 1',
  RELANCE_2: 'Relance 2',
  PAYE: 'Payé',
  ANNULE: 'Annulé',
};

export const PAYMENT_STATUS_BADGE: Record<string, 'success' | 'info' | 'default' | 'danger' | 'warning'> = {
  EN_ATTENTE: 'default',
  RELANCE_1: 'warning',
  RELANCE_2: 'warning',
  PAYE: 'success',
  ANNULE: 'danger',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  ESPECE: 'Espèces',
  CHEQUE: 'Chèque',
  VIREMENT: 'Virement',
  CARTE: 'Carte',
  AUTRE: 'Autre',
};

export const SPACE_TYPE_LABELS: Record<string, string> = {
  COWORKING: 'Coworking',
  BUREAU_PRIVE: 'Bureau privé',
  SALLE_REUNION: 'Salle de réunion',
  SALLE_FORMATION: 'Salle de formation',
  EVENEMENT: 'Événement',
  DOMICILIATION: 'Domiciliation',
  AUTRE: 'Autre',
};

/** Space bookings pipeline — product spec §4.13, in order. */
export const BOOKING_STATUS_LABELS: Record<string, string> = {
  DEMANDE: 'Demande',
  VERIFICATION_DISPO: 'Vérification dispo.',
  DEVIS_ENVOYE: 'Devis envoyé',
  ATTENTE_CONFIRMATION: 'Attente confirmation',
  CONFIRME: 'Confirmé',
  PAYE: 'Payé',
  TERMINE: 'Terminé',
  ANNULE: 'Annulé',
};

export const BOOKING_STATUS_BADGE: Record<string, 'success' | 'info' | 'default' | 'warning' | 'danger'> = {
  DEMANDE: 'default',
  VERIFICATION_DISPO: 'info',
  DEVIS_ENVOYE: 'info',
  ATTENTE_CONFIRMATION: 'warning',
  CONFIRME: 'warning',
  PAYE: 'success',
  TERMINE: 'success',
  ANNULE: 'danger',
};
