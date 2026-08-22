/**
 * METWORK OS CRM — full SQLite schema (29 tables).
 *
 * Canonical implementation of METWORK_OS_DATABASE_SCHEMA.md. Created in ONE
 * pass (Prompt 1) including tables whose UI arrives in Prompts 4–7, so later
 * prompts only ever touch application code, never migrations.
 *
 * Conventions (schema doc §0):
 *   - ids            TEXT PK, uuid v4
 *   - timestamps     TEXT, ISO 8601 UTC
 *   - dates          TEXT, YYYY-MM-DD
 *   - booleans       INTEGER 0/1
 *   - money          INTEGER, whole DZD (never a float)
 *   - json arrays    TEXT holding JSON
 *   - enums          TEXT + a CHECK constraint, typed in TS from the same tuple
 *   - outbound refs  `platform_*_id` — ids that live in the platform's JSON
 *                    store. NOT foreign keys; SQLite cannot verify them.
 *
 * Table declaration order below is a topological sort of the FK graph. SQLite
 * tolerates forward references in CREATE TABLE, but ordering keeps the
 * generated migration readable and the TS consts resolvable.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/* ─────────────────────────── helpers ─────────────────────────── */

/** Render a TS tuple as a SQL `IN (…)` list for a CHECK constraint. */
const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

/** `col IN ('A','B')` — keeps the DB constraint and the TS union in sync. */
const enumCheck = (name: string, column: string, values: readonly string[]) =>
  check(name, sql.raw(`"${column}" IN (${inList(values)})`));

/** `a IS NOT NULL OR b IS NOT NULL …` — the anti-orphan rule (dev rules, "No orphan data"). */
const anyNotNull = (...columns: string[]) =>
  columns.map((c) => `"${c}" IS NOT NULL`).join(' OR ');

/**
 * Audit columns present on every business table. A FACTORY, not a shared
 * object: drizzle column builders are stateful, so reusing instances across
 * tables silently corrupts the schema.
 */
const audit = () => ({
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  createdBy: text('created_by').references(() => internalUsers.id, { onDelete: 'set null' }),
});

/** The 8 polymorphic-ish link columns shared by interactions and tasks. */
const entityLinks = () => ({
  contactId: text('contact_id').references(() => crmContacts.id, { onDelete: 'set null' }),
  organizationId: text('organization_id').references(() => crmOrganizations.id, { onDelete: 'set null' }),
  opportunityId: text('opportunity_id').references(() => crmOpportunities.id, { onDelete: 'set null' }),
  startupId: text('startup_id').references(() => crmStartups.id, { onDelete: 'set null' }),
  expertId: text('expert_id').references(() => crmExperts.id, { onDelete: 'set null' }),
  partnershipId: text('partnership_id').references(() => crmPartnerships.id, { onDelete: 'set null' }),
  programId: text('program_id').references(() => crmPrograms.id, { onDelete: 'set null' }),
  oiProjectId: text('oi_project_id').references(() => crmOiProjects.id, { onDelete: 'set null' }),
});

const LINK_COLUMNS = [
  'contact_id',
  'organization_id',
  'opportunity_id',
  'startup_id',
  'expert_id',
  'partnership_id',
  'program_id',
  'oi_project_id',
] as const;

/* ─────────────────────────── enums ─────────────────────────── */

