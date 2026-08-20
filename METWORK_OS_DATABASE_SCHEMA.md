# METWORK OS — Database Schema (CRM SQLite)

**Base :** SQLite (dialecte), dédiée au CRM, **totalement séparée** du store JSON plateforme.
**ORM :** drizzle-orm · **Production :** `@libsql/client` (Turso) · **Dev/test :** `better-sqlite3`
(décision confirmée — voir §12 et `METWORK_OS_DEVELOPMENT_RULES.md` §4).
**Généré par :** PROMPT 0 · branche `crm/00-audit-docs` · 2026-08-19 · mis à jour 2026-08-20
(décisions D-2, D-6 et connexes confirmées — voir historique en fin de document).

Ce document est la source de vérité du schéma. Le PROMPT 1 crée **toutes** les tables
ci-dessous en une passe unique, pour que les prompts 2 → 7 ne touchent plus jamais aux migrations.

---

## 0. Conventions

| Sujet | Convention | Raison |
|---|---|---|
| Ids | `TEXT` PK, UUID v4 (`crypto.randomUUID()`) | Aligné sur toute la plateforme |
| Dates | `TEXT`, ISO 8601 UTC (`2026-08-19T14:30:00.000Z`) | Aligné sur `createdAt`/`updatedAt` du store JSON |
| Dates seules | `TEXT`, `YYYY-MM-DD` | Aligné sur `deskBookings`, `expenses`, `income` |
| Booléens | `INTEGER` 0/1 (`mode: 'boolean'` côté drizzle) | SQLite n'a pas de type booléen |
| Argent | `INTEGER`, **DZD entier** | Règle plateforme : jamais de flottant sur de l'argent |
| Tableaux | `TEXT` contenant du JSON (`mode: 'json'`) | Pas de type tableau en SQLite |
| Enums | `TEXT` + contrainte `CHECK` | Vérification en base, pas seulement en TS |
| Suppression | `ON DELETE SET NULL` par défaut ; `CASCADE` seulement sur les tables de jonction et les enfants stricts | Jamais de perte d'historique silencieuse |
| Nommage | tables `crm_*` (sauf `internal_users`), colonnes `snake_case` | Évite toute collision de vocabulaire |
| Clés sortantes | `platform_*_id` | Signale visuellement un id qui vit dans l'autre moteur |
| Cache d'affichage | `display_name_cache` sur **toute** table portant un `platform_*_id` | Non autoritaire, rafraîchi à chaque lecture réussie, jamais rendu à la place d'un nom plateforme résolu avec succès — voir §7.4 |

**Colonnes d'audit présentes sur toutes les tables métier :**
`created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`,
`created_by TEXT REFERENCES internal_users(id) ON DELETE SET NULL`.

**PRAGMA obligatoires à l'ouverture de connexion :**
`PRAGMA foreign_keys = ON;` (SQLite ne les applique PAS par défaut — sans ça toutes les FK
de ce document sont décoratives), `PRAGMA journal_mode = WAL;` (driver fichier uniquement).

---

## 1. Authentification

### `internal_users`

