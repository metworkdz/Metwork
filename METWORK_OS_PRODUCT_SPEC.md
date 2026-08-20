# METWORK OS — Product Spec (CRM interne)

**Scope:** `metwork.dz/metworkcrm` — outil interne pour Mohamed + équipe.
**Statut:** source de vérité produit pour les prompts 1 → 8 du pack CRM.
**Généré par:** PROMPT 0 (audit, aucun code) · branche `crm/00-audit-docs` · 2026-08-19.

Ce document adapte le cahier des charges au **code réel** du dépôt Metwork
(Next.js 14 App Router, TypeScript strict, store JSON unique sur Supabase).
Chaque entité est classée :

- **(a) NEW** — nouvelle table SQLite, aucun équivalent plateforme.
- **(b) EXTENSION** — ajout de champs à une entité plateforme existante.
- **(c) REFERENCE** — aucune donnée dupliquée, simple clé étrangère sortante vers le store JSON.

> **Résultat de l'audit : il n'y a AUCUNE entité de classe (b).**
> Aucun champ n'est ajouté à `UserRecord`, `MentorRecord`, `StartupListingRecord`,
> `IncubatorRecord`, `BookingRecord` ni à aucun autre enregistrement du store JSON.
> Le CRM est un **overlay strictement en lecture** sur la plateforme. Toute écriture
> CRM va dans la base SQLite dédiée. C'est la garantie centrale de ce build.

---

## 1. État des lieux — ce qui existe réellement

### 1.1 Stockage plateforme

Le "backend NestJS séparé" mentionné dans `CLAUDE.md` n'existe pas dans ce dépôt :
les 207 routes `src/app/api/**/route.ts` sont le backend. Toutes les données
applicatives vivent dans **un seul document JSONB** (`app_state`, `id = 1`) sur
Supabase, exposé par `src/server/db/store.ts` via `db.read()` / `db.update()`.

- `db.read()` → clone profond de tout l'état (cache en mémoire + TTL par instance).
- `db.update(mutator)` → section critique sérialisée, ré-écriture du document entier.
- Mode local dev/CI : `USE_LOCAL_DB=true` → fichier `.local-db.json`.

**Conséquence pour le CRM :** une lecture plateforme coûte *un* `db.read()` qui
ramène **tout**. Il ne faut donc jamais faire de N+1 : on lit une fois par requête
et on hydrate en mémoire (voir `METWORK_OS_DATABASE_SCHEMA.md` §7).

### 1.2 Collections existantes pertinentes pour le CRM

