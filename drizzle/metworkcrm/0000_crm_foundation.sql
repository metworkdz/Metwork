CREATE TABLE `crm_activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`diff` text,
	`ip` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_crm_log_entity` ON `crm_activity_log` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_log_actor` ON `crm_activity_log` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `crm_automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_key` text NOT NULL,
	`rule` text NOT NULL,
	`trigger_entity_type` text,
	`trigger_entity_id` text,
	`status` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	CONSTRAINT "crm_autorun_status_check" CHECK("status" IN ('OK', 'ERREUR'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_autorun_key` ON `crm_automation_runs` (`automation_key`);--> statement-breakpoint
CREATE TABLE `crm_contact_organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`role` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `crm_contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_co_pair` ON `crm_contact_organizations` (`contact_id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_co_org` ON `crm_contact_organizations` (`organization_id`);--> statement-breakpoint
CREATE TABLE `crm_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`full_name` text GENERATED ALWAYS AS (("first_name" || ' ' || "last_name")) STORED,
	`position` text,
	`email` text,
	`phone` text,
	`whatsapp` text,
	`linkedin_url` text,
	`city` text,
	`language` text,
	`primary_organization_id` text,
	`status` text DEFAULT 'ACTIF' NOT NULL,
	`source` text,
	`source_ref` text,
	`owner_id` text,
	`notes` text,
	`platform_user_id` text,
	`platform_mentor_id` text,
	`display_name_cache` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`primary_organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_contact_status_check" CHECK("status" IN ('PROSPECT', 'ACTIF', 'INACTIF', 'ARCHIVE'))
);
--> statement-breakpoint
CREATE INDEX `idx_crm_contact_fullname_nc` ON `crm_contacts` ("full_name" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `idx_crm_contact_email_nc` ON `crm_contacts` ("email" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `idx_crm_contact_phone` ON `crm_contacts` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_crm_contact_org` ON `crm_contacts` (`primary_organization_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_contact_owner` ON `crm_contacts` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_contact_status` ON `crm_contacts` (`status`);--> statement-breakpoint
CREATE TABLE `crm_document_links` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `crm_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "crm_doclink_entity_check" CHECK("entity_type" IN ('ORGANIZATION', 'CONTACT', 'OPPORTUNITY', 'STARTUP', 'EXPERT', 'PARTNERSHIP', 'OI_PROJECT', 'PROGRAM', 'SPACE_BOOKING', 'PAYMENT', 'TASK'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_doclink_unique` ON `crm_document_links` (`document_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_doclink_entity` ON `crm_document_links` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `crm_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`file_url` text NOT NULL,
	`file_name` text,
	`mime_type` text,
	`size_bytes` integer,
	`cloudinary_public_id` text,
	`uploaded_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`uploaded_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_doc_type_check" CHECK("type" IN ('CONVENTION', 'CONTRAT', 'PROPOSITION', 'PRESENTATION', 'DEVIS', 'FACTURE', 'NDA', 'PROGRAMME', 'SUPPORT_FORMATION', 'RAPPORT', 'AUTRE'))
);
--> statement-breakpoint
CREATE INDEX `idx_crm_doc_type` ON `crm_documents` (`type`);--> statement-breakpoint
CREATE INDEX `idx_crm_doc_title_nc` ON `crm_documents` ("title" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `crm_expert_missions` (
	`id` text PRIMARY KEY NOT NULL,
	`expert_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text,
	`startup_id` text,
	`program_id` text,
	`oi_project_id` text,
	`organization_id` text,
	`start_date` text,
	`end_date` text,
	`status` text DEFAULT 'PREVUE' NOT NULL,
	`amount` integer,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`expert_id`) REFERENCES `crm_experts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`startup_id`) REFERENCES `crm_startups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`program_id`) REFERENCES `crm_programs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`oi_project_id`) REFERENCES `crm_oi_projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_mission_status_check" CHECK("status" IN ('PREVUE', 'EN_COURS', 'TERMINEE', 'ANNULEE'))
);
--> statement-breakpoint
CREATE INDEX `idx_crm_mission_expert` ON `crm_expert_missions` (`expert_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `crm_experts` (
	`id` text PRIMARY KEY NOT NULL,
	`platform_mentor_id` text,
	`link_status` text GENERATED ALWAYS AS ((CASE WHEN "platform_mentor_id" IS NULL THEN 'CRM_ONLY' ELSE 'LINKED' END)) STORED,
	`name` text,
	`display_name_cache` text,
	`email` text,
	`phone` text,
	`city` text,
	`specialties` text,
	`pipeline_stage` text DEFAULT 'PROSPECT' NOT NULL,
	`stage_changed_at` text NOT NULL,
	`daily_rate` integer,
	`organization_id` text,
	`contact_id` text,
	`internal_notes` text,
	`owner_id` text,
	`linked_at` text,
	`linked_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `crm_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_expert_stage_check" CHECK("pipeline_stage" IN ('PROSPECT', 'CONTACTE', 'ENTRETIEN', 'VALIDE', 'CONVENTION', 'ACTIF', 'INACTIF')),
	CONSTRAINT "crm_expert_identity_check" CHECK("platform_mentor_id" IS NOT NULL OR "name" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_expert_mentor` ON `crm_experts` (`platform_mentor_id`) WHERE "platform_mentor_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_crm_expert_stage` ON `crm_experts` (`pipeline_stage`);--> statement-breakpoint
CREATE INDEX `idx_crm_expert_link` ON `crm_experts` (`link_status`);--> statement-breakpoint
CREATE INDEX `idx_crm_expert_name_nc` ON `crm_experts` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `idx_crm_expert_cache_nc` ON `crm_experts` ("display_name_cache" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `crm_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`direction` text,
	`subject` text NOT NULL,
	`body` text,
	`occurred_at` text NOT NULL,
	`duration_minutes` integer,
	`outcome` text,
	`contact_id` text,
	`organization_id` text,
	`opportunity_id` text,
	`startup_id` text,
	`expert_id` text,
	`partnership_id` text,
	`program_id` text,
	`oi_project_id` text,
	`next_action` text,
	`next_action_date` text,
	`next_action_done` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`contact_id`) REFERENCES `crm_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`opportunity_id`) REFERENCES `crm_opportunities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`startup_id`) REFERENCES `crm_startups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`expert_id`) REFERENCES `crm_experts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`partnership_id`) REFERENCES `crm_partnerships`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`program_id`) REFERENCES `crm_programs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`oi_project_id`) REFERENCES `crm_oi_projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_int_type_check" CHECK("type" IN ('APPEL', 'EMAIL', 'WHATSAPP', 'LINKEDIN', 'REUNION', 'VISIO', 'VISITE', 'RELANCE', 'PROPOSITION', 'DOCUMENT_ENVOYE', 'AUTRE')),
	CONSTRAINT "crm_int_link_check" CHECK("contact_id" IS NOT NULL OR "organization_id" IS NOT NULL OR "opportunity_id" IS NOT NULL OR "startup_id" IS NOT NULL OR "expert_id" IS NOT NULL OR "partnership_id" IS NOT NULL OR "program_id" IS NOT NULL OR "oi_project_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_crm_int_org_time` ON `crm_interactions` (`organization_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_int_contact_time` ON `crm_interactions` (`contact_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_int_opp_time` ON `crm_interactions` (`opportunity_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_int_startup_time` ON `crm_interactions` (`startup_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_int_next_action` ON `crm_interactions` (`next_action_date`) WHERE "next_action_done" = 0;--> statement-breakpoint
CREATE INDEX `idx_crm_int_subject_nc` ON `crm_interactions` ("subject" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `idx_crm_int_occurred` ON `crm_interactions` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `crm_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`href` text,
	`read` integer DEFAULT false NOT NULL,
	`read_at` text,
	`entity_type` text,
	`entity_id` text,
	`dedupe_key` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "crm_notif_type_check" CHECK("type" IN ('TACHE_DUE', 'RELANCE_DUE', 'PAIEMENT_RETARD', 'REUNION_30MIN', 'OPPORTUNITE_INACTIVE', 'SYSTEME'))
);
--> statement-breakpoint
CREATE INDEX `idx_crm_notif_user_unread` ON `crm_notifications` (`user_id`,`read`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_notif_dedupe` ON `crm_notifications` (`dedupe_key`) WHERE "dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `crm_oi_experts` (
	`id` text PRIMARY KEY NOT NULL,
	`oi_project_id` text NOT NULL,
	`expert_id` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'PRESSENTIE' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`oi_project_id`) REFERENCES `crm_oi_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`expert_id`) REFERENCES `crm_experts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "crm_oie_status_check" CHECK("status" IN ('PRESSENTIE', 'MOBILISEE', 'RETENUE', 'ECARTEE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_oie_pair` ON `crm_oi_experts` (`oi_project_id`,`expert_id`);--> statement-breakpoint
CREATE TABLE `crm_oi_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`organization_id` text,
	`contact_id` text,
	`partnership_id` text,
	`stage` text DEFAULT 'ENTREPRISE_IDENTIFIEE' NOT NULL,
	`stage_changed_at` text NOT NULL,
	`problem_statement` text,
	`challenge_statement` text,
	`budget` integer,
	`currency` text DEFAULT 'DZD' NOT NULL,
	`start_date` text,
	`target_end_date` text,
	`owner_id` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `crm_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`partnership_id`) REFERENCES `crm_partnerships`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_oi_stage_check" CHECK("stage" IN ('ENTREPRISE_IDENTIFIEE', 'PROBLEME_IDENTIFIE', 'DIAGNOSTIC', 'DEFI_DEFINI', 'RECHERCHE_SOLUTION', 'STARTUPS_EXPERTS_MOBILISES', 'POC', 'EXPERIMENTATION', 'DEPLOIEMENT', 'TERMINE'))
);
--> statement-breakpoint
CREATE INDEX `idx_crm_oi_stage` ON `crm_oi_projects` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_crm_oi_org` ON `crm_oi_projects` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_oi_title_nc` ON `crm_oi_projects` ("title" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `crm_oi_startups` (
	`id` text PRIMARY KEY NOT NULL,
	`oi_project_id` text NOT NULL,
	`startup_id` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'PRESSENTIE' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`oi_project_id`) REFERENCES `crm_oi_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`startup_id`) REFERENCES `crm_startups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "crm_ois_status_check" CHECK("status" IN ('PRESSENTIE', 'MOBILISEE', 'RETENUE', 'ECARTEE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_ois_pair` ON `crm_oi_startups` (`oi_project_id`,`startup_id`);--> statement-breakpoint
CREATE TABLE `crm_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`organization_id` text,
	`contact_id` text,
	`type` text NOT NULL,
	`stage` text DEFAULT 'NOUVEAU_LEAD' NOT NULL,
	`amount` integer,
	`probability` integer,
	`expected_close_date` text,
	`closed_at` text,
	`lost_reason` text,
	`source` text,
	`owner_id` text,
	`description` text,
	`stage_changed_at` text NOT NULL,
	`last_activity_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `crm_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_opp_type_check" CHECK("type" IN ('COWORKING', 'SALLE', 'PACK', 'INCUBATION', 'ACCELERATION', 'PRE_INCUBATION', 'CONSULTING', 'FORMATION', 'AUTRE')),
	CONSTRAINT "crm_opp_stage_check" CHECK("stage" IN ('NOUVEAU_LEAD', 'CONTACTE', 'BESOIN_IDENTIFIE', 'PROPOSITION_ENVOYEE', 'RELANCE', 'NEGOCIATION', 'GAGNE', 'PERDU')),
	CONSTRAINT "crm_opp_link_check" CHECK("organization_id" IS NOT NULL OR "contact_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_crm_opp_stage` ON `crm_opportunities` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_crm_opp_org` ON `crm_opportunities` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_opp_contact` ON `crm_opportunities` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_opp_owner` ON `crm_opportunities` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_opp_stale` ON `crm_opportunities` (`stage_changed_at`) WHERE "stage" NOT IN ('GAGNE', 'PERDU');--> statement-breakpoint
CREATE INDEX `idx_crm_opp_close` ON `crm_opportunities` (`expected_close_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_opp_title_nc` ON `crm_opportunities` ("title" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `crm_opportunity_stage_history` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`from_stage` text,
	`to_stage` text NOT NULL,
	`changed_at` text NOT NULL,
	`changed_by` text,
	FOREIGN KEY (`opportunity_id`) REFERENCES `crm_opportunities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_crm_opp_hist` ON `crm_opportunity_stage_history` (`opportunity_id`,`changed_at`);--> statement-breakpoint
CREATE TABLE `crm_organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`legal_name` text,
	`type` text NOT NULL,
	`sector` text,
	`size` text,
	`city` text,
	`wilaya` text,
	`country` text DEFAULT 'DZ' NOT NULL,
	`website` text,
	`linkedin_url` text,
	`email` text,
	`phone` text,
	`address` text,
	`description` text,
	`status` text DEFAULT 'PROSPECT' NOT NULL,
	`source` text,
	`owner_id` text,
	`notes` text,
	`platform_incubator_id` text,
	`platform_user_id` text,
	`display_name_cache` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`owner_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_org_type_check" CHECK("type" IN ('ENTREPRISE', 'STARTUP', 'INCUBATEUR', 'ACCELERATEUR', 'UNIVERSITE', 'INSTITUTION_PUBLIQUE', 'ONG_ASSOCIATION', 'INVESTISSEUR', 'MEDIA', 'AUTRE')),
	CONSTRAINT "crm_org_status_check" CHECK("status" IN ('PROSPECT', 'ACTIF', 'INACTIF', 'ARCHIVE'))
);
--> statement-breakpoint
CREATE INDEX `idx_crm_org_name_nc` ON `crm_organizations` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `idx_crm_org_type` ON `crm_organizations` (`type`);--> statement-breakpoint
CREATE INDEX `idx_crm_org_status` ON `crm_organizations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_org_city` ON `crm_organizations` (`city`);--> statement-breakpoint
CREATE INDEX `idx_crm_org_sector` ON `crm_organizations` (`sector`);--> statement-breakpoint
CREATE INDEX `idx_crm_org_owner` ON `crm_organizations` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_org_platform` ON `crm_organizations` (`platform_incubator_id`);--> statement-breakpoint
CREATE TABLE `crm_partnership_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`partnership_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`role` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`partnership_id`) REFERENCES `crm_partnerships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `crm_contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_partc_pair` ON `crm_partnership_contacts` (`partnership_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `crm_partnerships` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`stage` text DEFAULT 'PROSPECT' NOT NULL,
	`stage_changed_at` text NOT NULL,
	`description` text,
	`value_amount` integer,
	`start_date` text,
	`end_date` text,
	`renewal_date` text,
	`owner_id` text,
	`platform_partner_membership_id` text,
	`display_name_cache` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_part_type_check" CHECK("type" IN ('CORPORATE', 'INCUBATEUR', 'ACCELERATEUR', 'UNIVERSITE', 'INSTITUTION', 'ONG', 'MEDIA', 'INVESTISSEUR', 'AUTRE')),
	CONSTRAINT "crm_part_stage_check" CHECK("stage" IN ('PROSPECT', 'CONTACTE', 'CONVERSATION', 'REUNION', 'PROPOSITION', 'NEGOCIATION', 'ACTIF', 'TERMINE'))
);
--> statement-breakpoint
CREATE INDEX `idx_crm_part_stage` ON `crm_partnerships` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_crm_part_org` ON `crm_partnerships` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_part_name_nc` ON `crm_partnerships` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `crm_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'DZD' NOT NULL,
	`direction` text DEFAULT 'IN' NOT NULL,
	`status` text DEFAULT 'EN_ATTENTE' NOT NULL,
	`due_date` text,
	`paid_at` text,
	`method` text,
	`reminder_1_sent_at` text,
	`reminder_2_sent_at` text,
	`opportunity_id` text,
	`space_booking_id` text,
	`program_id` text,
	`organization_id` text,
	`contact_id` text,
	`partnership_id` text,
	`oi_project_id` text,
	`external_ref` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`opportunity_id`) REFERENCES `crm_opportunities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`space_booking_id`) REFERENCES `crm_space_bookings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`program_id`) REFERENCES `crm_programs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `crm_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`partnership_id`) REFERENCES `crm_partnerships`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`oi_project_id`) REFERENCES `crm_oi_projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_pay_direction_check" CHECK("direction" IN ('IN', 'OUT')),
	CONSTRAINT "crm_pay_status_check" CHECK("status" IN ('EN_ATTENTE', 'RELANCE_1', 'RELANCE_2', 'PAYE', 'ANNULE')),
	CONSTRAINT "crm_pay_link_check" CHECK("opportunity_id" IS NOT NULL OR "space_booking_id" IS NOT NULL OR "program_id" IS NOT NULL OR "organization_id" IS NOT NULL OR "contact_id" IS NOT NULL OR "partnership_id" IS NOT NULL OR "oi_project_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_crm_pay_status_due` ON `crm_payments` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_pay_overdue` ON `crm_payments` (`due_date`) WHERE "status" IN ('EN_ATTENTE', 'RELANCE_1', 'RELANCE_2');--> statement-breakpoint
CREATE INDEX `idx_crm_pay_org` ON `crm_payments` (`organization_id`);--> statement-breakpoint
CREATE TABLE `crm_program_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`contact_id` text,
	`startup_id` text,
	`organization_id` text,
	`full_name` text,
	`email` text,
	`phone` text,
	`status` text DEFAULT 'INSCRIT' NOT NULL,
	`attended` integer DEFAULT false NOT NULL,
	`satisfaction_score` integer,
	`amount_due` integer,
	`platform_registration_id` text,
	`display_name_cache` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`program_id`) REFERENCES `crm_programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `crm_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`startup_id`) REFERENCES `crm_startups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_pp_status_check" CHECK("status" IN ('INSCRIT', 'CONFIRME', 'PRESENT', 'ABSENT', 'ANNULE')),
	CONSTRAINT "crm_pp_identity_check" CHECK("contact_id" IS NOT NULL OR "full_name" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_crm_pp_program` ON `crm_program_participants` (`program_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_pp_contact` ON `crm_program_participants` (`contact_id`);--> statement-breakpoint
CREATE TABLE `crm_program_partners` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`partnership_id` text,
	`organization_id` text,
	`role` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `crm_programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`partnership_id`) REFERENCES `crm_partnerships`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_ppart_link_check" CHECK("partnership_id" IS NOT NULL OR "organization_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_crm_ppart_program` ON `crm_program_partners` (`program_id`);--> statement-breakpoint
CREATE TABLE `crm_program_trainers` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`expert_id` text,
	`fee` integer,
	`confirmed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `crm_programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`expert_id`) REFERENCES `crm_experts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_pt_pair` ON `crm_program_trainers` (`program_id`,`expert_id`);--> statement-breakpoint
CREATE TABLE `crm_programs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`stage` text DEFAULT 'IDEE' NOT NULL,
	`stage_changed_at` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`city` text,
	`venue` text,
	`capacity` integer,
	`price` integer,
	`description` text,
	`owner_id` text,
	`platform_program_id` text,
	`platform_event_id` text,
	`display_name_cache` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`owner_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_prog_type_check" CHECK("type" IN ('FORMATION', 'BOOTCAMP', 'INCUBATION', 'ACCELERATION', 'EVENEMENT', 'WEBINAIRE', 'AUTRE')),
	CONSTRAINT "crm_prog_stage_check" CHECK("stage" IN ('IDEE', 'PLANIFICATION', 'FORMATEUR_CONFIRME', 'PROMOTION', 'INSCRIPTIONS', 'EN_COURS', 'TERMINE', 'REPORTING')),
	CONSTRAINT "crm_prog_single_platform_link" CHECK("platform_program_id" IS NULL OR "platform_event_id" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_crm_prog_stage` ON `crm_programs` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_crm_prog_dates` ON `crm_programs` (`start_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_prog_title_nc` ON `crm_programs` ("title" COLLATE NOCASE);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_prog_platform_prog` ON `crm_programs` (`platform_program_id`) WHERE "platform_program_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_prog_platform_event` ON `crm_programs` (`platform_event_id`) WHERE "platform_event_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `crm_sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_crm_sessions_user` ON `crm_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_sessions_expires` ON `crm_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `crm_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_settings_key` ON `crm_settings` (`key`);--> statement-breakpoint
CREATE TABLE `crm_space_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`space_label` text NOT NULL,
	`space_type` text NOT NULL,
	`organization_id` text,
	`contact_id` text,
	`opportunity_id` text,
	`start_at` text,
	`end_at` text,
	`attendees` integer,
	`quoted_amount` integer,
	`final_amount` integer,
	`status` text DEFAULT 'DEMANDE' NOT NULL,
	`platform_space_id` text,
	`display_name_cache` text,
	`notes` text,
	`owner_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `crm_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`opportunity_id`) REFERENCES `crm_opportunities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_book_type_check" CHECK("space_type" IN ('COWORKING', 'BUREAU_PRIVE', 'SALLE_REUNION', 'SALLE_FORMATION', 'EVENEMENT', 'DOMICILIATION', 'AUTRE')),
	CONSTRAINT "crm_book_status_check" CHECK("status" IN ('DEMANDE', 'VERIFICATION_DISPO', 'DEVIS_ENVOYE', 'ATTENTE_CONFIRMATION', 'CONFIRME', 'PAYE', 'TERMINE', 'ANNULE')),
	CONSTRAINT "crm_book_link_check" CHECK("organization_id" IS NOT NULL OR "contact_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_book_reference` ON `crm_space_bookings` (`reference`);--> statement-breakpoint
CREATE INDEX `idx_crm_book_status` ON `crm_space_bookings` (`status`,`start_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_book_org` ON `crm_space_bookings` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_book_dates` ON `crm_space_bookings` (`start_at`);--> statement-breakpoint
CREATE TABLE `crm_startups` (
	`id` text PRIMARY KEY NOT NULL,
	`platform_listing_id` text,
	`link_status` text GENERATED ALWAYS AS ((CASE WHEN "platform_listing_id" IS NULL THEN 'CRM_ONLY' ELSE 'LINKED' END)) STORED,
	`name` text,
	`display_name_cache` text,
	`sector` text,
	`city` text,
	`website` text,
	`description` text,
	`founder_name` text,
	`founder_email` text,
	`founder_phone` text,
	`organization_id` text,
	`primary_contact_id` text,
	`pipeline_stage` text DEFAULT 'LEAD' NOT NULL,
	`stage_changed_at` text NOT NULL,
	`assigned_expert_id` text,
	`program_id` text,
	`owner_id` text,
	`notes` text,
	`linked_at` text,
	`linked_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`primary_contact_id`) REFERENCES `crm_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_expert_id`) REFERENCES `crm_experts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`program_id`) REFERENCES `crm_programs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_startup_stage_check" CHECK("pipeline_stage" IN ('LEAD', 'DIAGNOSTIC', 'BESOINS_IDENTIFIES', 'PROGRAMME_PACK', 'ONBOARDING', 'ACTIF', 'TERMINE', 'ALUMNI')),
	CONSTRAINT "crm_startup_identity_check" CHECK("platform_listing_id" IS NOT NULL OR "name" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_startup_listing` ON `crm_startups` (`platform_listing_id`) WHERE "platform_listing_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_crm_startup_stage` ON `crm_startups` (`pipeline_stage`);--> statement-breakpoint
CREATE INDEX `idx_crm_startup_link` ON `crm_startups` (`link_status`);--> statement-breakpoint
CREATE INDEX `idx_crm_startup_expert` ON `crm_startups` (`assigned_expert_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_startup_program` ON `crm_startups` (`program_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_startup_name_nc` ON `crm_startups` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `idx_crm_startup_cache_nc` ON `crm_startups` ("display_name_cache" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `crm_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`priority` text DEFAULT 'MOYENNE' NOT NULL,
	`status` text DEFAULT 'INBOX' NOT NULL,
	`due_date` text,
	`due_at` text,
	`completed_at` text,
	`assignee_id` text,
	`contact_id` text,
	`organization_id` text,
	`opportunity_id` text,
	`startup_id` text,
	`expert_id` text,
	`partnership_id` text,
	`program_id` text,
	`oi_project_id` text,
	`booking_id` text,
	`payment_id` text,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`automation_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`assignee_id`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `crm_contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `crm_organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`opportunity_id`) REFERENCES `crm_opportunities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`startup_id`) REFERENCES `crm_startups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`expert_id`) REFERENCES `crm_experts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`partnership_id`) REFERENCES `crm_partnerships`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`program_id`) REFERENCES `crm_programs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`oi_project_id`) REFERENCES `crm_oi_projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`booking_id`) REFERENCES `crm_space_bookings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_id`) REFERENCES `crm_payments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `internal_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "crm_task_priority_check" CHECK("priority" IN ('URGENTE', 'HAUTE', 'MOYENNE', 'BASSE')),
	CONSTRAINT "crm_task_status_check" CHECK("status" IN ('INBOX', 'A_FAIRE', 'EN_COURS', 'EN_ATTENTE', 'TERMINEE')),
	CONSTRAINT "crm_task_source_check" CHECK("source" IN ('MANUAL', 'AUTOMATION')),
	CONSTRAINT "crm_task_link_check" CHECK("contact_id" IS NOT NULL OR "organization_id" IS NOT NULL OR "opportunity_id" IS NOT NULL OR "startup_id" IS NOT NULL OR "expert_id" IS NOT NULL OR "partnership_id" IS NOT NULL OR "program_id" IS NOT NULL OR "oi_project_id" IS NOT NULL OR "booking_id" IS NOT NULL OR "payment_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_task_automation` ON `crm_tasks` (`automation_key`) WHERE "automation_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_crm_task_assignee_due` ON `crm_tasks` (`assignee_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_task_status_due` ON `crm_tasks` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_task_open_due` ON `crm_tasks` (`due_date`) WHERE "status" != 'TERMINEE';--> statement-breakpoint
CREATE INDEX `idx_crm_task_org` ON `crm_tasks` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_task_contact` ON `crm_tasks` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_task_title_nc` ON `crm_tasks` ("title" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `internal_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_login_at` text,
	CONSTRAINT "internal_users_role_check" CHECK("role" IN ('ADMIN', 'TEAM_MEMBER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_internal_users_email` ON `internal_users` (`email`);