| Colonne | Type | Contraintes | Note |
|---|---|---|---|
| `id` | TEXT | PK | uuid |
| `name` | TEXT | NOT NULL | |
| `email` | TEXT | NOT NULL, UNIQUE | stocké **en minuscules, trimmé** |
| `password_hash` | TEXT | NOT NULL | format `scrypt$<saltHex>$<hashHex>` (`@/server/auth/password`) |
| `role` | TEXT | NOT NULL, CHECK IN ('ADMIN','TEAM_MEMBER') | |
| `must_change_password` | INTEGER | NOT NULL DEFAULT 0 | |
| `is_active` | INTEGER | NOT NULL DEFAULT 1 | *ajout* : désactiver sans supprimer (préserve les FK d'audit) |
| `created_at` | TEXT | NOT NULL | |
| `updated_at` | TEXT | NOT NULL | *ajout* |
| `last_login_at` | TEXT | NULL | |

> Le cahier demandait exactement `id, name, email, passwordHash, role, mustChangePassword,
> createdAt, lastLoginAt`. `is_active` et `updated_at` sont des **ajouts additifs nullables/à
> défaut** : supprimer un membre d'équipe casserait `assignee_id` et `created_by` partout,
> donc la désactivation est le bon geste. À valider (DÉCISION D-1).

```sql
CREATE UNIQUE INDEX idx_internal_users_email ON internal_users(email);
```

### `crm_sessions`

Non listée dans le cahier mais **indispensable** : l'isolation de session exigée impose un
stockage serveur, comme `sessions` et `mentorSessions` côté plateforme.

| Colonne | Type | Contraintes |
|---|---|---|
| `id_hash` | TEXT | PK — **SHA-256** de l'id de session ; le clair ne vit que dans le cookie |
| `user_id` | TEXT | NOT NULL, FK `internal_users(id)` ON DELETE CASCADE |
| `expires_at` | TEXT | NOT NULL |
| `created_at` | TEXT | NOT NULL |
| `user_agent` | TEXT | NULL |

```sql
CREATE INDEX idx_crm_sessions_user    ON crm_sessions(user_id);
CREATE INDEX idx_crm_sessions_expires ON crm_sessions(expires_at);
```

Cookie : `metwork_crm` — HttpOnly, SameSite=Strict, Secure en production, `Path=/`.
Distinct de `metwork_session` (clients) et `metwork_consultant` (consultants).

---

## 2. Noyau CRM

### `crm_organizations`

| Colonne | Type | Contraintes / Note |
|---|---|---|
| `id` | TEXT | PK |
| `name` | TEXT | NOT NULL |
| `legal_name` | TEXT | NULL |
| `type` | TEXT | NOT NULL, CHECK IN ('ENTREPRISE','STARTUP','INCUBATEUR','ACCELERATEUR','UNIVERSITE','INSTITUTION_PUBLIQUE','ONG_ASSOCIATION','INVESTISSEUR','MEDIA','AUTRE') |
| `sector` | TEXT | NULL |
| `size` | TEXT | NULL — CHECK IN ('1-10','11-50','51-200','201-500','500+') |
| `city` | TEXT | NULL |
| `wilaya` | TEXT | NULL |
| `country` | TEXT | NOT NULL DEFAULT 'DZ' |
| `website` / `linkedin_url` | TEXT | NULL |
| `email` / `phone` / `address` | TEXT | NULL |
| `description` | TEXT | NULL |
| `status` | TEXT | NOT NULL DEFAULT 'PROSPECT', CHECK IN ('PROSPECT','ACTIF','INACTIF','ARCHIVE') |
| `source` | TEXT | NULL — origine du lead |
| `owner_id` | TEXT | FK `internal_users(id)` ON DELETE SET NULL |
| `notes` | TEXT | NULL |
| **`platform_incubator_id`** | TEXT | NULL — **(c)** → `IncubatorRecord.id` (store JSON) |
| **`platform_user_id`** | TEXT | NULL — **(c)** → `UserRecord.id` (store JSON) |
| `display_name_cache` | TEXT | NULL — nom affiché par la fiche plateforme liée au dernier `platform-refs` réussi. `name` reste **obligatoire et prime toujours** ici (contrairement à `crm_startups`/`crm_experts`, une Organisation a toujours son propre nom) ; ce cache sert uniquement de repère visuel « lié comme : … » et de détecteur de dérive, jamais de source pour la recherche |
| `created_at` / `updated_at` / `created_by` | | audit |

```sql
CREATE INDEX idx_crm_org_name_nc  ON crm_organizations(name COLLATE NOCASE);
CREATE INDEX idx_crm_org_type     ON crm_organizations(type);
CREATE INDEX idx_crm_org_status   ON crm_organizations(status);
CREATE INDEX idx_crm_org_city     ON crm_organizations(city);
CREATE INDEX idx_crm_org_sector   ON crm_organizations(sector);
CREATE INDEX idx_crm_org_owner    ON crm_organizations(owner_id);
CREATE INDEX idx_crm_org_platform ON crm_organizations(platform_incubator_id);
```

### `crm_contacts`

| Colonne | Type | Contraintes / Note |
|---|---|---|
| `id` | TEXT | PK |
| `first_name` | TEXT | NOT NULL |
| `last_name` | TEXT | NOT NULL |
| `full_name` | TEXT | `GENERATED ALWAYS AS (first_name \|\| ' ' \|\| last_name) STORED` — indexable pour la recherche |
| `position` | TEXT | NULL |
| `email` | TEXT | NULL |
| `phone` / `whatsapp` | TEXT | NULL |
| `linkedin_url` | TEXT | NULL |
| `city` | TEXT | NULL |
| `language` | TEXT | NULL, CHECK IN ('fr','ar','en') |
| `primary_organization_id` | TEXT | FK `crm_organizations(id)` ON DELETE SET NULL |
| `status` | TEXT | NOT NULL DEFAULT 'ACTIF', CHECK IN ('PROSPECT','ACTIF','INACTIF','ARCHIVE') |
| `source` | TEXT | NULL — ex. `'CONTACT_FORM'` quand créé depuis `contactSubmissions` |
| `source_ref` | TEXT | NULL — ex. `ContactSubmissionRecord.id` (traçabilité de la copie, pas une FK) |
| `owner_id` | TEXT | FK `internal_users(id)` ON DELETE SET NULL |
| `notes` | TEXT | NULL |
| **`platform_user_id`** | TEXT | NULL — **(c)** → `UserRecord.id` |
| **`platform_mentor_id`** | TEXT | NULL — **(c)** → `MentorRecord.id` |
| `display_name_cache` | TEXT | NULL — nom plateforme (`UserRecord.fullName` ou `MentorRecord.fullName`) au dernier `platform-refs` réussi. `full_name` reste la colonne générée obligatoire et prime toujours ; même statut non autoritaire que sur `crm_organizations` |
| `created_at` / `updated_at` / `created_by` | | audit |

```sql
CREATE INDEX idx_crm_contact_fullname_nc ON crm_contacts(full_name COLLATE NOCASE);
CREATE INDEX idx_crm_contact_email_nc    ON crm_contacts(email COLLATE NOCASE);
CREATE INDEX idx_crm_contact_phone       ON crm_contacts(phone);
CREATE INDEX idx_crm_contact_org         ON crm_contacts(primary_organization_id);
CREATE INDEX idx_crm_contact_owner       ON crm_contacts(owner_id);
CREATE INDEX idx_crm_contact_status      ON crm_contacts(status);
```

> `email` n'est **pas** UNIQUE : plusieurs contacts peuvent partager une adresse générique
> (`contact@entreprise.dz`). La détection de doublon se fait à la saisie, en avertissement.

### `crm_contact_organizations` (N–N)

`id` PK · `contact_id` FK CASCADE · `organization_id` FK CASCADE · `role` TEXT NULL ·
`is_primary` INTEGER DEFAULT 0 · `created_at`.

```sql
CREATE UNIQUE INDEX idx_crm_co_pair ON crm_contact_organizations(contact_id, organization_id);
CREATE INDEX idx_crm_co_org         ON crm_contact_organizations(organization_id);
```

### `crm_interactions`

| Colonne | Type | Contraintes / Note |
|---|---|---|
| `id` | TEXT | PK |
| `type` | TEXT | NOT NULL, CHECK IN ('APPEL','EMAIL','WHATSAPP','LINKEDIN','REUNION','VISIO','VISITE','RELANCE','PROPOSITION','DOCUMENT_ENVOYE','AUTRE') |
| `direction` | TEXT | NULL, CHECK IN ('INBOUND','OUTBOUND') |
| `subject` | TEXT | NOT NULL |
| `body` | TEXT | NULL |
| `occurred_at` | TEXT | NOT NULL — ISO |
| `duration_minutes` | INTEGER | NULL |
| `outcome` | TEXT | NULL |
| `contact_id` | TEXT | FK `crm_contacts` SET NULL |
| `organization_id` | TEXT | FK `crm_organizations` SET NULL |
| `opportunity_id` | TEXT | FK `crm_opportunities` SET NULL |
| `startup_id` | TEXT | FK `crm_startups` SET NULL |
| `expert_id` | TEXT | FK `crm_experts` SET NULL |
| `partnership_id` | TEXT | FK `crm_partnerships` SET NULL |
| `program_id` | TEXT | FK `crm_programs` SET NULL |
| `oi_project_id` | TEXT | FK `crm_oi_projects` SET NULL |
| `next_action` | TEXT | NULL |
| `next_action_date` | TEXT | NULL — `YYYY-MM-DD` |
| `next_action_done` | INTEGER | NOT NULL DEFAULT 0 |
| `created_at` / `updated_at` / `created_by` | | audit |

**Contrainte anti-orphelin :**
```sql
CHECK (
  contact_id IS NOT NULL OR organization_id IS NOT NULL OR opportunity_id IS NOT NULL OR
  startup_id IS NOT NULL OR expert_id     IS NOT NULL OR partnership_id IS NOT NULL OR
  program_id IS NOT NULL OR oi_project_id IS NOT NULL
)
```

**Index (timeline + dashboard) :**
```sql
CREATE INDEX idx_crm_int_org_time     ON crm_interactions(organization_id, occurred_at DESC);
CREATE INDEX idx_crm_int_contact_time ON crm_interactions(contact_id,      occurred_at DESC);
CREATE INDEX idx_crm_int_opp_time     ON crm_interactions(opportunity_id,  occurred_at DESC);
CREATE INDEX idx_crm_int_startup_time ON crm_interactions(startup_id,      occurred_at DESC);
CREATE INDEX idx_crm_int_next_action  ON crm_interactions(next_action_date) WHERE next_action_done = 0;
CREATE INDEX idx_crm_int_subject_nc   ON crm_interactions(subject COLLATE NOCASE);
CREATE INDEX idx_crm_int_occurred     ON crm_interactions(occurred_at DESC);
```

### `crm_tasks`

| Colonne | Type | Contraintes / Note |
|---|---|---|
| `id` | TEXT | PK |
| `title` | TEXT | NOT NULL |
| `description` | TEXT | NULL |
| `priority` | TEXT | NOT NULL DEFAULT 'MOYENNE', CHECK IN ('URGENTE','HAUTE','MOYENNE','BASSE') |
| `status` | TEXT | NOT NULL DEFAULT 'INBOX', CHECK IN ('INBOX','A_FAIRE','EN_COURS','EN_ATTENTE','TERMINEE') |
| `due_date` | TEXT | NULL — `YYYY-MM-DD` |
| `due_at` | TEXT | NULL — ISO, pour « réunion dans 30 min » |
| `completed_at` | TEXT | NULL |
| `assignee_id` | TEXT | FK `internal_users` SET NULL |
| `contact_id` … `oi_project_id` | TEXT | mêmes 8 FK que `crm_interactions`, SET NULL |
| `booking_id` | TEXT | FK `crm_space_bookings` SET NULL |
| `payment_id` | TEXT | FK `crm_payments` SET NULL |
| `source` | TEXT | NOT NULL DEFAULT 'MANUAL', CHECK IN ('MANUAL','AUTOMATION') |
| `automation_key` | TEXT | NULL, **UNIQUE** — idempotence des tâches auto (Prompt 7) |
| `created_at` / `updated_at` / `created_by` | | audit |

**Contrainte anti-orphelin :** identique, étendue à `booking_id` et `payment_id`.

> ⚠️ **Interaction CHECK anti-orphelin × `ON DELETE SET NULL` — découvert et vérifié au
> Prompt 1.** Supprimer une entité liée (ex. une Organisation) met le lien correspondant à
> NULL sur ses tâches/interactions/paiements ; si c'était leur **seul** lien, la ligne
> deviendrait orpheline et le `CHECK` refuse l'opération. SQLite annule alors **tout le
> DELETE**, atomiquement — rien n'est écrit à moitié.
>
> C'est un comportement **fail-closed voulu**, pas un bug : le CRM archive
> (`status = 'ARCHIVE'`) plutôt qu'il ne supprime. Conséquence pour le Prompt 2 : le service
> de suppression doit d'abord réaffecter ou supprimer les lignes dépendantes, et présenter un
> message lisible (« cette organisation porte N tâches qui n'ont aucun autre lien ») au lieu de
> laisser remonter `SQLITE_CONSTRAINT_CHECK`. Couvert par les tests
> `src/__tests__/metworkcrm/schema.test.ts`.

```sql
CREATE UNIQUE INDEX idx_crm_task_automation ON crm_tasks(automation_key) WHERE automation_key IS NOT NULL;
CREATE INDEX idx_crm_task_assignee_due ON crm_tasks(assignee_id, due_date);
CREATE INDEX idx_crm_task_status_due   ON crm_tasks(status, due_date);
CREATE INDEX idx_crm_task_open_due     ON crm_tasks(due_date) WHERE status != 'TERMINEE';
CREATE INDEX idx_crm_task_org          ON crm_tasks(organization_id);
CREATE INDEX idx_crm_task_contact      ON crm_tasks(contact_id);
CREATE INDEX idx_crm_task_title_nc     ON crm_tasks(title COLLATE NOCASE);
```

---

## 3. Sales

### `crm_opportunities`

| Colonne | Type | Contraintes / Note |
|---|---|---|
| `id` | TEXT | PK |
| `title` | TEXT | NOT NULL |
| `organization_id` | TEXT | FK `crm_organizations` SET NULL |
| `contact_id` | TEXT | FK `crm_contacts` SET NULL |
| `type` | TEXT | NOT NULL, CHECK IN ('COWORKING','SALLE','PACK','INCUBATION','ACCELERATION','PRE_INCUBATION','CONSULTING','FORMATION','AUTRE') |
| `stage` | TEXT | NOT NULL DEFAULT 'NOUVEAU_LEAD', CHECK IN ('NOUVEAU_LEAD','CONTACTE','BESOIN_IDENTIFIE','PROPOSITION_ENVOYEE','RELANCE','NEGOCIATION','GAGNE','PERDU') |
| `amount` | INTEGER | NULL — **DZD entier** |
| `probability` | INTEGER | NULL — 0–100 |
| `expected_close_date` | TEXT | NULL |
| `closed_at` | TEXT | NULL |
| `lost_reason` | TEXT | NULL |
| `source` | TEXT | NULL |
| `owner_id` | TEXT | FK `internal_users` SET NULL |
| `description` | TEXT | NULL |
| `stage_changed_at` | TEXT | NOT NULL — pilote « bloquée / inactive 7 j » |
| `last_activity_at` | TEXT | NULL — mis à jour à chaque interaction liée |
| `created_at` / `updated_at` / `created_by` | | audit |

`CHECK (organization_id IS NOT NULL OR contact_id IS NOT NULL)`

```sql
CREATE INDEX idx_crm_opp_stage      ON crm_opportunities(stage);
CREATE INDEX idx_crm_opp_org        ON crm_opportunities(organization_id);
CREATE INDEX idx_crm_opp_contact    ON crm_opportunities(contact_id);
CREATE INDEX idx_crm_opp_owner      ON crm_opportunities(owner_id);
CREATE INDEX idx_crm_opp_stale      ON crm_opportunities(stage_changed_at) WHERE stage NOT IN ('GAGNE','PERDU');
CREATE INDEX idx_crm_opp_close      ON crm_opportunities(expected_close_date);
CREATE INDEX idx_crm_opp_title_nc   ON crm_opportunities(title COLLATE NOCASE);
```

### `crm_opportunity_stage_history`

`id` PK · `opportunity_id` FK CASCADE · `from_stage` TEXT NULL · `to_stage` TEXT NOT NULL ·
`changed_at` TEXT NOT NULL · `changed_by` FK `internal_users` SET NULL.

```sql
CREATE INDEX idx_crm_opp_hist ON crm_opportunity_stage_history(opportunity_id, changed_at);
```

---

## 4. Écosystème

### `crm_startups` — overlay sur `StartupListing`

| Colonne | Type | Contraintes / Note |
|---|---|---|
| `id` | TEXT | PK |
| **`platform_listing_id`** | TEXT | NULL, **UNIQUE** — **(c)** → `StartupListingRecord.id` |
| `link_status` | TEXT | `GENERATED ALWAYS AS (CASE WHEN platform_listing_id IS NULL THEN 'CRM_ONLY' ELSE 'LINKED' END) STORED` — filtrable/indexable, jamais désynchronisé |
| `name` | TEXT | **NULL** — renseigné uniquement pour les CRM-only |
| `display_name_cache` | TEXT | NULL — copie non autoritaire du nom plateforme, **uniquement** pour la recherche SQL et l'affichage de secours (voir §7.4) |
| `sector` | TEXT | NULL — CRM-only ; sinon `StartupListing.industry` |
| `city` | TEXT | NULL — **jamais** sur `StartupListing`, donc toujours CRM |
| `website` / `description` | TEXT | NULL — CRM-only |
| `founder_name` / `founder_email` / `founder_phone` | TEXT | NULL — CRM-only |
| `organization_id` | TEXT | FK `crm_organizations` SET NULL |
| `primary_contact_id` | TEXT | FK `crm_contacts` SET NULL |
| `pipeline_stage` | TEXT | NOT NULL DEFAULT 'LEAD', CHECK IN ('LEAD','DIAGNOSTIC','BESOINS_IDENTIFIES','PROGRAMME_PACK','ONBOARDING','ACTIF','TERMINE','ALUMNI') |
| `stage_changed_at` | TEXT | NOT NULL |
| `assigned_expert_id` | TEXT | FK `crm_experts` SET NULL |
| `program_id` | TEXT | FK `crm_programs` SET NULL |
| `owner_id` | TEXT | FK `internal_users` SET NULL |
| `notes` | TEXT | NULL |
| `linked_at` / `linked_by` | | quand/qui a rattaché la fiche plateforme |
| `created_at` / `updated_at` / `created_by` | | audit |

`CHECK (platform_listing_id IS NOT NULL OR name IS NOT NULL)`
→ garantit qu'une startup CRM a **toujours** un nom affichable, sans jamais dupliquer
celui d'une fiche liée.

```sql
CREATE UNIQUE INDEX idx_crm_startup_listing ON crm_startups(platform_listing_id) WHERE platform_listing_id IS NOT NULL;
CREATE INDEX idx_crm_startup_stage   ON crm_startups(pipeline_stage);
CREATE INDEX idx_crm_startup_link    ON crm_startups(link_status);
CREATE INDEX idx_crm_startup_expert  ON crm_startups(assigned_expert_id);
CREATE INDEX idx_crm_startup_program ON crm_startups(program_id);
CREATE INDEX idx_crm_startup_name_nc ON crm_startups(name COLLATE NOCASE);
CREATE INDEX idx_crm_startup_cache_nc ON crm_startups(display_name_cache COLLATE NOCASE);
```

### `crm_experts` — overlay sur `MentorRecord`

Même pattern exactement.

| Colonne | Type | Note |
|---|---|---|
| `id` | TEXT | PK |
| **`platform_mentor_id`** | TEXT | NULL, UNIQUE — **(c)** → `MentorRecord.id` |
| `link_status` | TEXT | colonne générée, idem `crm_startups` |
| `name` | TEXT | NULL — CRM-only |
| `display_name_cache` | TEXT | NULL — recherche/secours |
| `email` / `phone` / `city` | TEXT | NULL — CRM-only |
| `specialties` | TEXT | NULL — JSON `string[]` |
| `pipeline_stage` | TEXT | NOT NULL DEFAULT 'PROSPECT', CHECK IN ('PROSPECT','CONTACTE','ENTRETIEN','VALIDE','CONVENTION','ACTIF','INACTIF') |
| `stage_changed_at` | TEXT | NOT NULL |
| `daily_rate` | INTEGER | NULL — DZD |
| `organization_id` / `contact_id` | TEXT | FK SET NULL |
| `internal_notes` | TEXT | NULL |
| `owner_id` | TEXT | FK `internal_users` SET NULL |
| `linked_at` / `linked_by` | | |
| `created_at` / `updated_at` / `created_by` | | audit |

`CHECK (platform_mentor_id IS NOT NULL OR name IS NOT NULL)`

```sql
CREATE UNIQUE INDEX idx_crm_expert_mentor ON crm_experts(platform_mentor_id) WHERE platform_mentor_id IS NOT NULL;
CREATE INDEX idx_crm_expert_stage    ON crm_experts(pipeline_stage);
CREATE INDEX idx_crm_expert_link     ON crm_experts(link_status);
CREATE INDEX idx_crm_expert_name_nc  ON crm_experts(name COLLATE NOCASE);
CREATE INDEX idx_crm_expert_cache_nc ON crm_experts(display_name_cache COLLATE NOCASE);
```

### `crm_expert_missions`

`id` PK · `expert_id` FK CASCADE · `title` NOT NULL · `type` TEXT NULL ·
`startup_id` / `program_id` / `oi_project_id` / `organization_id` FK SET NULL ·
`start_date` / `end_date` TEXT NULL · `status` CHECK IN ('PREVUE','EN_COURS','TERMINEE','ANNULEE') ·
`amount` INTEGER NULL · `notes` · audit.

```sql
CREATE INDEX idx_crm_mission_expert ON crm_expert_missions(expert_id, start_date DESC);
```

> Les missions **plateforme** (`mentorBookings`, `mentorConsultations`, `programs.mentorId`)
> ne sont **pas** importées ici : elles sont affichées à côté, en lecture seule (§7.3).

### `crm_partnerships`

`id` PK · `name` NOT NULL · `organization_id` FK **NOT NULL** SET NULL→ *(voir note)* ·
`type` CHECK IN ('CORPORATE','INCUBATEUR','ACCELERATEUR','UNIVERSITE','INSTITUTION','ONG','MEDIA','INVESTISSEUR','AUTRE') ·
`stage` CHECK IN ('PROSPECT','CONTACTE','CONVERSATION','REUNION','PROPOSITION','NEGOCIATION','ACTIF','TERMINE') ·
`stage_changed_at` · `description` · `value_amount` INTEGER · `start_date` · `end_date` ·
`renewal_date` · `owner_id` · **`platform_partner_membership_id`** TEXT NULL (**(c)** →
`PartnerMembershipRecord.id`) · `display_name_cache` TEXT NULL (nom du `PartnerMembershipRecord`
lié — l'incubateur porteur ; `name` reste la colonne obligatoire) · audit.

> `organization_id` est NOT NULL (un partenariat est toujours avec une organisation), donc
> `ON DELETE RESTRICT` : impossible de supprimer une organisation portant un partenariat.

```sql
CREATE INDEX idx_crm_part_stage ON crm_partnerships(stage);
CREATE INDEX idx_crm_part_org   ON crm_partnerships(organization_id);
CREATE INDEX idx_crm_part_name_nc ON crm_partnerships(name COLLATE NOCASE);
```

### `crm_partnership_contacts` (N–N)

`id` PK · `partnership_id` FK CASCADE · `contact_id` FK CASCADE · `role` · `created_at`.
`UNIQUE(partnership_id, contact_id)`.

---

## 5. Open Innovation, Programmes, Espaces

### `crm_oi_projects`

`id` PK · `title` NOT NULL · `organization_id` FK SET NULL · `contact_id` FK SET NULL ·
`partnership_id` FK SET NULL ·
`stage` CHECK IN ('ENTREPRISE_IDENTIFIEE','PROBLEME_IDENTIFIE','DIAGNOSTIC','DEFI_DEFINI','RECHERCHE_SOLUTION','STARTUPS_EXPERTS_MOBILISES','POC','EXPERIMENTATION','DEPLOIEMENT','TERMINE') ·
`stage_changed_at` · `problem_statement` · `challenge_statement` · `budget` INTEGER ·
`currency` TEXT DEFAULT 'DZD' · `start_date` · `target_end_date` · `owner_id` · `notes` · audit.

```sql
CREATE INDEX idx_crm_oi_stage ON crm_oi_projects(stage);
CREATE INDEX idx_crm_oi_org   ON crm_oi_projects(organization_id);
CREATE INDEX idx_crm_oi_title_nc ON crm_oi_projects(title COLLATE NOCASE);
```

### `crm_oi_startups` / `crm_oi_experts` (N–N explicites)

Deux tables plutôt qu'une jonction polymorphe, pour que les FK soient **réellement appliquées** :

- `crm_oi_startups` : `id` PK · `oi_project_id` FK CASCADE · `startup_id` FK CASCADE ·
  `role` · `status` CHECK IN ('PRESSENTIE','MOBILISEE','RETENUE','ECARTEE') · `created_at` ·
  `UNIQUE(oi_project_id, startup_id)`
- `crm_oi_experts` : idem avec `expert_id`.

### `crm_programs`

`id` PK · `title` NOT NULL ·
`type` CHECK IN ('FORMATION','BOOTCAMP','INCUBATION','ACCELERATION','EVENEMENT','WEBINAIRE','AUTRE') ·
`stage` CHECK IN ('IDEE','PLANIFICATION','FORMATEUR_CONFIRME','PROMOTION','INSCRIPTIONS','EN_COURS','TERMINE','REPORTING') ·
`stage_changed_at` · `start_date` · `end_date` · `city` · `venue` · `capacity` INTEGER ·
`price` INTEGER (DZD) · `description` · `owner_id` ·
**`platform_program_id`** TEXT NULL (**(c)** → `ProgramRecord.id`) ·
**`platform_event_id`** TEXT NULL (**(c)** → `EventRecord.id`) ·
`display_name_cache` TEXT NULL (titre du `ProgramRecord`/`EventRecord` lié ; `title` reste
la colonne obligatoire) · audit.

`CHECK (platform_program_id IS NULL OR platform_event_id IS NULL)` — au plus un des deux.

```sql
CREATE INDEX idx_crm_prog_stage ON crm_programs(stage);
CREATE INDEX idx_crm_prog_dates ON crm_programs(start_date);
CREATE INDEX idx_crm_prog_title_nc ON crm_programs(title COLLATE NOCASE);
CREATE UNIQUE INDEX idx_crm_prog_platform_prog  ON crm_programs(platform_program_id) WHERE platform_program_id IS NOT NULL;
CREATE UNIQUE INDEX idx_crm_prog_platform_event ON crm_programs(platform_event_id)   WHERE platform_event_id   IS NOT NULL;
```

> `seats_sold` / taux de remplissage sont **calculés** depuis `crm_program_participants`,
> jamais stockés — pas de compteur à désynchroniser.

### `crm_program_participants`

`id` PK · `program_id` FK CASCADE · `contact_id` FK SET NULL · `startup_id` FK SET NULL ·
`organization_id` FK SET NULL · `full_name` / `email` / `phone` TEXT NULL (participants
sans fiche contact) · `status` CHECK IN ('INSCRIT','CONFIRME','PRESENT','ABSENT','ANNULE') ·
`attended` INTEGER DEFAULT 0 · `satisfaction_score` INTEGER NULL (1–5) ·
`amount_due` INTEGER NULL · **`platform_registration_id`** TEXT NULL (**(c)** →
`RegistrationRecord.id`) · `display_name_cache` TEXT NULL (nom du `RegistrationRecord` lié ;
`full_name` reste la colonne de secours pour les participants sans fiche contact) · audit.

`CHECK (contact_id IS NOT NULL OR full_name IS NOT NULL)`

```sql
CREATE INDEX idx_crm_pp_program ON crm_program_participants(program_id, status);
CREATE INDEX idx_crm_pp_contact ON crm_program_participants(contact_id);
```

### `crm_program_trainers` / `crm_program_partners`

- `crm_program_trainers` : `id` · `program_id` FK CASCADE · `expert_id` FK SET NULL ·
  `fee` INTEGER · `confirmed` INTEGER DEFAULT 0 · `created_at` · `UNIQUE(program_id, expert_id)`
- `crm_program_partners` : `id` · `program_id` FK CASCADE · `partnership_id` FK SET NULL ·
  `organization_id` FK SET NULL · `role` · `created_at` ·
  `CHECK (partnership_id IS NOT NULL OR organization_id IS NOT NULL)`

### `crm_space_bookings` — journal interne, **jamais** le vrai système

`id` PK · `reference` TEXT UNIQUE (ex. `RES-2026-001`) · `space_label` TEXT NOT NULL ·
`space_type` CHECK IN ('COWORKING','BUREAU_PRIVE','SALLE_REUNION','SALLE_FORMATION','EVENEMENT','DOMICILIATION','AUTRE') ·
`organization_id` / `contact_id` / `opportunity_id` FK SET NULL ·
`start_at` / `end_at` TEXT · `attendees` INTEGER · `quoted_amount` / `final_amount` INTEGER ·
`status` CHECK IN ('DEMANDE','VERIFICATION_DISPO','DEVIS_ENVOYE','ATTENTE_CONFIRMATION','CONFIRME','PAYE','TERMINE','ANNULE') ·
**`platform_space_id`** TEXT NULL (**(c)** → `SpaceRecord.id`, **étiquette de référence
uniquement — aucune vérification de disponibilité, aucune écriture**) ·
`display_name_cache` TEXT NULL (nom du `SpaceRecord` lié ; `space_label` reste la colonne
obligatoire, saisie librement même quand un espace plateforme est référencé) ·
`notes` · `owner_id` · audit.

`CHECK (organization_id IS NOT NULL OR contact_id IS NOT NULL)`

```sql
CREATE INDEX idx_crm_book_status ON crm_space_bookings(status, start_at);
CREATE INDEX idx_crm_book_org    ON crm_space_bookings(organization_id);
CREATE INDEX idx_crm_book_dates  ON crm_space_bookings(start_at);
```

---

## 6. Paiements, Documents, Notifications, Système

### `crm_payments` — **ADMIN uniquement**

| Colonne | Type | Note |
|---|---|---|
| `id` | TEXT | PK |
| `label` | TEXT | NOT NULL |
| `amount` | INTEGER | NOT NULL — **DZD entier** |
| `currency` | TEXT | NOT NULL DEFAULT 'DZD' |
| `direction` | TEXT | NOT NULL DEFAULT 'IN', CHECK IN ('IN','OUT') |
| `status` | TEXT | NOT NULL DEFAULT 'EN_ATTENTE', CHECK IN ('EN_ATTENTE','RELANCE_1','RELANCE_2','PAYE','ANNULE') |
| `due_date` | TEXT | NULL |
| `paid_at` | TEXT | NULL |
| `method` | TEXT | NULL, CHECK IN ('ESPECE','CHEQUE','VIREMENT','CARTE','AUTRE') |
| `reminder_1_sent_at` / `reminder_2_sent_at` | TEXT | NULL |
| `opportunity_id`, `space_booking_id`, `program_id`, `organization_id`, `contact_id`, `partnership_id`, `oi_project_id` | TEXT | FK SET NULL |
| `external_ref` | TEXT | NULL — **texte libre**, ex. numéro de facture plateforme. **Pas** de FK |
| `notes` | TEXT | NULL |
| `created_at` / `updated_at` / `created_by` | | audit |

**Anti-orphelin :** au moins un des 7 liens non NULL.

```sql
CREATE INDEX idx_crm_pay_status_due ON crm_payments(status, due_date);
CREATE INDEX idx_crm_pay_overdue    ON crm_payments(due_date) WHERE status IN ('EN_ATTENTE','RELANCE_1','RELANCE_2');
CREATE INDEX idx_crm_pay_org        ON crm_payments(organization_id);
```

> **Aucune** colonne ne référence `transactions`, `wallets`, `invoices` ou `income`.
> C'est délibéré et doit le rester : le CRM n'est pas une comptabilité.

> **Confirmé (2026-08-20) — accès `TEAM_MEMBER` :** cette table est totalement invisible pour
> `TEAM_MEMBER`, **et** aucun montant CRM (valeur de pipeline, CA agrégé, `crm_opportunities.amount`,
> `crm_payments.amount`) ne doit apparaître dans une réponse API ou un rendu servi à ce rôle,
> nulle part dans le CRM — y compris Dashboard et Rapports (Prompt 6). Les compteurs par étape de
> pipeline et les métriques non monétaires (nombre de leads, taux de conversion, tâches en retard…)
> restent visibles. Applique R-19 : la garde est posée dans le **service** de sérialisation partagé
> par le Dashboard/Reports (un seul point d'omission des champs `amount`/`value_amount`), pas
> seulement dans la garde de route de `/metworkcrm/payments` — sans quoi un widget Dashboard
> réutilisant `crm_opportunities.amount` fuiterait le montant à un `TEAM_MEMBER` sans jamais
> passer par la route interdite.

### `crm_documents`

`id` PK · `title` NOT NULL ·
`type` CHECK IN ('CONVENTION','CONTRAT','PROPOSITION','PRESENTATION','DEVIS','FACTURE','NDA','PROGRAMME','SUPPORT_FORMATION','RAPPORT','AUTRE') ·
`file_url` TEXT NOT NULL (`secure_url` Cloudinary) · `file_name` · `mime_type` ·
`size_bytes` INTEGER · `cloudinary_public_id` TEXT NULL (nécessaire pour toute suppression) ·
`uploaded_by` FK `internal_users` SET NULL · audit.

> **Confirmé (2026-08-20) — endpoint d'upload :** `POST /api/metworkcrm/upload`,
> **nouvelle route dédiée** — `/api/upload` n'est **pas** réutilisée (elle exige une session
> *cliente* plateforme via `requireApiSession`, n'accepte que des images, et plafonne à 5 Mo ;
> voir `METWORK_OS_PRODUCT_SPEC.md` §4.15). Contrat de la nouvelle route :
> - Authentification : session `internal_users` uniquement (garde CRM, jamais `requireApiSession`).
> - Types acceptés : `application/pdf`, `.docx`, `.xlsx`, `.pptx`, `image/png`, `image/jpeg`.
>   `mime_type` stocke la valeur reçue telle quelle (traçabilité), la validation se fait sur un
>   allowlist dédié côté CRM — ne pas réutiliser `isSupportedDocumentMime` de `@/lib/cloudinary`,
>   qui n'autorise que `application/pdf`.
> - Taille max : **20 Mo** (`size_bytes`), au-delà de la limite plateforme de 5 Mo car les decks
>   de présentation et rapports dépassent régulièrement ce plafond.
> - Dossier Cloudinary : `metwork/crm-documents` (`uploadBuffer` de `@/lib/cloudinary`, réutilisé
>   tel quel — seul le point d'entrée HTTP est nouveau) · `resourceType: 'raw'` pour tout ce qui
>   n'est pas une image.
> - Rate limit : `checkRateLimitDistributed` par utilisateur CRM (même mécanisme que `/api/upload`).

### `crm_document_links`

`id` PK · `document_id` FK CASCADE ·
`entity_type` CHECK IN ('ORGANIZATION','CONTACT','OPPORTUNITY','STARTUP','EXPERT','PARTNERSHIP','OI_PROJECT','PROGRAM','SPACE_BOOKING','PAYMENT','TASK') ·
`entity_id` TEXT NOT NULL · `created_at` · `UNIQUE(document_id, entity_type, entity_id)`.

```sql
CREATE INDEX idx_crm_doclink_entity ON crm_document_links(entity_type, entity_id);
```

> **Limite assumée :** lien polymorphe ⇒ `entity_id` n'est pas une vraie FK et SQLite ne peut
> pas la vérifier. Alternative écartée : 11 colonnes nullables (illisible, et un document est
> souvent rattaché à plusieurs entités). Mitigations obligatoires (Prompt 5) :
> 1. la création d'un document et d'**au moins un** lien se font dans **la même transaction** ;
> 2. la suppression d'une entité supprime ses `crm_document_links` (service applicatif) ;
> 3. un script d'intégrité (Prompt 8) détecte les liens pendants.

### `crm_notifications`

`id` PK · `user_id` FK `internal_users` CASCADE ·
`type` CHECK IN ('TACHE_DUE','RELANCE_DUE','PAIEMENT_RETARD','REUNION_30MIN','OPPORTUNITE_INACTIVE','SYSTEME') ·
`title` NOT NULL · `body` · `href` · `read` INTEGER DEFAULT 0 · `read_at` ·
`entity_type` / `entity_id` TEXT NULL · `dedupe_key` TEXT NULL UNIQUE · `created_at`.

```sql
CREATE INDEX idx_crm_notif_user_unread ON crm_notifications(user_id, read, created_at DESC);
CREATE UNIQUE INDEX idx_crm_notif_dedupe ON crm_notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
```

### `crm_automation_runs`

`id` PK · `automation_key` TEXT NOT NULL UNIQUE · `rule` TEXT NOT NULL ·
`trigger_entity_type` / `trigger_entity_id` TEXT · `status` CHECK IN ('OK','ERREUR') ·
`error` TEXT NULL · `created_at`.

Créée dès le Prompt 1 (passe schéma unique), utilisée au Prompt 7.

### `crm_activity_log`

`id` PK · `actor_id` FK `internal_users` SET NULL · `action` TEXT NOT NULL ·
`entity_type` / `entity_id` TEXT · `diff` TEXT NULL (JSON) · `ip` TEXT NULL · `created_at`.

```sql
CREATE INDEX idx_crm_log_entity ON crm_activity_log(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_crm_log_actor  ON crm_activity_log(actor_id, created_at DESC);
```

### `crm_settings`

`id` PK · `key` TEXT NOT NULL UNIQUE · `value` TEXT · `updated_at` · `updated_by` FK SET NULL.

---

## 7. Références inter-moteurs (SQLite ↔ store JSON)

C'est le point le plus délicat du build : **deux moteurs de stockage, aucune jointure possible**.

### 7.1 Inventaire des clés sortantes

| Table CRM | Colonne | Cible (store JSON) | Cardinalité | `display_name_cache` |
|---|---|---|---|---|
| `crm_organizations` | `platform_incubator_id` | `incubators[].id` | 0..1 | oui (secondaire — `name` prime) |
| `crm_organizations` | `platform_user_id` | `users[].id` | 0..1 | oui (secondaire — `name` prime) |
| `crm_contacts` | `platform_user_id` | `users[].id` | 0..1 | oui (secondaire — `full_name` prime) |
| `crm_contacts` | `platform_mentor_id` | `mentors[].id` | 0..1 | oui (secondaire — `full_name` prime) |
| `crm_startups` | `platform_listing_id` | `startupListings[].id` | 0..1, unique | oui (**autoritaire pour la recherche** — `name` peut être NULL) |
| `crm_experts` | `platform_mentor_id` | `mentors[].id` | 0..1, unique | oui (**autoritaire pour la recherche** — `name` peut être NULL) |
| `crm_partnerships` | `platform_partner_membership_id` | `partnerMemberships[].id` | 0..1 | oui (secondaire — `name` prime) |
| `crm_programs` | `platform_program_id` | `programs[].id` | 0..1, unique | oui (secondaire — `title` prime) |
| `crm_programs` | `platform_event_id` | `events[].id` | 0..1, unique | oui (secondaire — `title` prime) |
| `crm_program_participants` | `platform_registration_id` | `registrations[].id` | 0..1 | oui (secondaire — `full_name` prime) |
| `crm_space_bookings` | `platform_space_id` | `spaces[].id` | 0..1 | oui (secondaire — `space_label` prime) |
| `crm_contacts` | `source_ref` | `contactSubmissions[].id` | traçabilité, non résolue | non — texte libre, pas un id résolu |

**Aucune de ces colonnes n'est une clé étrangère SQL.** SQLite ne peut rien vérifier :
l'intégrité est de la responsabilité de la couche applicative, et une référence pendante doit
être un **cas d'affichage normal**, pas une erreur 500.

**« secondaire » vs « autoritaire pour la recherche » :** sur `crm_organizations`, `crm_contacts`,
`crm_partnerships`, `crm_programs`, `crm_program_participants` et `crm_space_bookings`, la colonne
locale (`name` / `full_name` / `title` / `space_label`) est **NOT NULL** — la recherche SQL
interroge donc toujours cette colonne, jamais le cache. Le cache y sert seulement de repère visuel
et de détecteur de dérive. Sur `crm_startups` et `crm_experts` uniquement, le nom local peut être
NULL (fiche liée sans doublon de données) — c'est là, et **uniquement** là, que `display_name_cache`
est indexé et interrogé par la recherche globale (voir §8).

### 7.2 Le seul point d'accès : `src/server/metworkcrm/platform-refs.ts`

```ts
// Module SERVEUR uniquement. N'importe JAMAIS db.update.
import { cache } from 'react';
import { db } from '@/server/db/store';

/** Une seule lecture du document JSON par requête (React cache + cache interne du store). */
const readPlatform = cache(() => db.read());

export const resolveStartupListings   = async (ids: string[]) => { /* Map<id, DTO> */ };
export const resolveMentors           = async (ids: string[]) => { /* Map<id, DTO> */ };
export const resolveIncubators        = async (ids: string[]) => { /* Map<id, DTO> */ };
export const resolveUsers             = async (ids: string[]) => { /* Map<id, DTO> */ };
export const resolvePrograms          = async (ids: string[]) => { /* Map<id, DTO> */ };
export const resolveEvents            = async (ids: string[]) => { /* Map<id, DTO> */ };
export const resolveSpaces            = async (ids: string[]) => { /* Map<id, DTO> */ };
export const resolveRegistrations     = async (ids: string[]) => { /* Map<id, DTO> */ };
export const resolvePartnerMemberships = async (ids: string[]) => { /* Map<id, DTO> */ };

export const searchStartupListings  = async (q: string, limit = 20) => { /* pour l'UI de liaison */ };
export const searchMentors          = async (q: string, limit = 20) => { /* pour l'UI de liaison */ };

/**
 * Flux lecture seule affichés dans le CRM (§3.3). `listContactSubmissions` sert
 * UNIQUEMENT à peupler l'action « Créer un contact CRM » (copie explicite,
 * déclenchée par un humain) — ce module n'écrit et n'écrira JAMAIS
 * `ContactSubmissionRecord.handled`. Le marquage « traité » reste la
 * responsabilité exclusive de `/dashboard/admin/contacts` côté plateforme.
 */
export const listContactSubmissions = async () => { /* … */ };
export const listInvestorContactsForListing = async (listingId: string) => { /* … */ };
```

Chaque `resolve*` renvoie un **DTO minimal** (id + champs affichés), pas l'enregistrement brut :
`MentorRecord` contient des champs privés (`pinHash`, `payoutAccount`, `phone`, `cvUrl`,
`defaultMeetingAddress`) qui ne doivent jamais atteindre un composant client.

> Ce module n'exporte **aucune** fonction d'écriture. Un `list*`/`resolve*`/`search*` qui
> finirait par appeler `db.update` serait une violation de R-1 (`METWORK_OS_DEVELOPMENT_RULES.md`)
> — c'est exactement ce que le test de non-régression du Prompt 8 (§7.5) détecte.

### 7.3 Séquence de lecture d'une page mixte

Exemple : « Liste des startups CRM » avec 50 lignes, dont 30 liées.

1. **Une** requête SQLite → 50 lignes `crm_startups`.
2. Collecte des `platform_listing_id` non NULL → 30 ids **dédupliqués**.
3. **Un** `await readPlatform()` → `Map` des 30 fiches.
4. Fusion en mémoire → view-model. La valeur plateforme **gagne** sur le cache local.
5. Rendu.

→ **2 accès au stockage, quel que soit le nombre de lignes.** Jamais de `db.read()` dans une
boucle : chaque appel clone l'intégralité du document (`structuredClone`), c'est le piège de
performance principal de cette architecture.

### 7.4 Références pendantes et caches d'affichage — DÉCISION D-6 CONFIRMÉE

**Confirmé (2026-08-20) :** chaque table du §7.1 porte sa colonne `display_name_cache`.
Règle unique, valable sur les 12 colonnes `platform_*_id` sans exception :

- Écrite **au moment de la liaison**, puis **rafraîchie à chaque lecture réussie** via
  `platform-refs.ts` (jamais réécrite hors de ce module).
- **Explicitement non autoritaire.** Tant que le `resolve*` correspondant renvoie une valeur,
  c'est **elle** qui s'affiche, jamais le cache. Aucune règle métier, aucun KPI, aucun export
  CSV/PDF ne doit lire `display_name_cache` quand la fiche plateforme est disponible — c'est le
  chemin normal, celui du cache n'est que le repli.
- Si la fiche plateforme a disparu (suppression, purge) : la ligne CRM **reste fonctionnelle**,
  affiche `display_name_cache` et un badge « Référence plateforme introuvable ». Ce n'est jamais
  une erreur 500.
- **Deux régimes selon la table** (voir le tableau §7.1) :
  1. `crm_startups` / `crm_experts` — le nom local peut être NULL (c'est tout l'intérêt de la
     liaison : ne pas dupliquer). `display_name_cache` y est donc **indexé et interrogé par la
     recherche globale** (§8) — c'est la seule façon de faire tourner `WHERE nom LIKE ?` en SQL
     quand le nom vit dans l'autre moteur.
  2. Les six autres tables (`crm_organizations`, `crm_contacts`, `crm_partnerships`,
     `crm_programs`, `crm_program_participants`, `crm_space_bookings`) — le nom local est
     **NOT NULL** et reste la seule colonne indexée pour la recherche. `display_name_cache` y est
     un champ d'affichage secondaire (« lié comme : … ») et de détection de dérive
     (le nom saisi par l'équipe diverge-t-il du nom plateforme actuel ?), pas un canal de recherche.

### 7.5 Sens de circulation — verrouillé

```
   SQLite CRM  ──── lecture ────►  store JSON plateforme
   SQLite CRM  ──── écriture ───►  ✗  INTERDIT, sans exception
```

Test de non-régression exigé au Prompt 8 : un test qui échoue si `db.update`, `localPersist`
ou un import du store apparaît ailleurs que dans `platform-refs.ts` sous `src/server/metworkcrm/`
ou `src/app/api/metworkcrm/`.

---

## 8. Recherche globale — implémentation

**v1 (recommandé) :** `UNION ALL` sur les tables sources, sans table d'index à maintenir.

```sql
SELECT 'ORGANIZATION' AS kind, id, name        AS title, city   AS subtitle FROM crm_organizations WHERE name      LIKE :q COLLATE NOCASE
UNION ALL
SELECT 'CONTACT',            id, full_name,               email             FROM crm_contacts      WHERE full_name LIKE :q COLLATE NOCASE OR email LIKE :q COLLATE NOCASE
UNION ALL
SELECT 'TASK',               id, title,                   status            FROM crm_tasks         WHERE title     LIKE :q COLLATE NOCASE
UNION ALL
SELECT 'INTERACTION',        id, subject,                 type              FROM crm_interactions  WHERE subject   LIKE :q COLLATE NOCASE
LIMIT 50;
```

- Les index `COLLATE NOCASE` listés plus haut accélèrent les recherches **par préfixe**
  (`'abc%'`). Une recherche `'%abc%'` fait un scan — acceptable au volume d'un CRM interne
  (quelques milliers de lignes), à réévaluer au-delà de ~100 000.
- **Chemin de montée en charge documenté :** table virtuelle FTS5 `crm_search_fts`
  (`content=''`, alimentée par triggers) — à n'introduire que si la latence devient mesurable.
  Ne pas la construire au Prompt 1 : c'est de la complexité non justifiée aujourd'hui.
- Les entités du store JSON (`StartupListing`, `MentorRecord`) **ne sont pas** dans cette
  recherche : elles ont leur propre écran de recherche, celui de l'UI de liaison (§7.2).

---

## 9. Index — récapitulatif par usage

| Usage | Index |
|---|---|
| Recherche globale | `*_nc` (COLLATE NOCASE) sur `crm_organizations.name`, `crm_contacts.full_name`, `crm_contacts.email`, `crm_tasks.title`, `crm_interactions.subject`, `crm_opportunities.title`, `crm_startups.name`+`display_name_cache`, `crm_experts.name`+`display_name_cache`, `crm_partnerships.name`, `crm_programs.title`, `crm_oi_projects.title` |
| Timeline Organisation | `idx_crm_int_org_time`, `idx_crm_task_org`, `idx_crm_opp_org`, `idx_crm_doclink_entity` |
| Timeline Contact | `idx_crm_int_contact_time`, `idx_crm_task_contact`, `idx_crm_co_pair` |
| Dashboard « Aujourd'hui » | `idx_crm_task_assignee_due`, `idx_crm_int_next_action`, `idx_crm_book_dates` |
| Dashboard « Urgent » | `idx_crm_task_open_due`, `idx_crm_pay_overdue`, `idx_crm_opp_stale` |
| Pipeline / KPI | `idx_crm_opp_stage`, `idx_crm_startup_stage`, `idx_crm_expert_stage`, `idx_crm_part_stage`, `idx_crm_oi_stage`, `idx_crm_prog_stage` |
| Intégrité liaisons | index UNIQUE partiels sur toutes les colonnes `platform_*_id` uniques |
| Auth | `idx_internal_users_email`, `idx_crm_sessions_user`, `idx_crm_sessions_expires` |

---

## 10. Migrations & seed

- **Une seule passe** au Prompt 1 : toutes les tables ci-dessus, y compris celles dont l'UI
  arrive aux prompts 4 à 7. Les prompts suivants ne touchent plus aux migrations.
- Migrations versionnées par drizzle-kit (dialecte `turso` en prod, `sqlite`/`better-sqlite3`
  en dev — même fichier de schéma, voir §12), appliquées par une **commande CLI explicite** —
  **jamais** au démarrage d'une route (une migration concurrente sur plusieurs instances
  serverless est un scénario de corruption).
- Seed idempotent : le script vérifie l'existence de `mohamed@metwork.dz` avant d'insérer, donc
  un re-run n'écrase jamais un mot de passe déjà changé.

  **Amendé (2026-08-20, décision du propriétaire) :** le mot de passe initial est **`123456`,
  en dur** comme défaut dans `scripts/metworkcrm/seed.ts`. `METWORKCRM_SEED_PASSWORD` reste
  accepté et prioritaire quand la variable est définie. Le hash est toujours produit par
  `hashPassword()` à l'exécution — **aucun hash n'est stocké dans le dépôt**.
  `must_change_password = 1` est posé quelle que soit la valeur utilisée : c'est ce drapeau,
  couplé à la garde `requireCrmUser()` et au rate-limit du login, qui empêche le credential
  semé de survivre à la première connexion. Voir R-15 dans
  `METWORK_OS_DEVELOPMENT_RULES.md` pour la contrepartie complète et la consigne de production.
- Aucune migration ne touche `app_state` (Supabase) ni `.local-db.json`. Jamais.

---

## 11. Vérification post-migration (checklist Prompt 1)

- [ ] `PRAGMA foreign_keys` renvoie 1 sur une connexion neuve.
- [ ] Les 29 tables existent (`SELECT name FROM sqlite_master WHERE type='table'`).
- [ ] `PRAGMA foreign_key_check` renvoie 0 ligne.
- [ ] `PRAGMA integrity_check` renvoie `ok`.
- [ ] Insertion d'une tâche sans aucun lien → **rejetée** par le `CHECK`.
- [ ] Insertion d'une `crm_startups` sans `name` ni `platform_listing_id` → **rejetée**.
- [ ] Deux `crm_startups` avec le même `platform_listing_id` → **rejetée**.
- [ ] Re-run du script de migration + du seed → aucun changement, aucune erreur.
- [ ] `npm run type-check` → 0 erreur (baseline de l'audit).
- [ ] Le document `app_state` Supabase a exactement le même `updated_at` qu'avant la migration.
- [ ] Seed sans `METWORKCRM_SEED_PASSWORD` → compte créé avec le défaut `123456` **et**
      `must_change_password = 1` ; la première connexion impose le changement.
- [ ] La même migration s'applique sans modification sur les deux drivers (`better-sqlite3` local
      **et** `@libsql/client`/Turso) — voir §12.
- [ ] `src/middleware.ts` : `/metworkcrm/login` chargé directement (sans préfixe de locale) et
      sans redirection vers `/en/metworkcrm/login`.

---

## 12. Abstraction de connexion (Turso ↔ SQLite local) — DÉCISION D-2 CONFIRMÉE

**Confirmé (2026-08-20) :** production sur **drizzle-orm + `@libsql/client` (Turso)** ;
dev/test sur **`better-sqlite3`**. Un seul schéma drizzle, un seul jeu de migrations
(§10) ; seul le driver de connexion change selon l'environnement — **aucun code de requête
ne doit jamais tester l'environnement.**

### 12.1 Le principe : un seul point de branchement

```ts
// src/server/metworkcrm/db/client.ts — SEUL fichier qui connaît le driver actif.
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { drizzle as drizzleBetterSqlite3 } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';

function createCrmDb() {
  const url = process.env.METWORKCRM_DATABASE_URL; // ex. libsql://…-turso.io ou file:./.crm-local.db

  if (!url) {
    throw new Error('METWORKCRM_DATABASE_URL must be set.');
  }

  // libsql:// (ou https://) → Turso. file: → SQLite local (dev/test).
  if (url.startsWith('libsql://') || url.startsWith('https://')) {
    const client = createClient({
      url,
      authToken: process.env.METWORKCRM_DATABASE_AUTH_TOKEN,
    });
    return drizzleLibsql(client, { schema });
  }

  const path = url.replace(/^file:/, '');
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  return drizzleBetterSqlite3(sqlite, { schema });
}

export const crmDb = createCrmDb();
```

- **Tout** le code applicatif (`src/server/metworkcrm/services/**`) importe `crmDb` depuis ce
  seul module et écrit des requêtes drizzle **portables** — pas de SQL brut spécifique à un
  driver, pas de branchement `if (isProd)` ailleurs dans le code.
- `PRAGMA foreign_keys = ON` / `journal_mode = WAL` sont posés **une fois**, ici, pour le
  driver fichier. `@libsql/client` applique `foreign_keys = ON` par défaut sur Turso ; à vérifier
  explicitement au Prompt 1 (ajouter le PRAGMA côté client libSQL également si nécessaire, pour
  ne jamais dépendre d'un défaut serveur non garanti par contrat).
- Changer d'environnement = changer **une variable d'environnement**, jamais une ligne de code.

### 12.2 Variables d'environnement (à ajouter à `.env.example`, Prompt 1)

| Variable | Dev local | Test (Vitest/Playwright) | Production |
|---|---|---|---|
| `METWORKCRM_DATABASE_URL` | `file:./.crm-local.db` | `file::memory:` ou fichier temporaire par run | `libsql://<db>-<org>.turso.io` |
| `METWORKCRM_DATABASE_AUTH_TOKEN` | absent | absent | token Turso, **server-only**, jamais `NEXT_PUBLIC_*` |
| `METWORKCRM_SEED_PASSWORD` | valeur de dev arbitraire | valeur de test arbitraire | secret fort, généré une fois, jamais réutilisé |

`.crm-local.db` rejoint `.gitignore` au même titre que `.local-db.json` (déjà ignoré). Ajout
purement additif à `src/lib/env.ts` — nouvelles clés Zod optionnelles, ne modifie aucune clé
existante.

### 12.3 Ce qui ne change JAMAIS entre les deux drivers

- Le schéma SQL (`METWORK_OS_DATABASE_SCHEMA.md`, tables 1 à 6) : identique caractère pour
  caractère, `CHECK`, colonnes générées et index compris — libSQL est un fork de SQLite.
- Les migrations drizzle-kit : un seul dossier `drizzle/migrations/`, appliqué aux deux cibles.
- Le code de requête applicatif : `crmDb.select()...`, `crmDb.insert()...` — identique.

### 12.4 Ce qui diffère, et où c'est isolé

| Différence | Isolée dans |
|---|---|
| Driver (`@libsql/client` vs `better-sqlite3`) | `src/server/metworkcrm/db/client.ts` uniquement |
| `PRAGMA` (posés explicitement en local, à vérifier côté Turso) | idem |
| Empaquetage serverless : `better-sqlite3` est un module natif → nécessite `experimental.serverComponentsExternalPackages: ['better-sqlite3']` dans `next.config.mjs` s'il doit un jour tourner dans une route (C-3) | `next.config.mjs`, **uniquement si** le driver fichier est chargé en dehors des scripts CLI/tests. En production (Turso, client HTTP pur) cette contrainte ne s'applique pas |
| Latence réseau (Turso = HTTP) vs I/O local quasi nul | à absorber par les mêmes index (§9) ; aucune requête CRM ne doit dépendre d'une latence sub-milliseconde pour rester correcte |

---

## Historique des révisions

| Date | Changement |
|---|---|
| 2026-08-19 | Version initiale (Prompt 0, audit) |
| 2026-08-20 (b) | Amendement post-implémentation (Prompt 1) : mot de passe de seed `123456` en dur par défaut (`METWORKCRM_SEED_PASSWORD` reste prioritaire) — décision du propriétaire, contrepartie détaillée en §10 et R-15 ; ajout du garde-fou documenté sur l'interaction CHECK anti-orphelin × `ON DELETE SET NULL` (§2) |
| 2026-08-20 | Décisions confirmées et intégrées : D-2 (Turso/libSQL prod + better-sqlite3 dev, §12), D-6 (`display_name_cache` généralisé aux 12 colonnes `platform_*_id`, §0/§7.4), C-2/C-3 documentés en détail, seed via `METWORKCRM_SEED_PASSWORD`, endpoint d'upload dédié `/api/metworkcrm/upload`, garde `TEAM_MEMBER` étendue aux montants hors module Paiements |