| Collection (`DbShape`) | Type | Ce que c'est vraiment | Rapport au CRM |
|---|---|---|---|
| `users` | `UserRecord[]` | Comptes clients plateforme (ENTREPRENEUR / INVESTOR / INCUBATOR / ADMIN) | Référence optionnelle depuis `crm_contacts` |
| `mentors` | `MentorRecord[]` | Consultants — **population séparée, sans `UserRecord`**, auth propre (OTP + PIN) | Cible de `crm_experts.platform_mentor_id` |
| `startupListings` | `StartupListingRecord[]` | Fiches levée de fonds publiées par des fondateurs | Cible de `crm_startups.platform_listing_id` |
| `incubators` | `IncubatorRecord[]` | Comptes fournisseurs (incubateurs / coworkings / centres de formation) | Référence optionnelle depuis `crm_organizations` |
| `clients` | `ClientRecord[]` | **Déjà commenté "CRM — client records per incubator"** — carnet clients *par incubateur*, alimente factures + revenus | ⚠️ Homonyme, **ne pas fusionner** (voir §3.1) |
| `contactSubmissions` | `ContactSubmissionRecord[]` | Formulaire de contact public (nom/email/message) | Flux entrant lecture seule vers l'Inbox CRM |
| `investorContacts` | `InvestorContactRecord[]` | Demandes de mise en relation investisseur → startup | ⚠️ N'est **pas** une Interaction CRM (voir §3.3) |
| `spaces` / `deskBookings` / `bookings` | catalogue + réservations réelles | Système de réservation **transactionnel en production** | Référence libre uniquement, aucune synchro |
| `programs` / `events` / `registrations` | catalogue + inscriptions | Programmes incubateur **et** consultant (`mentorId`) | Référence optionnelle |
| `partnerMemberships` | `PartnerMembershipRecord[]` | "Partner Program" = espaces adhérents au Network Pass | ⚠️ Homonyme de "Partenariats" CRM (voir §3.4) |
| `invoices` / `income` / `expenses` / `transactions` / `wallets` | comptabilité + monétique réelles | Flux d'argent réel (SlickPay/Stripe, wallets, commissions) | **Aucun lien.** Le module Paiements CRM est un suivi manuel |
| `notifications` | `NotificationRecord[]` | Notifications in-app, clé `userId` → `UserRecord` | Inutilisable pour le CRM (autre espace d'identité) |
| `auditLogs` | `AuditLogRecord[]` | Journal des actions admin plateforme | Le CRM aura son propre journal |

### 1.3 Auth plateforme

Trois espaces d'identité **déjà** distincts coexistent :

1. **Utilisateurs clients** — cookie `metwork_session`, `SessionRecord` (SHA-256 de l'id),
   mot de passe scrypt (`src/server/auth/password.ts`), garde `requireRole()` / `requireApiSession()`.
2. **Consultants** — cookie `metwork_consultant`, `MentorSessionRecord`, OTP + PIN scrypt,
   garde `requireConsultant()` (`src/server/mentors/access.ts`). **Aucun `UserRecord`.**
3. **Appareils de confiance consultant** — cookie `metwork_consultant_device`.

Le CRM ajoute un **quatrième** espace (`internal_users`, cookie dédié). Le précédent
consultant prouve que ce pattern est déjà maîtrisé dans ce code : on le copie.

### 1.4 Routage

`src/app/layout.tsx` est un layout racine **pass-through** (il importe seulement
`globals.css` + `tier-colors.css` et retourne `children`). Tout le reste vit sous
`src/app/[locale]/`.

→ `src/app/metworkcrm/` peut donc exister en **frère** de `[locale]`, avec son propre
layout, ses propres polices et **zéro next-intl**. Un segment statique gagne toujours
sur un segment dynamique dans Next.js, donc `/metworkcrm` ne sera jamais capté par `[locale]`.

⚠️ **Une seule exception au périmètre :** `src/middleware.ts` doit recevoir un
early-return pour `/metworkcrm*` avant `intlMiddleware`, sinon next-intl redirige vers
`/en/metworkcrm`. C'est exactement le pattern déjà en place pour `/mentordashboard`.
C'est le **seul** fichier plateforme que le build CRM a le droit de modifier (voir CONFLIT C-2).

### 1.5 Design system

- `#30a735` (vert marque) **n'est pas** dans `tailwind.config.ts`. Le thème utilise des
  variables HSL (`--primary`) dont la 500 est `hsl(142, 60%, 38%)` ≈ `#278a3f` — proche
  mais **différent**. Le CRM doit définir ses propres tokens, sans toucher au thème global.
- `#2ECC71` est le vert du **portail consultant** — interdit ici (règle marque).
- **Space Grotesk est déjà chargé** (`next/font/google`) mais **uniquement dans
  `src/app/[locale]/layout.tsx`**, exposé en `--font-grotesk`. Le CRM étant hors de cet
  arbre, il doit instancier sa propre `Space_Grotesk()` dans `src/app/metworkcrm/layout.tsx`.

### 1.6 Baseline qualité

- `npm run type-check` : **0 erreur** au moment de l'audit. C'est le contrat à préserver.
- `npm run build` ignore les erreurs TS (`next.config.mjs`) — donc `type-check` est le seul filet.
- Tests : Vitest, série unique (`singleFork: true`) car état DB partagé en mémoire.
- E2E : Playwright, projets nommés (dont `consultation`, `space-reservation-modes`).

---

## 2. Architecture cible du module CRM

```
src/app/metworkcrm/                 ← hors [locale], français uniquement
  layout.tsx                        ← polices + tokens marque CRM + shell
  login/page.tsx
  change-password/page.tsx
  (app)/                            ← groupe protégé par la session CRM
    page.tsx                        ← Dashboard
    inbox/ organizations/ contacts/ sales/ startups/ partnerships/
    open-innovation/ experts/ programs/ spaces/ activities/ tasks/
    payments/ documents/ reports/ settings/ users/
src/app/api/metworkcrm/**/route.ts  ← API CRM (namespace dédié)
src/server/metworkcrm/
  db/                               ← client drizzle + schéma + migrations
  auth/                             ← session, garde de rôle, mot de passe
  platform-refs.ts                  ← SEULE porte de lecture vers le store JSON
  services/                         ← logique métier par module
src/components/metworkcrm/          ← UI CRM (aucun composant partagé modifié)
```

**Règle de couplage :** le CRM peut **importer** des utilitaires plateforme
(`hashPassword`, `verifyPassword`, `checkRateLimitDistributed`, `@/lib/cloudinary`,
`db.read`) mais ne doit **jamais** appeler `db.update()` ni importer un composant
qu'il modifierait.

---

## 3. Conflits de nommage à trancher (détail)

### 3.1 `clients` (plateforme) vs **Contacts** (CRM)

`DbShape.clients` est **déjà** documenté « CRM — client records per incubator ». Ce sont
les clients facturables d'un incubateur : `fullName`, `email`, `phone`, `idCardNumber`,
`companyName`, plus le bloc légal algérien (`legalName`, `rc`, `nif`, `nis`, `ai`).
Ils alimentent `invoices.clientSnapshot` et `income.clientId`. 15 enregistrements en dev.

**Décision recommandée :** aucun rapport, aucune migration, aucune fusion. Ces clients
appartiennent aux **incubateurs partenaires**, pas à Metwork. Le CRM interne gère les
contacts **de Metwork**. Cohabitation, deux carnets d'adresses distincts.
*(Le mot « client » sera évité dans l'UI CRM au profit de « Contact » / « Organisation ».)*

### 3.2 `StartupListing` vs **Startups CRM**

`StartupListingRecord` = fiche de **levée de fonds** publiée par un fondateur :
`name`, `description`, `industry`, `fundingGoal`, `equityOffered`, `valuation`,
`maturityStage`, `pitchDeckUrl`, `websiteUrl`, `founderId` (→ `UserRecord`), `status`.

Il **manque** ce dont le CRM a besoin : `city`, contact opérationnel, étape de pipeline
d'accompagnement, mentor assigné, programme.

**Classe : (c) REFERENCE.** `crm_startups.platform_listing_id` → `StartupListingRecord.id`.
Deux états visibles dans l'UI :

- **Liée** — `platform_listing_id` renseigné. Nom / secteur / description / fondateur
  viennent **du store JSON à la lecture**, jamais copiés. Badge « Sur la plateforme ».
- **CRM-only** — `platform_listing_id` NULL. Prospect pré-plateforme, saisi à la main.
  Badge « Hors plateforme ». Ces enregistrements portent leurs propres `name`/`sector`.

L'UI de liaison recherche dans `startupListings` (via `platform-refs.ts`) et attache par id.
Une startup CRM-only peut être promue en "liée" plus tard sans perdre son historique.
**Aucune écriture n'atteint jamais `startupListings`.**

⚠️ `startupListings` contient **0 enregistrement** dans la base de dev locale — à vérifier
en production avant de bâtir l'UI de recherche/liaison (voir AMBIGUÏTÉ A-2).

### 3.3 `investorContacts` / `contactSubmissions` vs **Interactions CRM**

- `InvestorContactRecord` = demande **investisseur → startup** avec statut
  `PENDING | CONNECTED | DECLINED`, arbitrée par un admin plateforme
  (`/dashboard/admin/investor-contacts`). C'est un objet **métier de la plateforme**,
  pas un journal d'activité commerciale. Il a son propre cycle de vie et une UI vivante.
- `ContactSubmissionRecord` = formulaire de contact public (`name`, `email`, `message`,
  `handled`), lu par `/dashboard/admin/contacts`.

**Décision recommandée :** aucune migration, aucune double écriture.
- `contactSubmissions` → affiché **en lecture seule** dans l'Inbox CRM comme flux de leads,
  avec une action « Créer un contact CRM » qui **copie** les champs dans un nouveau
  `crm_contacts` (copie explicite déclenchée par un humain, pas une synchro).
- `investorContacts` → affiché en lecture seule sur la fiche startup CRM liée (« demandes
  investisseurs sur la plateforme »). Le statut reste géré côté plateforme.

⚠️ Le flag `handled` de `contactSubmissions` est une **écriture plateforme**. Si l'équipe
veut cocher « traité » depuis le CRM, cela viole la règle « lecture seule » → voir AMBIGUÏTÉ A-3.

### 3.4 `partnerMemberships` vs **Partenariats CRM**

`PartnerMembershipRecord` = adhésion d'un incubateur au **Partner Program** (Network Pass,
codes promo -50 %, taux de reversement par visite). C'est un objet transactionnel qui pilote
de l'argent réel.

Les « Partenariats » du cahier des charges sont une notion **commerciale** bien plus large
(Corporate, Université, Accélérateur, Média…), avec pipeline Prospect → Actif.

**Décision recommandée :** entités distinctes. `crm_partnerships.platform_partner_membership_id`
est un lien **optionnel** pour les cas où le partenaire est aussi un espace adhérent.
L'UI CRM parlera de « Partenariat » ; le Partner Program restera nommé « Network Pass » partout.

### 3.5 `MentorRecord` vs **Experts CRM**

`MentorRecord` est riche : `fullName`, `position`, `field`, `topics[]`, `categoryIds[]`,
`bio`, `city`, `email`, `phone`, tarifs (`consultationFee`, `ratePer30`, `ratePer60`),
disponibilités, `approvalStatus`, `payoutAccount`, `cvUrl`.

**Classe : (c) REFERENCE.** `crm_experts.platform_mentor_id` → `MentorRecord.id`, même
double état Lié / CRM-only que les startups.

⚠️ Deux limites à connaître :
1. Un formateur peut être un **compte incubateur** (`IncubatorRecord.businessType = 'TRAINING_CENTER'`)
   ou un simple contact hors plateforme — pas forcément un `MentorRecord`. Le modèle CRM doit
   donc accepter des experts CRM-only, et c'est le cas.
2. L'historique de missions plateforme d'un consultant est éclaté sur `mentorBookings`,
   `mentorConsultations` et `programs.mentorId`. Le CRM aura sa **propre** table
   `crm_expert_missions` (missions internes Metwork) et affichera l'historique plateforme
   à côté, en lecture seule, sans le fusionner.

---

## 4. Spécification par module

Chaque module liste : entités, classe, cycle de vie, liens obligatoires.
Les libellés de pipeline sont donnés en **valeurs stockées** (constantes) ; l'UI affiche
le français correspondant.

### 4.1 Authentification & rôles — `internal_users` · **(a) NEW**

- Espace d'identité **totalement séparé** de `users` et de `mentors`. Un même email peut
  exister dans les trois sans aucun rapport.
- Réutilise `hashPassword` / `verifyPassword` (scrypt) de `@/server/auth/password.ts` —
  import, pas de réimplémentation.
- Session : cookie dédié, stockage du **SHA-256** de l'id seulement (pattern `session.ts`).
- Rôles : `ADMIN` (tout) · `TEAM_MEMBER` (tout sauf `/settings`, `/users`, `/payments`).
- Compte semé : `mohamed@metwork.dz`, `mustChangePassword = true`.
- Changement de mot de passe forcé : bloquant, avant toute autre page CRM.
- Rate limit sur `/metworkcrm/login` via `checkRateLimitDistributed` (déjà distribué Upstash,
  fail-open, fallback mémoire).

### 4.2 Organisations · **(a) NEW**

Types : `ENTREPRISE`, `STARTUP`, `INCUBATEUR`, `ACCELERATEUR`, `UNIVERSITE`,
`INSTITUTION_PUBLIQUE`, `ONG_ASSOCIATION`, `INVESTISSEUR`, `MEDIA`, `AUTRE`.
Statut : `PROSPECT`, `ACTIF`, `INACTIF`, `ARCHIVE`.

Fiche « tout visible sur une page » (exemple « Entreprise ABC » du cahier) : contacts liés,
timeline d'interactions, tâches ouvertes, opportunités, partenariats, projets OI, programmes,
réservations, paiements, documents.

Liens sortants optionnels **(c)** : `platform_incubator_id` → `IncubatorRecord.id`,
`platform_user_id` → `UserRecord.id`.

### 4.3 Contacts · **(a) NEW**

Rattachables à **plusieurs** organisations (table de jonction `crm_contact_organizations`
avec `role` et `is_primary`). Même page « tout visible » avec timeline.

Liens sortants optionnels **(c)** : `platform_user_id`, `platform_mentor_id`.

### 4.4 Interactions · **(a) NEW**

Types : `APPEL`, `EMAIL`, `WHATSAPP`, `LINKEDIN`, `REUNION`, `VISIO`, `VISITE`, `RELANCE`,
`PROPOSITION`, `DOCUMENT_ENVOYE`, `AUTRE`. Sens : `INBOUND` / `OUTBOUND`.

Champs pivots du produit : **`next_action` + `next_action_date`** — ce sont eux qui
alimentent les vues « Aujourd'hui » et « En retard » du Dashboard (Prompt 6) et
l'automatisation « interaction close sans prochaine action » (Prompt 7).

**Anti-orphelin (contrainte SQL) :** au moins un lien parmi contact / organisation /
opportunité / startup / expert / partenariat / programme / projet OI.

### 4.5 Tâches · **(a) NEW**

Priorité : `URGENTE`, `HAUTE`, `MOYENNE`, `BASSE`.
Statut : `INBOX`, `A_FAIRE`, `EN_COURS`, `EN_ATTENTE`, `TERMINEE`.
Assignée à un `internal_users`. **Anti-orphelin : au moins un lien** (contrainte `CHECK`).
`automation_key` unique pour l'idempotence des tâches auto-créées (Prompt 7).

### 4.6 Recherche globale · **(a) NEW**

Barre unique, résultats groupés par type sur Organisations, Contacts, Tâches, Interactions
(v1). Implémentation : `UNION ALL` sur les tables sources, `LIKE` insensible à la casse.
**Ne couvre pas** les entités du store JSON — la recherche de `StartupListing` / `MentorRecord`
est un écran distinct, celui de l'UI de liaison (Prompt 3).

### 4.7 Sales / Opportunités · **(a) NEW**

Pipeline : `NOUVEAU_LEAD` → `CONTACTE` → `BESOIN_IDENTIFIE` → `PROPOSITION_ENVOYEE` →
`RELANCE` → `NEGOCIATION` → `GAGNE` / `PERDU`.
Types : `COWORKING`, `SALLE`, `PACK`, `INCUBATION`, `ACCELERATION`, `PRE_INCUBATION`,
`CONSULTING`, `FORMATION`, `AUTRE`.
Montant en **DZD entier** (convention de toute la plateforme — jamais de flottant).
`stage_changed_at` + `last_activity_at` alimentent « opportunité bloquée / inactive 7 j ».
Historique des changements d'étape conservé (`crm_opportunity_stage_history`) pour les KPI
de conversion et de délai de traitement.

### 4.8 Startups CRM · **(a) NEW table, (c) référence sortante**

Pipeline : `LEAD` → `DIAGNOSTIC` → `BESOINS_IDENTIFIES` → `PROGRAMME_PACK` → `ONBOARDING`
→ `ACTIF` → `TERMINE` → `ALUMNI`. Mentor assigné (`crm_experts`), programme (`crm_programs`).
Double état Lié / CRM-only — voir §3.2.

### 4.9 Experts CRM · **(a) NEW table, (c) référence sortante**

Pipeline : `PROSPECT` → `CONTACTE` → `ENTRETIEN` → `VALIDE` → `CONVENTION` → `ACTIF` → `INACTIF`.
Spécialités, notes internes, historique de missions (`crm_expert_missions`).
Double état Lié / CRM-only — voir §3.5.

### 4.10 Partenariats · **(a) NEW**

Types : `CORPORATE`, `INCUBATEUR`, `ACCELERATEUR`, `UNIVERSITE`, `INSTITUTION`, `ONG`,
`MEDIA`, `INVESTISSEUR`, `AUTRE`.
Pipeline : `PROSPECT` → `CONTACTE` → `CONVERSATION` → `REUNION` → `PROPOSITION` →
`NEGOCIATION` → `ACTIF` → `TERMINE`.
Rattaché à une Organisation (obligatoire) + N Contacts + documents + tâches.

### 4.11 Open Innovation · **(a) NEW**

Pipeline : `ENTREPRISE_IDENTIFIEE` → `PROBLEME_IDENTIFIE` → `DIAGNOSTIC` → `DEFI_DEFINI` →
`RECHERCHE_SOLUTION` → `STARTUPS_EXPERTS_MOBILISES` → `POC` → `EXPERIMENTATION` →
`DEPLOIEMENT` → `TERMINE`.
Budget (DZD entier). Startups et experts mobilisés via deux tables de jonction explicites
(FK réelles, pas de polymorphisme).

### 4.12 Programmes & Événements CRM · **(a) NEW, (c) lien optionnel**

Pipeline : `IDEE` → `PLANIFICATION` → `FORMATEUR_CONFIRME` → `PROMOTION` → `INSCRIPTIONS` →
`EN_COURS` → `TERMINE` → `REPORTING`.
Participants, formateurs (→ `crm_experts`), partenaires, tâches, lien paiements.
Liens sortants **(c)** optionnels : `platform_program_id` → `ProgramRecord.id`,
`platform_event_id` → `EventRecord.id`, `crm_program_participants.platform_registration_id`
→ `RegistrationRecord.id`.
⚠️ Un `ProgramRecord` peut appartenir à un incubateur **ou** à un consultant
(`incubatorId` XOR `mentorId`) — l'affichage du propriétaire doit passer par
`@/server/programs/ownership`, jamais par une lecture directe des champs.

### 4.13 Réservations espaces (suivi interne) · **(a) NEW**

Workflow : `DEMANDE` → `VERIFICATION_DISPO` → `DEVIS_ENVOYE` → `ATTENTE_CONFIRMATION` →
`CONFIRME` → `PAYE` → `TERMINE` (+ `ANNULE`).

**Frontière stricte, non négociable :** ce module est un **journal manuel de l'équipe**.
Il ne lit pas les disponibilités réelles, n'écrit aucun `BookingRecord` / `DeskBookingRecord`,
ne bloque aucun créneau, ne déclenche aucun paiement. `platform_space_id` est une simple
étiquette de référence. Le moteur de disponibilité canonique
(`src/server/spaces/availability.ts` + le portail incubateur) reste l'unique vérité.

### 4.14 Suivi des paiements · **(a) NEW · ADMIN uniquement**

Statuts : `EN_ATTENTE` → `RELANCE_1` → `RELANCE_2` → `PAYE` (+ `ANNULE`).

**Frontière stricte :** « ne remplace pas une comptabilité ». Aucun lien avec
`wallets`, `transactions`, `invoices`, `income`, SlickPay ou Stripe. Aucun montant CRM
ne doit jamais être présenté comme un chiffre d'affaires officiel. `external_ref` est un
champ texte libre (ex. numéro de facture plateforme), **sans** clé étrangère.

Garde de rôle : `TEAM_MEMBER` reçoit un 404/403 sur `/metworkcrm/payments` **et** sur
`/api/metworkcrm/payments/**` (garde route ET API — pas seulement l'UI).

### 4.15 Documents · **(a) NEW**

Types : `CONVENTION`, `CONTRAT`, `PROPOSITION`, `PRESENTATION`, `DEVIS`, `FACTURE`, `NDA`,
`PROGRAMME`, `SUPPORT_FORMATION`, `RAPPORT`, `AUTRE`.
Upload Cloudinary, dossier `metwork/crm-documents`. Rattachable à n'importe quelle entité
des prompts 2–4 via `crm_document_links` (au moins un lien obligatoire à la création).

⚠️ La route `/api/upload` existante **ne convient pas** : elle exige une session *client*
plateforme (`requireApiSession`), n'accepte que des **images** (`ALLOWED_TYPES`) et plafonne
à **5 Mo**. Le CRM a besoin d'une route dédiée `/api/metworkcrm/upload` qui
importe `uploadBuffer` avec `resourceType: 'raw'`. Le helper `isSupportedDocumentMime`
n'autorise aujourd'hui que `application/pdf` → voir AMBIGUÏTÉ A-4.

### 4.16 Notifications · **(a) NEW**

In-app uniquement pour la v1. Types : `TACHE_DUE`, `RELANCE_DUE`, `PAIEMENT_RETARD`,
`REUNION_30MIN`, `OPPORTUNITE_INACTIVE`, `SYSTEME`.
`NotificationRecord` plateforme est inutilisable (clé `userId` → `UserRecord`).
`dedupe_key` unique empêche la re-notification en boucle.

### 4.17 Automatisations · **(a) NEW**

Toutes **non bloquantes** : une automatisation qui échoue ne doit jamais annuler l'écriture
déclenchante. Elle s'exécute **après** le commit de la transaction principale, ses erreurs
sont journalisées (`crm_automation_runs`) et avalées.

| Déclencheur | Effet |
|---|---|
| Opportunité → `PROPOSITION_ENVOYEE` | Tâche « Relance dans 3 jours » |
| Paiement en retard | Tâche « Relance paiement » |
| Interaction close sans `next_action` | Blocage UI : demander la prochaine action |
| Startup → `ONBOARDING` | Jeu de tâches d'onboarding |
| Programme créé | Checklist standard (formateur, salle, visuel, communication, inscriptions, paiement, supports, certificats, feedback, reporting) |

Idempotence par `automation_key` unique sur `crm_tasks` : un rejeu ne duplique rien.

### 4.18 Dashboard & Reporting · **(a) NEW** (Prompt 6)

Vues : Aujourd'hui · Urgent · Commercial · Écosystème · Open Innovation · Programmes.
KPI : Sales, Opérations, Startups, Écosystème, OI, Programmes.

⚠️ Question ouverte : `TEAM_MEMBER` n'a pas accès au module Paiements — a-t-il le droit de
voir les KPI de revenus agrégés sur le Dashboard et les Rapports ? → AMBIGUÏTÉ A-5.

---

## 5. Tableau récapitulatif de classification

| # | Entité CRM | Classe | Contrepartie plateforme | Sens |
|---|---|---|---|---|
| 1 | `internal_users` | **(a) NEW** | `users`, `mentors` (espaces distincts) | — |
| 2 | `crm_sessions` | **(a) NEW** | `sessions`, `mentorSessions` (pattern copié) | — |
| 3 | `crm_organizations` | **(a) NEW** + (c) opt. | `incubators`, `users` | lecture seule |
| 4 | `crm_contacts` | **(a) NEW** + (c) opt. | `users`, `mentors` · ≠ `clients` | lecture seule |
| 5 | `crm_contact_organizations` | **(a) NEW** | — | — |
| 6 | `crm_interactions` | **(a) NEW** | ≠ `investorContacts`, ≠ `contactSubmissions` | — |
| 7 | `crm_tasks` | **(a) NEW** | — | — |
| 8 | `crm_opportunities` (+ historique) | **(a) NEW** | — | — |
| 9 | `crm_startups` | **(a) NEW** + **(c)** | `startupListings` | lecture seule |
| 10 | `crm_experts` (+ missions) | **(a) NEW** + **(c)** | `mentors` | lecture seule |
| 11 | `crm_partnerships` (+ contacts) | **(a) NEW** + (c) opt. | ≠ `partnerMemberships` | lecture seule |
| 12 | `crm_oi_projects` (+ jonctions) | **(a) NEW** | — | — |
| 13 | `crm_programs` (+ participants/formateurs/partenaires) | **(a) NEW** + (c) opt. | `programs`, `events`, `registrations` | lecture seule |
| 14 | `crm_space_bookings` | **(a) NEW** + (c) opt. | `spaces` · **jamais** `bookings` | lecture seule |
| 15 | `crm_payments` | **(a) NEW** | **aucune** (volontairement) | — |
| 16 | `crm_documents` (+ liens) | **(a) NEW** | réutilise `@/lib/cloudinary` | — |
| 17 | `crm_notifications` | **(a) NEW** | ≠ `notifications` | — |
| 18 | `crm_automation_runs` | **(a) NEW** | — | — |
| 19 | `crm_activity_log` | **(a) NEW** | ≠ `auditLogs` | — |
| 20 | `crm_settings` | **(a) NEW** | ≠ `platformSettings` | — |

**Entités de classe (b) EXTENSION : aucune.**

---

## 6. Ce que le CRM ne fera jamais

1. Appeler `db.update()`, sous quelque forme que ce soit.
2. Écrire dans `app_state` (Supabase) ou dans `.local-db.json`.
3. Réserver, bloquer un créneau, encaisser, rembourser, créditer un wallet.
4. Émettre une facture légale (le moteur `src/server/invoices/engine.ts` reste seul juge).
5. Envoyer un email/WhatsApp à un client final de la plateforme.
6. Modifier une route, un composant ou une traduction hors `/metworkcrm`
   (unique exception : l'early-return de `src/middleware.ts`).
7. Ajouter une clé dans `DbShape`.

---

## 7. Registre des conflits, ambiguïtés et décisions

Référencé depuis les §3 et §4. **Mise à jour 2026-08-20 : toutes les entrées bloquantes sont
confirmées.** Détail des décisions dans `METWORK_OS_DATABASE_SCHEMA.md` et
`METWORK_OS_DEVELOPMENT_RULES.md` (règles R-4, R-6, R-7, R-15, R-19, R-24 → R-30).
**Le PROMPT 1 peut démarrer.**

### Conflits d'architecture

| Réf | Sujet | Détail | Décision |
|---|---|---|---|
| ✅ **C-1** | SQLite fichier vs Vercel serverless | Le projet déploie sur Vercel (`.vercel/project.json`, `vercel.json` région `cdg1` + 8 crons). Un fichier `better-sqlite3` y est **non persistant** et **divergent entre instances**. | **Confirmé :** drizzle-orm + `@libsql/client` (Turso) en prod, `better-sqlite3` en dev/test. Voir `METWORK_OS_DATABASE_SCHEMA.md` §12 |
| ✅ **C-2** | `src/middleware.ts` doit être modifié | Le matcher capte `/metworkcrm` et next-intl redirigerait vers `/en/metworkcrm`. Un early-return est nécessaire — c'est le **seul** fichier plateforme à toucher. | **Confirmé :** early-return avant `intlMiddleware`, sur le modèle du bloc `/mentordashboard` existant (R-4) |
| ✅ **C-3** | `next.config.mjs` si `better-sqlite3` tourne dans une route | Module natif ⇒ doit rejoindre `experimental.serverComponentsExternalPackages` (comme `pdfkit`). | **Confirmé :** modification additive d'une ligne, uniquement si nécessaire, signalée dans le SESSION_LOG (R-30) |

### Ambiguïtés produit

| Réf | Question | Impact | Décision |
|---|---|---|---|
| ✅ **A-1** | `clients` plateforme vs Contacts CRM | Homonymie, risque de confusion pour l'équipe | **Confirmé :** cohabitation, aucune fusion. Mot « client » banni de l'UI et du code CRM (§3.1, R-24) |
| ⏳ **A-2** | `startupListings` est **vide** en base de dev | L'UI de liaison du Prompt 3 pourrait être construite à l'aveugle | **Non bloquant pour le Prompt 1** — reste à vérifier avant le Prompt 3 |
| ✅ **A-3** | Cocher « traité » sur `contactSubmissions` depuis le CRM | Ce serait une **écriture plateforme**, contraire à R-1 | **Confirmé :** lecture seule, uniquement pour l'action « Créer un contact CRM ». Le CRM n'écrit jamais `handled` (R-25) |
| ✅ **A-4** | Types de fichiers acceptés pour les Documents | `isSupportedDocumentMime` n'autorise que `application/pdf` ; la liste des types (Convention, Devis, Support formation…) suggère aussi Word/Excel/images | **Confirmé :** pdf/docx/xlsx/pptx/png/jpg, 20 Mo max, route dédiée `POST /api/metworkcrm/upload` (R-26) |
| ✅ **A-5** | `TEAM_MEMBER` et les KPI financiers | Il n'a pas accès au module Paiements, mais le Dashboard et les Rapports affichent du CA et de la valeur de pipeline | **Confirmé :** aucun montant visible par `TEAM_MEMBER`, nulle part dans le CRM. Compteurs par étape et métriques non monétaires restent visibles (R-19 étendu) |

### Décisions à confirmer

| Réf | Décision | Statut |
|---|---|---|
| ⏳ **D-1** | `internal_users` : ajouter `is_active` + `updated_at` (non demandés) | Défaut proposé maintenu : oui — supprimer un membre casserait `assignee_id` et `created_by` partout. Non bloquant |
| ✅ **D-2** | Cible SQLite en production : Turso, ou repli Postgres/Supabase | **Confirmé :** Turso (reste du SQLite, sauvegarde mono-fichier). Voir C-1 |
| ⏳ **D-3** | `crm_sessions` (non listée au cahier) | Défaut proposé maintenu : oui — indispensable à l'isolation de session exigée. Non bloquant |
| ⏳ **D-4** | Documents : liens polymorphes vs 11 colonnes nullables | Défaut proposé maintenu : polymorphe + validation applicative + script d'intégrité (§4.15, schéma §6). Non bloquant |
| ✅ **D-5** | Le mot de passe semé | **Confirmé :** lu depuis la variable d'environnement `METWORKCRM_SEED_PASSWORD`, aucune valeur en dur. Hash calculé à l'exécution (R-15) |
| ✅ **D-6** | `display_name_cache` | **Confirmé, et étendu :** généralisé aux 12 colonnes `platform_*_id` de tout le schéma (pas seulement `crm_startups`/`crm_experts`), toujours non autoritaire ; seules `crm_startups`/`crm_experts` l'indexent pour la recherche, car seules elles ont un nom local nullable (R-27, schéma §7.4) |

> Les entrées ⏳ restent des défauts raisonnables **non bloquants** — elles n'empêchent pas le
> Prompt 1 de démarrer et peuvent être révisées au fil de l'eau sans remettre en cause le schéma.