export const CRM_ROLES = ['ADMIN', 'TEAM_MEMBER'] as const;
export const ORG_TYPES = ['ENTREPRISE', 'STARTUP', 'INCUBATEUR', 'ACCELERATEUR', 'UNIVERSITE', 'INSTITUTION_PUBLIQUE', 'ONG_ASSOCIATION', 'INVESTISSEUR', 'MEDIA', 'AUTRE'] as const;
export const ORG_SIZES = ['1-10', '11-50', '51-200', '201-500', '500+'] as const;
export const RECORD_STATUSES = ['PROSPECT', 'ACTIF', 'INACTIF', 'ARCHIVE'] as const;
export const CONTACT_LANGUAGES = ['fr', 'ar', 'en'] as const;
export const INTERACTION_TYPES = ['APPEL', 'EMAIL', 'WHATSAPP', 'LINKEDIN', 'REUNION', 'VISIO', 'VISITE', 'RELANCE', 'PROPOSITION', 'DOCUMENT_ENVOYE', 'AUTRE'] as const;
export const INTERACTION_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export const TASK_PRIORITIES = ['URGENTE', 'HAUTE', 'MOYENNE', 'BASSE'] as const;
export const TASK_STATUSES = ['INBOX', 'A_FAIRE', 'EN_COURS', 'EN_ATTENTE', 'TERMINEE'] as const;
export const TASK_SOURCES = ['MANUAL', 'AUTOMATION'] as const;
export const OPPORTUNITY_TYPES = ['COWORKING', 'SALLE', 'PACK', 'INCUBATION', 'ACCELERATION', 'PRE_INCUBATION', 'CONSULTING', 'FORMATION', 'AUTRE'] as const;
export const OPPORTUNITY_STAGES = ['NOUVEAU_LEAD', 'CONTACTE', 'BESOIN_IDENTIFIE', 'PROPOSITION_ENVOYEE', 'RELANCE', 'NEGOCIATION', 'GAGNE', 'PERDU'] as const;
export const STARTUP_STAGES = ['LEAD', 'DIAGNOSTIC', 'BESOINS_IDENTIFIES', 'PROGRAMME_PACK', 'ONBOARDING', 'ACTIF', 'TERMINE', 'ALUMNI'] as const;
export const EXPERT_STAGES = ['PROSPECT', 'CONTACTE', 'ENTRETIEN', 'VALIDE', 'CONVENTION', 'ACTIF', 'INACTIF'] as const;
export const LINK_STATUSES = ['LINKED', 'CRM_ONLY'] as const;
export const MISSION_STATUSES = ['PREVUE', 'EN_COURS', 'TERMINEE', 'ANNULEE'] as const;
export const PARTNERSHIP_TYPES = ['CORPORATE', 'INCUBATEUR', 'ACCELERATEUR', 'UNIVERSITE', 'INSTITUTION', 'ONG', 'MEDIA', 'INVESTISSEUR', 'AUTRE'] as const;
export const PARTNERSHIP_STAGES = ['PROSPECT', 'CONTACTE', 'CONVERSATION', 'REUNION', 'PROPOSITION', 'NEGOCIATION', 'ACTIF', 'TERMINE'] as const;
export const OI_STAGES = ['ENTREPRISE_IDENTIFIEE', 'PROBLEME_IDENTIFIE', 'DIAGNOSTIC', 'DEFI_DEFINI', 'RECHERCHE_SOLUTION', 'STARTUPS_EXPERTS_MOBILISES', 'POC', 'EXPERIMENTATION', 'DEPLOIEMENT', 'TERMINE'] as const;
export const OI_PARTICIPANT_STATUSES = ['PRESSENTIE', 'MOBILISEE', 'RETENUE', 'ECARTEE'] as const;
export const PROGRAM_TYPES = ['FORMATION', 'BOOTCAMP', 'INCUBATION', 'ACCELERATION', 'EVENEMENT', 'WEBINAIRE', 'AUTRE'] as const;
export const PROGRAM_STAGES = ['IDEE', 'PLANIFICATION', 'FORMATEUR_CONFIRME', 'PROMOTION', 'INSCRIPTIONS', 'EN_COURS', 'TERMINE', 'REPORTING'] as const;
export const PARTICIPANT_STATUSES = ['INSCRIT', 'CONFIRME', 'PRESENT', 'ABSENT', 'ANNULE'] as const;
export const SPACE_TYPES = ['COWORKING', 'BUREAU_PRIVE', 'SALLE_REUNION', 'SALLE_FORMATION', 'EVENEMENT', 'DOMICILIATION', 'AUTRE'] as const;
export const BOOKING_STATUSES = ['DEMANDE', 'VERIFICATION_DISPO', 'DEVIS_ENVOYE', 'ATTENTE_CONFIRMATION', 'CONFIRME', 'PAYE', 'TERMINE', 'ANNULE'] as const;
export const PAYMENT_DIRECTIONS = ['IN', 'OUT'] as const;
export const PAYMENT_STATUSES = ['EN_ATTENTE', 'RELANCE_1', 'RELANCE_2', 'PAYE', 'ANNULE'] as const;
export const PAYMENT_METHODS = ['ESPECE', 'CHEQUE', 'VIREMENT', 'CARTE', 'AUTRE'] as const;
export const DOCUMENT_TYPES = ['CONVENTION', 'CONTRAT', 'PROPOSITION', 'PRESENTATION', 'DEVIS', 'FACTURE', 'NDA', 'PROGRAMME', 'SUPPORT_FORMATION', 'RAPPORT', 'AUTRE'] as const;
export const DOCUMENT_ENTITY_TYPES = ['ORGANIZATION', 'CONTACT', 'OPPORTUNITY', 'STARTUP', 'EXPERT', 'PARTNERSHIP', 'OI_PROJECT', 'PROGRAM', 'SPACE_BOOKING', 'PAYMENT', 'TASK'] as const;
export const NOTIFICATION_TYPES = ['TACHE_DUE', 'RELANCE_DUE', 'PAIEMENT_RETARD', 'REUNION_30MIN', 'OPPORTUNITE_INACTIVE', 'SYSTEME'] as const;
export const AUTOMATION_STATUSES = ['OK', 'ERREUR'] as const;

/* ═══════════════════════ 1. Authentication ═══════════════════════ */

export const internalUsers = sqliteTable(
  'internal_users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** Stored lowercased + trimmed. */
    email: text('email').notNull(),
    /** `scrypt$<saltHex>$<hashHex>` — produced by @/server/auth/password. */
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: CRM_ROLES }).notNull(),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
    /** Deactivate rather than delete: removal would break assignee/created_by everywhere. */
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastLoginAt: text('last_login_at'),
  },
  (t) => [
    uniqueIndex('idx_internal_users_email').on(t.email),
    enumCheck('internal_users_role_check', 'role', CRM_ROLES),
  ],
);

export const crmSessions = sqliteTable(
  'crm_sessions',
  {
    /** SHA-256 of the session id. The plaintext only ever lives in the cookie. */
    idHash: text('id_hash').primaryKey(),
    userId: text('user_id').notNull().references(() => internalUsers.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('idx_crm_sessions_user').on(t.userId),
    index('idx_crm_sessions_expires').on(t.expiresAt),
  ],
);

/* ═══════════════════════ 2. CRM core ═══════════════════════ */

export const crmOrganizations = sqliteTable(
  'crm_organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    type: text('type', { enum: ORG_TYPES }).notNull(),
    sector: text('sector'),
    size: text('size', { enum: ORG_SIZES }),
    city: text('city'),
    wilaya: text('wilaya'),
    country: text('country').notNull().default('DZ'),
    website: text('website'),
    linkedinUrl: text('linkedin_url'),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    description: text('description'),
    status: text('status', { enum: RECORD_STATUSES }).notNull().default('PROSPECT'),
    source: text('source'),
    ownerId: text('owner_id').references(() => internalUsers.id, { onDelete: 'set null' }),
    notes: text('notes'),
    /** (c) → IncubatorRecord.id in the JSON store. Not an FK. */
    platformIncubatorId: text('platform_incubator_id'),
    /** (c) → UserRecord.id in the JSON store. Not an FK. */
    platformUserId: text('platform_user_id'),
    /** Non-authoritative; `name` always wins here. See schema doc §7.4. */
    displayNameCache: text('display_name_cache'),
    ...audit(),
  },
  (t) => [
    index('idx_crm_org_name_nc').on(sql`"name" COLLATE NOCASE`),
    index('idx_crm_org_type').on(t.type),
    index('idx_crm_org_status').on(t.status),
    index('idx_crm_org_city').on(t.city),
    index('idx_crm_org_sector').on(t.sector),
    index('idx_crm_org_owner').on(t.ownerId),
    index('idx_crm_org_platform').on(t.platformIncubatorId),
    enumCheck('crm_org_type_check', 'type', ORG_TYPES),
    enumCheck('crm_org_status_check', 'status', RECORD_STATUSES),
  ],
);

export const crmContacts = sqliteTable(
  'crm_contacts',
  {
    id: text('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    fullName: text('full_name').generatedAlwaysAs(
      sql`("first_name" || ' ' || "last_name")`,
      { mode: 'stored' },
    ),
    position: text('position'),
    email: text('email'),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    linkedinUrl: text('linkedin_url'),
    city: text('city'),
    language: text('language', { enum: CONTACT_LANGUAGES }),
    primaryOrganizationId: text('primary_organization_id').references(() => crmOrganizations.id, { onDelete: 'set null' }),
    status: text('status', { enum: RECORD_STATUSES }).notNull().default('ACTIF'),
    /** e.g. 'CONTACT_FORM' when copied from the platform's contactSubmissions. */
    source: text('source'),
    /** e.g. ContactSubmissionRecord.id — traceability of the copy, not an FK. */
    sourceRef: text('source_ref'),
    ownerId: text('owner_id').references(() => internalUsers.id, { onDelete: 'set null' }),
    notes: text('notes'),
    platformUserId: text('platform_user_id'),
    platformMentorId: text('platform_mentor_id'),
    displayNameCache: text('display_name_cache'),
    ...audit(),
  },
  (t) => [
    index('idx_crm_contact_fullname_nc').on(sql`"full_name" COLLATE NOCASE`),
    index('idx_crm_contact_email_nc').on(sql`"email" COLLATE NOCASE`),
    index('idx_crm_contact_phone').on(t.phone),
    index('idx_crm_contact_org').on(t.primaryOrganizationId),
    index('idx_crm_contact_owner').on(t.ownerId),
    index('idx_crm_contact_status').on(t.status),
    enumCheck('crm_contact_status_check', 'status', RECORD_STATUSES),
  ],
);

export const crmContactOrganizations = sqliteTable(
  'crm_contact_organizations',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id').notNull().references(() => crmContacts.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').notNull().references(() => crmOrganizations.id, { onDelete: 'cascade' }),
    role: text('role'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_crm_co_pair').on(t.contactId, t.organizationId),
    index('idx_crm_co_org').on(t.organizationId),
  ],
);

/* ═══════════════════════ 3. Ecosystem ═══════════════════════ */

export const crmExperts = sqliteTable(
  'crm_experts',
  {
    id: text('id').primaryKey(),
    /** (c) → MentorRecord.id. Unique when present. */
    platformMentorId: text('platform_mentor_id'),
    linkStatus: text('link_status', { enum: LINK_STATUSES }).generatedAlwaysAs(
      sql`(CASE WHEN "platform_mentor_id" IS NULL THEN 'CRM_ONLY' ELSE 'LINKED' END)`,
      { mode: 'stored' },
    ),
    /** NULL on linked records — the name lives in the platform store. */
    name: text('name'),
    /** Search-authoritative here: `name` may be NULL. Schema doc §7.4. */
    displayNameCache: text('display_name_cache'),
    email: text('email'),
    phone: text('phone'),
    city: text('city'),
    /** JSON string[] */
    specialties: text('specialties'),
    pipelineStage: text('pipeline_stage', { enum: EXPERT_STAGES }).notNull().default('PROSPECT'),
    stageChangedAt: text('stage_changed_at').notNull(),
    dailyRate: integer('daily_rate'),
    organizationId: text('organization_id').references(() => crmOrganizations.id, { onDelete: 'set null' }),
    contactId: text('contact_id').references(() => crmContacts.id, { onDelete: 'set null' }),
    internalNotes: text('internal_notes'),
    ownerId: text('owner_id').references(() => internalUsers.id, { onDelete: 'set null' }),
    linkedAt: text('linked_at'),
    linkedBy: text('linked_by').references(() => internalUsers.id, { onDelete: 'set null' }),
    ...audit(),
  },
  (t) => [
    uniqueIndex('idx_crm_expert_mentor').on(t.platformMentorId).where(sql`"platform_mentor_id" IS NOT NULL`),
    index('idx_crm_expert_stage').on(t.pipelineStage),
    index('idx_crm_expert_link').on(t.linkStatus),
    index('idx_crm_expert_name_nc').on(sql`"name" COLLATE NOCASE`),
    index('idx_crm_expert_cache_nc').on(sql`"display_name_cache" COLLATE NOCASE`),
    enumCheck('crm_expert_stage_check', 'pipeline_stage', EXPERT_STAGES),
    check('crm_expert_identity_check', sql.raw(`"platform_mentor_id" IS NOT NULL OR "name" IS NOT NULL`)),
  ],
);

export const crmPrograms = sqliteTable(
  'crm_programs',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    type: text('type', { enum: PROGRAM_TYPES }).notNull(),
    stage: text('stage', { enum: PROGRAM_STAGES }).notNull().default('IDEE'),
    stageChangedAt: text('stage_changed_at').notNull(),
    startDate: text('start_date'),
    endDate: text('end_date'),
    city: text('city'),
    venue: text('venue'),
    capacity: integer('capacity'),
    /** Whole DZD. */
    price: integer('price'),
    description: text('description'),
    ownerId: text('owner_id').references(() => internalUsers.id, { onDelete: 'set null' }),
    /** (c) → ProgramRecord.id */
    platformProgramId: text('platform_program_id'),
    /** (c) → EventRecord.id */
    platformEventId: text('platform_event_id'),
    displayNameCache: text('display_name_cache'),
    ...audit(),
  },
  (t) => [
    index('idx_crm_prog_stage').on(t.stage),
    index('idx_crm_prog_dates').on(t.startDate),
    index('idx_crm_prog_title_nc').on(sql`"title" COLLATE NOCASE`),
    uniqueIndex('idx_crm_prog_platform_prog').on(t.platformProgramId).where(sql`"platform_program_id" IS NOT NULL`),
    uniqueIndex('idx_crm_prog_platform_event').on(t.platformEventId).where(sql`"platform_event_id" IS NOT NULL`),
    enumCheck('crm_prog_type_check', 'type', PROGRAM_TYPES),
    enumCheck('crm_prog_stage_check', 'stage', PROGRAM_STAGES),
    // At most one platform link — a CRM program is a program OR an event, never both.
    check('crm_prog_single_platform_link', sql.raw(`"platform_program_id" IS NULL OR "platform_event_id" IS NULL`)),
  ],
);

export const crmStartups = sqliteTable(
  'crm_startups',
  {
    id: text('id').primaryKey(),
    /** (c) → StartupListingRecord.id. Unique when present. */
    platformListingId: text('platform_listing_id'),
    linkStatus: text('link_status', { enum: LINK_STATUSES }).generatedAlwaysAs(
      sql`(CASE WHEN "platform_listing_id" IS NULL THEN 'CRM_ONLY' ELSE 'LINKED' END)`,
      { mode: 'stored' },
    ),
    /** NULL on linked records — never duplicate the platform listing's name. */
    name: text('name'),
    /** Search-authoritative here: `name` may be NULL. Schema doc §7.4. */
    displayNameCache: text('display_name_cache'),
    sector: text('sector'),
    /** Never present on StartupListing, so always CRM-owned. */
    city: text('city'),
    website: text('website'),
    description: text('description'),
    founderName: text('founder_name'),
    founderEmail: text('founder_email'),
    founderPhone: text('founder_phone'),
    organizationId: text('organization_id').references(() => crmOrganizations.id, { onDelete: 'set null' }),
    primaryContactId: text('primary_contact_id').references(() => crmContacts.id, { onDelete: 'set null' }),
    pipelineStage: text('pipeline_stage', { enum: STARTUP_STAGES }).notNull().default('LEAD'),
    stageChangedAt: text('stage_changed_at').notNull(),
    assignedExpertId: text('assigned_expert_id').references(() => crmExperts.id, { onDelete: 'set null' }),
    programId: text('program_id').references(() => crmPrograms.id, { onDelete: 'set null' }),
    ownerId: text('owner_id').references(() => internalUsers.id, { onDelete: 'set null' }),
    notes: text('notes'),
    linkedAt: text('linked_at'),
    linkedBy: text('linked_by').references(() => internalUsers.id, { onDelete: 'set null' }),
    ...audit(),
  },
  (t) => [
    uniqueIndex('idx_crm_startup_listing').on(t.platformListingId).where(sql`"platform_listing_id" IS NOT NULL`),
    index('idx_crm_startup_stage').on(t.pipelineStage),
    index('idx_crm_startup_link').on(t.linkStatus),
    index('idx_crm_startup_expert').on(t.assignedExpertId),
    index('idx_crm_startup_program').on(t.programId),
    index('idx_crm_startup_name_nc').on(sql`"name" COLLATE NOCASE`),
    index('idx_crm_startup_cache_nc').on(sql`"display_name_cache" COLLATE NOCASE`),
    enumCheck('crm_startup_stage_check', 'pipeline_stage', STARTUP_STAGES),
    check('crm_startup_identity_check', sql.raw(`"platform_listing_id" IS NOT NULL OR "name" IS NOT NULL`)),
  ],
);

export const crmOpportunities = sqliteTable(
  'crm_opportunities',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    organizationId: text('organization_id').references(() => crmOrganizations.id, { onDelete: 'set null' }),
    contactId: text('contact_id').references(() => crmContacts.id, { onDelete: 'set null' }),
    type: text('type', { enum: OPPORTUNITY_TYPES }).notNull(),
    stage: text('stage', { enum: OPPORTUNITY_STAGES }).notNull().default('NOUVEAU_LEAD'),
    /** Whole DZD. Hidden from TEAM_MEMBER everywhere (dev rules R-19). */
    amount: integer('amount'),
    probability: integer('probability'),
    expectedCloseDate: text('expected_close_date'),
    closedAt: text('closed_at'),
    lostReason: text('lost_reason'),
    source: text('source'),
    ownerId: text('owner_id').references(() => internalUsers.id, { onDelete: 'set null' }),
    description: text('description'),
    /** Drives the "stalled / inactive 7+ days" automation. */
    stageChangedAt: text('stage_changed_at').notNull(),
    lastActivityAt: text('last_activity_at'),
    ...audit(),
  },
  (t) => [
    index('idx_crm_opp_stage').on(t.stage),
    index('idx_crm_opp_org').on(t.organizationId),
    index('idx_crm_opp_contact').on(t.contactId),
    index('idx_crm_opp_owner').on(t.ownerId),
    index('idx_crm_opp_stale').on(t.stageChangedAt).where(sql`"stage" NOT IN ('GAGNE', 'PERDU')`),
    index('idx_crm_opp_close').on(t.expectedCloseDate),
    index('idx_crm_opp_title_nc').on(sql`"title" COLLATE NOCASE`),
    enumCheck('crm_opp_type_check', 'type', OPPORTUNITY_TYPES),
    enumCheck('crm_opp_stage_check', 'stage', OPPORTUNITY_STAGES),
    check('crm_opp_link_check', sql.raw(anyNotNull('organization_id', 'contact_id'))),
  ],
);

export const crmOpportunityStageHistory = sqliteTable(
  'crm_opportunity_stage_history',
  {
    id: text('id').primaryKey(),
    opportunityId: text('opportunity_id').notNull().references(() => crmOpportunities.id, { onDelete: 'cascade' }),
    fromStage: text('from_stage', { enum: OPPORTUNITY_STAGES }),
    toStage: text('to_stage', { enum: OPPORTUNITY_STAGES }).notNull(),
    changedAt: text('changed_at').notNull(),
    changedBy: text('changed_by').references(() => internalUsers.id, { onDelete: 'set null' }),
  },
  (t) => [index('idx_crm_opp_hist').on(t.opportunityId, t.changedAt)],
);

export const crmPartnerships = sqliteTable(
  'crm_partnerships',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** A partnership is always with an organization — RESTRICT protects history. */
    organizationId: text('organization_id').notNull().references(() => crmOrganizations.id, { onDelete: 'restrict' }),
    type: text('type', { enum: PARTNERSHIP_TYPES }).notNull(),
    stage: text('stage', { enum: PARTNERSHIP_STAGES }).notNull().default('PROSPECT'),
    stageChangedAt: text('stage_changed_at').notNull(),
    description: text('description'),
    valueAmount: integer('value_amount'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    renewalDate: text('renewal_date'),
    ownerId: text('owner_id').references(() => internalUsers.id, { onDelete: 'set null' }),
    /** (c) → PartnerMembershipRecord.id */
    platformPartnerMembershipId: text('platform_partner_membership_id'),
    displayNameCache: text('display_name_cache'),
    ...audit(),
  },
  (t) => [
    index('idx_crm_part_stage').on(t.stage),
    index('idx_crm_part_org').on(t.organizationId),
    index('idx_crm_part_name_nc').on(sql`"name" COLLATE NOCASE`),
    enumCheck('crm_part_type_check', 'type', PARTNERSHIP_TYPES),
    enumCheck('crm_part_stage_check', 'stage', PARTNERSHIP_STAGES),
  ],
);

export const crmPartnershipContacts = sqliteTable(
  'crm_partnership_contacts',
  {
    id: text('id').primaryKey(),
    partnershipId: text('partnership_id').notNull().references(() => crmPartnerships.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').notNull().references(() => crmContacts.id, { onDelete: 'cascade' }),
    role: text('role'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('idx_crm_partc_pair').on(t.partnershipId, t.contactId)],
);

export const crmOiProjects = sqliteTable(
  'crm_oi_projects',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    organizationId: text('organization_id').references(() => crmOrganizations.id, { onDelete: 'set null' }),
    contactId: text('contact_id').references(() => crmContacts.id, { onDelete: 'set null' }),
    partnershipId: text('partnership_id').references(() => crmPartnerships.id, { onDelete: 'set null' }),
    stage: text('stage', { enum: OI_STAGES }).notNull().default('ENTREPRISE_IDENTIFIEE'),
    stageChangedAt: text('stage_changed_at').notNull(),
    problemStatement: text('problem_statement'),
    challengeStatement: text('challenge_statement'),
    budget: integer('budget'),
    currency: text('currency').notNull().default('DZD'),
    startDate: text('start_date'),
    targetEndDate: text('target_end_date'),
    ownerId: text('owner_id').references(() => internalUsers.id, { onDelete: 'set null' }),
    notes: text('notes'),
    ...audit(),
  },
  (t) => [
    index('idx_crm_oi_stage').on(t.stage),
    index('idx_crm_oi_org').on(t.organizationId),
    index('idx_crm_oi_title_nc').on(sql`"title" COLLATE NOCASE`),
    enumCheck('crm_oi_stage_check', 'stage', OI_STAGES),
  ],
);

export const crmOiStartups = sqliteTable(
  'crm_oi_startups',
  {
    id: text('id').primaryKey(),
    oiProjectId: text('oi_project_id').notNull().references(() => crmOiProjects.id, { onDelete: 'cascade' }),
    startupId: text('startup_id').notNull().references(() => crmStartups.id, { onDelete: 'cascade' }),
    role: text('role'),
    status: text('status', { enum: OI_PARTICIPANT_STATUSES }).notNull().default('PRESSENTIE'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_crm_ois_pair').on(t.oiProjectId, t.startupId),
    enumCheck('crm_ois_status_check', 'status', OI_PARTICIPANT_STATUSES),
  ],
);

export const crmOiExperts = sqliteTable(
  'crm_oi_experts',
  {
    id: text('id').primaryKey(),
    oiProjectId: text('oi_project_id').notNull().references(() => crmOiProjects.id, { onDelete: 'cascade' }),
    expertId: text('expert_id').notNull().references(() => crmExperts.id, { onDelete: 'cascade' }),
    role: text('role'),
    status: text('status', { enum: OI_PARTICIPANT_STATUSES }).notNull().default('PRESSENTIE'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_crm_oie_pair').on(t.oiProjectId, t.expertId),
    enumCheck('crm_oie_status_check', 'status', OI_PARTICIPANT_STATUSES),
  ],
);

export const crmExpertMissions = sqliteTable(
  'crm_expert_missions',
  {
    id: text('id').primaryKey(),
    expertId: text('expert_id').notNull().references(() => crmExperts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    type: text('type'),
    startupId: text('startup_id').references(() => crmStartups.id, { onDelete: 'set null' }),
    programId: text('program_id').references(() => crmPrograms.id, { onDelete: 'set null' }),
    oiProjectId: text('oi_project_id').references(() => crmOiProjects.id, { onDelete: 'set null' }),
    organizationId: text('organization_id').references(() => crmOrganizations.id, { onDelete: 'set null' }),
    startDate: text('start_date'),
    endDate: text('end_date'),
    status: text('status', { enum: MISSION_STATUSES }).notNull().default('PREVUE'),
    amount: integer('amount'),
    notes: text('notes'),
    ...audit(),
  },
  (t) => [
    index('idx_crm_mission_expert').on(t.expertId, t.startDate),
    enumCheck('crm_mission_status_check', 'status', MISSION_STATUSES),
  ],
);

export const crmProgramParticipants = sqliteTable(
  'crm_program_participants',
  {
    id: text('id').primaryKey(),
    programId: text('program_id').notNull().references(() => crmPrograms.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').references(() => crmContacts.id, { onDelete: 'set null' }),
    startupId: text('startup_id').references(() => crmStartups.id, { onDelete: 'set null' }),
    organizationId: text('organization_id').references(() => crmOrganizations.id, { onDelete: 'set null' }),
    /** For walk-ins with no contact record. */
    fullName: text('full_name'),
    email: text('email'),
    phone: text('phone'),
    status: text('status', { enum: PARTICIPANT_STATUSES }).notNull().default('INSCRIT'),
    attended: integer('attended', { mode: 'boolean' }).notNull().default(false),
    satisfactionScore: integer('satisfaction_score'),
    amountDue: integer('amount_due'),
    /** (c) → RegistrationRecord.id */
    platformRegistrationId: text('platform_registration_id'),
    displayNameCache: text('display_name_cache'),
    ...audit(),
  },
  (t) => [
    index('idx_crm_pp_program').on(t.programId, t.status),
    index('idx_crm_pp_contact').on(t.contactId),
    enumCheck('crm_pp_status_check', 'status', PARTICIPANT_STATUSES),
    check('crm_pp_identity_check', sql.raw(anyNotNull('contact_id', 'full_name'))),
  ],
);

export const crmProgramTrainers = sqliteTable(
  'crm_program_trainers',
  {
    id: text('id').primaryKey(),
    programId: text('program_id').notNull().references(() => crmPrograms.id, { onDelete: 'cascade' }),
    expertId: text('expert_id').references(() => crmExperts.id, { onDelete: 'set null' }),
    fee: integer('fee'),
    confirmed: integer('confirmed', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('idx_crm_pt_pair').on(t.programId, t.expertId)],
);

export const crmProgramPartners = sqliteTable(
  'crm_program_partners',
  {
    id: text('id').primaryKey(),
    programId: text('program_id').notNull().references(() => crmPrograms.id, { onDelete: 'cascade' }),
    partnershipId: text('partnership_id').references(() => crmPartnerships.id, { onDelete: 'set null' }),
    organizationId: text('organization_id').references(() => crmOrganizations.id, { onDelete: 'set null' }),
    role: text('role'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_crm_ppart_program').on(t.programId),
    check('crm_ppart_link_check', sql.raw(anyNotNull('partnership_id', 'organization_id'))),
  ],
);

/* ═══════════════════════ 4. Spaces & payments ═══════════════════════ */

export const crmSpaceBookings = sqliteTable(
  'crm_space_bookings',
  {
    id: text('id').primaryKey(),
    reference: text('reference').notNull(),
    /** Free text — the team's own label, even when a platform space is referenced. */
    spaceLabel: text('space_label').notNull(),
    spaceType: text('space_type', { enum: SPACE_TYPES }).notNull(),
    organizationId: text('organization_id').references(() => crmOrganizations.id, { onDelete: 'set null' }),
    contactId: text('contact_id').references(() => crmContacts.id, { onDelete: 'set null' }),
    opportunityId: text('opportunity_id').references(() => crmOpportunities.id, { onDelete: 'set null' }),
    startAt: text('start_at'),
    endAt: text('end_at'),
    attendees: integer('attendees'),
    quotedAmount: integer('quoted_amount'),
    finalAmount: integer('final_amount'),
    status: text('status', { enum: BOOKING_STATUSES }).notNull().default('DEMANDE'),
    /**
     * (c) → SpaceRecord.id. A REFERENCE LABEL ONLY. This module is the team's
     * manual log: it never checks availability, never writes a BookingRecord or
     * DeskBookingRecord, never holds a slot. Product spec §4.13.
     */
    platformSpaceId: text('platform_space_id'),
    displayNameCache: text('display_name_cache'),
    notes: text('notes'),
    ownerId: text('owner_id').references(() => internalUsers.id, { onDelete: 'set null' }),
    ...audit(),
  },
  (t) => [
    uniqueIndex('idx_crm_book_reference').on(t.reference),
    index('idx_crm_book_status').on(t.status, t.startAt),
    index('idx_crm_book_org').on(t.organizationId),
    index('idx_crm_book_dates').on(t.startAt),
    enumCheck('crm_book_type_check', 'space_type', SPACE_TYPES),
    enumCheck('crm_book_status_check', 'status', BOOKING_STATUSES),
    check('crm_book_link_check', sql.raw(anyNotNull('organization_id', 'contact_id'))),
  ],
);

export const crmPayments = sqliteTable(
  'crm_payments',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    /** Whole DZD. ADMIN-only surface (dev rules R-19). */
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('DZD'),
    direction: text('direction', { enum: PAYMENT_DIRECTIONS }).notNull().default('IN'),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('EN_ATTENTE'),
    dueDate: text('due_date'),
    paidAt: text('paid_at'),
    method: text('method', { enum: PAYMENT_METHODS }),
    reminder1SentAt: text('reminder_1_sent_at'),
    reminder2SentAt: text('reminder_2_sent_at'),
    opportunityId: text('opportunity_id').references(() => crmOpportunities.id, { onDelete: 'set null' }),
    spaceBookingId: text('space_booking_id').references(() => crmSpaceBookings.id, { onDelete: 'set null' }),
    programId: text('program_id').references(() => crmPrograms.id, { onDelete: 'set null' }),
    organizationId: text('organization_id').references(() => crmOrganizations.id, { onDelete: 'set null' }),
    contactId: text('contact_id').references(() => crmContacts.id, { onDelete: 'set null' }),
    partnershipId: text('partnership_id').references(() => crmPartnerships.id, { onDelete: 'set null' }),
    oiProjectId: text('oi_project_id').references(() => crmOiProjects.id, { onDelete: 'set null' }),
    /**
     * Free text (e.g. a platform invoice number). Deliberately NOT a foreign
     * key: this module tracks operations, it is not accounting, and nothing
     * here references wallets / transactions / invoices / income.
     */
    externalRef: text('external_ref'),
    notes: text('notes'),
    ...audit(),
  },
  (t) => [
    index('idx_crm_pay_status_due').on(t.status, t.dueDate),
    index('idx_crm_pay_overdue').on(t.dueDate).where(sql`"status" IN ('EN_ATTENTE', 'RELANCE_1', 'RELANCE_2')`),
    index('idx_crm_pay_org').on(t.organizationId),
    enumCheck('crm_pay_direction_check', 'direction', PAYMENT_DIRECTIONS),
    enumCheck('crm_pay_status_check', 'status', PAYMENT_STATUSES),
    check(
      'crm_pay_link_check',
      sql.raw(anyNotNull('opportunity_id', 'space_booking_id', 'program_id', 'organization_id', 'contact_id', 'partnership_id', 'oi_project_id')),
    ),
  ],
);

/* ═══════════════════════ 5. Activity ═══════════════════════ */

export const crmTasks = sqliteTable(
  'crm_tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    priority: text('priority', { enum: TASK_PRIORITIES }).notNull().default('MOYENNE'),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('INBOX'),
    dueDate: text('due_date'),
    /** ISO — powers "meeting in 30 minutes". */
    dueAt: text('due_at'),
    completedAt: text('completed_at'),
    assigneeId: text('assignee_id').references(() => internalUsers.id, { onDelete: 'set null' }),
    ...entityLinks(),
    bookingId: text('booking_id').references(() => crmSpaceBookings.id, { onDelete: 'set null' }),
    paymentId: text('payment_id').references(() => crmPayments.id, { onDelete: 'set null' }),
    source: text('source', { enum: TASK_SOURCES }).notNull().default('MANUAL'),
    /** Idempotency key for auto-created tasks (Prompt 7). */
    automationKey: text('automation_key'),
    ...audit(),
  },
  (t) => [
    uniqueIndex('idx_crm_task_automation').on(t.automationKey).where(sql`"automation_key" IS NOT NULL`),
    index('idx_crm_task_assignee_due').on(t.assigneeId, t.dueDate),
    index('idx_crm_task_status_due').on(t.status, t.dueDate),
    index('idx_crm_task_open_due').on(t.dueDate).where(sql`"status" != 'TERMINEE'`),
    index('idx_crm_task_org').on(t.organizationId),
    index('idx_crm_task_contact').on(t.contactId),
    index('idx_crm_task_title_nc').on(sql`"title" COLLATE NOCASE`),
    enumCheck('crm_task_priority_check', 'priority', TASK_PRIORITIES),
    enumCheck('crm_task_status_check', 'status', TASK_STATUSES),
    enumCheck('crm_task_source_check', 'source', TASK_SOURCES),
    // No orphan tasks — must hang off at least one entity.
    check('crm_task_link_check', sql.raw(anyNotNull(...LINK_COLUMNS, 'booking_id', 'payment_id'))),
  ],
);

export const crmInteractions = sqliteTable(
  'crm_interactions',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: INTERACTION_TYPES }).notNull(),
    direction: text('direction', { enum: INTERACTION_DIRECTIONS }),
    subject: text('subject').notNull(),
    body: text('body'),
    occurredAt: text('occurred_at').notNull(),
    durationMinutes: integer('duration_minutes'),
    outcome: text('outcome'),
    ...entityLinks(),
    /** Feeds the dashboard's "Today" and "Overdue" views (Prompt 6). */
    nextAction: text('next_action'),
    nextActionDate: text('next_action_date'),
    nextActionDone: integer('next_action_done', { mode: 'boolean' }).notNull().default(false),
    ...audit(),
  },
  (t) => [
    index('idx_crm_int_org_time').on(t.organizationId, t.occurredAt),
    index('idx_crm_int_contact_time').on(t.contactId, t.occurredAt),
    index('idx_crm_int_opp_time').on(t.opportunityId, t.occurredAt),
    index('idx_crm_int_startup_time').on(t.startupId, t.occurredAt),
    index('idx_crm_int_next_action').on(t.nextActionDate).where(sql`"next_action_done" = 0`),
    index('idx_crm_int_subject_nc').on(sql`"subject" COLLATE NOCASE`),
    index('idx_crm_int_occurred').on(t.occurredAt),
    enumCheck('crm_int_type_check', 'type', INTERACTION_TYPES),
    check('crm_int_link_check', sql.raw(anyNotNull(...LINK_COLUMNS))),
  ],
);

/* ═══════════════════════ 6. Documents, notifications, system ═══════════════════════ */

export const crmDocuments = sqliteTable(
  'crm_documents',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    type: text('type', { enum: DOCUMENT_TYPES }).notNull(),
    /** Cloudinary secure_url. */
    fileUrl: text('file_url').notNull(),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    /** Required to ever delete the asset from Cloudinary. */
    cloudinaryPublicId: text('cloudinary_public_id'),
    uploadedBy: text('uploaded_by').references(() => internalUsers.id, { onDelete: 'set null' }),
    ...audit(),
  },
  (t) => [
    index('idx_crm_doc_type').on(t.type),
    index('idx_crm_doc_title_nc').on(sql`"title" COLLATE NOCASE`),
    enumCheck('crm_doc_type_check', 'type', DOCUMENT_TYPES),
  ],
);

export const crmDocumentLinks = sqliteTable(
  'crm_document_links',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull().references(() => crmDocuments.id, { onDelete: 'cascade' }),
    /**
     * Polymorphic by design: a document is often attached to several different
     * entity kinds. `entity_id` therefore cannot be a real FK — SQLite cannot
     * verify it. Mitigations (Prompt 5): document + >=1 link created in the same
     * transaction; entity deletion clears its links; Prompt 8 ships an integrity
     * script that reports dangling links. Schema doc §6.
     */
    entityType: text('entity_type', { enum: DOCUMENT_ENTITY_TYPES }).notNull(),
    entityId: text('entity_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_crm_doclink_unique').on(t.documentId, t.entityType, t.entityId),
    index('idx_crm_doclink_entity').on(t.entityType, t.entityId),
    enumCheck('crm_doclink_entity_check', 'entity_type', DOCUMENT_ENTITY_TYPES),
  ],
);

export const crmNotifications = sqliteTable(
  'crm_notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => internalUsers.id, { onDelete: 'cascade' }),
    type: text('type', { enum: NOTIFICATION_TYPES }).notNull(),
    title: text('title').notNull(),
    body: text('body'),
    href: text('href'),
    read: integer('read', { mode: 'boolean' }).notNull().default(false),
    readAt: text('read_at'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    /** Stops the same reminder firing repeatedly. */
    dedupeKey: text('dedupe_key'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_crm_notif_user_unread').on(t.userId, t.read, t.createdAt),
    uniqueIndex('idx_crm_notif_dedupe').on(t.dedupeKey).where(sql`"dedupe_key" IS NOT NULL`),
    enumCheck('crm_notif_type_check', 'type', NOTIFICATION_TYPES),
  ],
);

export const crmAutomationRuns = sqliteTable(
  'crm_automation_runs',
  {
    id: text('id').primaryKey(),
    automationKey: text('automation_key').notNull(),
    rule: text('rule').notNull(),
    triggerEntityType: text('trigger_entity_type'),
    triggerEntityId: text('trigger_entity_id'),
    status: text('status', { enum: AUTOMATION_STATUSES }).notNull(),
    error: text('error'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_crm_autorun_key').on(t.automationKey),
    enumCheck('crm_autorun_status_check', 'status', AUTOMATION_STATUSES),
  ],
);

export const crmActivityLog = sqliteTable(
  'crm_activity_log',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').references(() => internalUsers.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    /** JSON diff. */
    diff: text('diff'),
    ip: text('ip'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_crm_log_entity').on(t.entityType, t.entityId, t.createdAt),
    index('idx_crm_log_actor').on(t.actorId, t.createdAt),
  ],
);

export const crmSettings = sqliteTable(
  'crm_settings',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    value: text('value'),
    updatedAt: text('updated_at').notNull(),
    updatedBy: text('updated_by').references(() => internalUsers.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('idx_crm_settings_key').on(t.key)],
);

/* ─────────────────────────── inferred types ─────────────────────────── */

export type InternalUser = typeof internalUsers.$inferSelect;
export type NewInternalUser = typeof internalUsers.$inferInsert;
export type CrmSession = typeof crmSessions.$inferSelect;
export type CrmRole = (typeof CRM_ROLES)[number];
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Every table, for the schema-verification script and tests. Keep in sync when
 * a table is added — the verify script asserts this list matches the database.
 */
export const CRM_TABLE_NAMES = [
  'internal_users',
  'crm_sessions',
  'crm_organizations',
  'crm_contacts',
  'crm_contact_organizations',
  'crm_experts',
  'crm_programs',
  'crm_startups',
  'crm_opportunities',
  'crm_opportunity_stage_history',
  'crm_partnerships',
  'crm_partnership_contacts',
  'crm_oi_projects',
  'crm_oi_startups',
  'crm_oi_experts',
  'crm_expert_missions',
  'crm_program_participants',
  'crm_program_trainers',
  'crm_program_partners',
  'crm_space_bookings',
  'crm_payments',
  'crm_tasks',
  'crm_interactions',
  'crm_documents',
  'crm_document_links',
  'crm_notifications',
  'crm_automation_runs',
  'crm_activity_log',
  'crm_settings',
] as const;
