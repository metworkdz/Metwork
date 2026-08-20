# METWORK OS — Development Rules (canonique)

**Portée :** tout le build CRM `/metworkcrm` (prompts 0 → 8).
**Généré par :** PROMPT 0 · branche `crm/00-audit-docs` · 2026-08-19 · mis à jour 2026-08-20
(toutes les décisions bloquantes du registre de conflits sont confirmées — voir §7).
En cas de conflit, ce fichier + `METWORK_OS_PRODUCT_SPEC.md` + `METWORK_OS_DATABASE_SCHEMA.md`
priment sur le texte d'un prompt. Signaler le conflit et s'arrêter.

---

## 1. RÈGLES GLOBALES (bloc à recoller en tête de chaque prompt, inchangé)

```
GLOBAL RULES — APPLY TO THIS ENTIRE TASK

- This is an EXISTING, LIVE Next.js 14 App Router / TypeScript project. Do not rewrite
  or break existing functionality anywhere outside the /metworkcrm scope.
- Before writing any code: inspect the existing architecture, auth system, current
  db.read()/db.update() JSON store, and any existing schema for StartupListing,
  Consultant/Mentor accounts, and InvestorContactRecord. The CRM must be able to
  reference these by ID — do not duplicate their data.
- Produce a numbered implementation plan with per-file risk notes FIRST. Stop and
  wait for explicit approval before writing any code.
- TypeScript strict mode.
- The CRM module is French-only, no next-intl wiring needed inside /metworkcrm.
- Mobile-responsive with Tailwind breakpoints only — no useMediaQuery / window.innerWidth
  (hydration issues). Desktop-first is acceptable given data density (tables, dashboards),
  but nothing should break on mobile.
- Brand: primary green #30a735 (never #2ECC71), rich black #0D0D0D, Space Grotesk,
  premium minimalist SaaS aesthetic (FI.CO / WeWork inspired). No flashy gradients,
  no clutter, no over-animation.
- All new SQLite tables: additive-only, nullable optional fields, no destructive
  migrations against existing platform data.
- No orphan data: Tasks, Interactions, Documents, Payments-tracking entries must always
  be linkable to at least one of Organization / Contact / Opportunity / Startup / Program.
- Non-blocking externals: any email/WhatsApp notification failure must never block or
  roll back a CRM write.
- Required outputs at the end of every prompt: SESSION_LOG.md entry (what changed, why,
  files touched), a manual test checklist, and the git branch name used.
- If a requirement conflicts with existing platform architecture, STOP and explain the
  conflict before proceeding — do not silently resolve it.
```

---

## 2. Règles dérivées de l'audit (contraignantes au même titre)

### 2.1 Frontière avec la plateforme

- **R-1** — Aucun code sous `src/app/metworkcrm/`, `src/app/api/metworkcrm/`,
  `src/server/metworkcrm/`, `src/components/metworkcrm/` n'appelle `db.update()`.
  Une seule porte de lecture : `src/server/metworkcrm/platform-refs.ts`.
- **R-2** — Aucune clé n'est ajoutée à `DbShape` (`src/server/db/store.ts`).
- **R-3** — Aucun champ n'est ajouté à `UserRecord`, `MentorRecord`, `StartupListingRecord`,
  `IncubatorRecord`, `ProgramRecord`, `EventRecord`, `SpaceRecord`, `BookingRecord`.
  **Il n'existe aucune entité de classe (b) EXTENSION dans ce build.**
- **R-4** — **Confirmé (2026-08-20) — seule modification hors périmètre :** l'early-return
  `/metworkcrm*` dans `src/middleware.ts` (Prompt 1), placé **avant** `intlMiddleware(req)`,
  sur le modèle exact du bloc `/mentordashboard` existant (rewrite prefix-free, pas de redirect).
  **Pourquoi ce fichier et aucun autre :** son `matcher` (`['/((?!api|_next|_vercel|.*\\..*).*)']`)
  capte `/metworkcrm` comme n'importe quel chemin sans extension ; sans l'early-return,
  `intlMiddleware` le traiterait comme un chemin non préfixé et redirigerait vers
  `/en/metworkcrm`, cassant l'exigence « français, hors `[locale]` ». L'early-return doit
  matcher `pathname === '/metworkcrm' || pathname.startsWith('/metworkcrm/')` et `return` avant
  tout appel à `stripLocale`/`intlMiddleware` — diffable en < 10 lignes. C'est le seul fichier
  plateforme touché dans l'ensemble des prompts 1 → 8 ; toute autre modification hors
  `/metworkcrm*` est un signal d'alarme (voir §6.6).
- **R-5** — Zéro modification de `src/i18n/messages/{en,fr,ar}.json` : le CRM est en
  français en dur, hors de l'arbre `[locale]`.
- **R-6** — **Confirmé (2026-08-20) — couleur marque CRM :** `#30a735` est la valeur verte
  **canonique** du CRM, définie indépendamment du `hsl(142, 60%, 38%)` (≈ `#278a3f`) du thème
  du site principal — cet écart entre les deux verts est connu et **assumé**, pas une erreur à
  corriger. `tailwind.config.ts` `theme.extend.colors` du site principal reste **intouché** :
  aucune de ses clés (`primary`, `gold`, `platinum`, `safelist`) n'est modifiée, et le vert
  marque du site principal n'est **pas** aligné sur `#30a735` dans ce build. Les tokens CRM
  vivent dans une configuration Tailwind **propre au module** — soit un second fichier
  (`tailwind.crm.config.ts` généré vers une feuille scopée `[data-crm]`), soit des variables
  CSS scopées au layout CRM (`[data-crm] { --crm-green: #30a735; --crm-black: #0D0D0D; }`).
  Peu importe le mécanisme retenu au Prompt 1 : la valeur `#30a735` est fixée par cette règle,
  pas à réinventer ni à faire converger vers `#278a3f`.
- **R-7** — **Confirmé (2026-08-20) :** Space Grotesk est instancié **par le CRM lui-même**,
  via son propre appel `Space_Grotesk({ subsets: ['latin'], variable: '--font-grotesk-crm', … })`
  (`next/font/google`) dans `src/app/metworkcrm/layout.tsx`. Nom de variable CSS délibérément
  différent de `--font-grotesk` (qui reste la variable du badge de nav plateforme, définie dans
  `[locale]/layout.tsx`) pour qu'aucune collision de nom de variable ne soit possible si les deux
  arbres finissaient un jour partagés dans le même document. Le CRM ne dépend d'aucune manière du
  chargement de police de `[locale]/layout.tsx`, qu'il ne traverse jamais.
- **R-8** — Le CRM n'envoie **jamais** d'email/SMS/WhatsApp à un utilisateur final de la
  plateforme. Les notifications v1 sont in-app uniquement.
- **R-9** — Les DTO renvoyés par `platform-refs.ts` sont **minimaux**. Ne jamais laisser
  fuir vers un composant client : `passwordHash`, `pinHash`, `payoutAccount`,
  `MentorRecord.phone` / `cvUrl` / `defaultMeetingAddress`, `SessionRecord.idHash`,
  ni un `UserRecord` brut.

### 2.2 Qualité

- **R-10** — `npm run type-check` doit rester à **0 erreur**. C'est la baseline mesurée à
  l'audit et le seul filet : `next build` a `typescript.ignoreBuildErrors: true`.
- **R-11** — `npm run lint` sur `src` ne doit pas régresser.
- **R-12** — Les tests Vitest CRM utilisent une base **isolée par exécution** (fichier
  temporaire ou `:memory:`). Ne pas casser `singleFork: true`, qui existe parce que les
  tests plateforme partagent un état en mémoire.
- **R-13** — Argent : `INTEGER` DZD partout, jamais de flottant. Aligné sur toute la plateforme.
- **R-14** — Dates : ISO 8601 UTC pour les horodatages, `YYYY-MM-DD` pour les dates seules.
- **R-15** — Aucun secret, aucun **hash**, aucun mot de passe de production en dur dans le
  dépôt. Le seed calcule le hash à l'exécution via `hashPassword()`.

  **Amendé (2026-08-20, décision du propriétaire — remplace la version précédente de cette
  règle) :** le mot de passe initial du compte Admin est **`123456`, en dur** comme valeur par
  défaut dans `scripts/metworkcrm/seed.ts`. `METWORKCRM_SEED_PASSWORD` reste accepté et prend
  le dessus quand la variable est définie, mais son absence ne fait **plus** échouer le script.

  Ce qui rend ce compromis acceptable, et qui ne doit jamais être retiré sans réévaluer la
  règle : `must_change_password = 1` est posé au seed, la garde `requireCrmUser()` redirige
  vers `/metworkcrm/change-password` tant que le drapeau est levé, et `/metworkcrm/login` est
  rate-limité par e-mail ET par IP (R-18). Le credential semé ne peut donc pas survivre à la
  première connexion. **Avant tout déploiement en production, définir
  `METWORKCRM_SEED_PASSWORD`** — le défaut en dur est un confort de développement, pas une
  valeur destinée à un environnement exposé.

### 2.3 Sécurité

- **R-16** — Réutiliser `hashPassword` / `verifyPassword` (`@/server/auth/password.ts`).
  Ne pas réimplémenter scrypt. *(Limite connue et documentée dans ce fichier : `N` reste au
  défaut Node 16384, en dessous de la recommandation OWASP — voir le commentaire MED-08 dans
  la source. Le CRM hérite de cette limite ; ne pas la changer unilatéralement, cela casserait
  la vérification de tous les mots de passe plateforme existants.)*
- **R-17** — Session CRM : stocker uniquement le **SHA-256** de l'id ; le clair ne vit que
  dans le cookie HttpOnly + SameSite=Strict + Secure en production.
- **R-18** — Rate limit obligatoire sur `/metworkcrm/login` via `checkRateLimitDistributed`
  (`@/lib/rate-limit`), par email **et** par IP.
- **R-19** — Les gardes de rôle s'appliquent **à la route ET à l'API**. Une garde d'UI seule
  est considérée comme absente. `TEAM_MEMBER` doit se voir refuser `/api/metworkcrm/payments/**`
  au niveau du handler, pas seulement du lien de navigation. **Confirmé (2026-08-20) — étendu
  aux montants :** au-delà du module Paiements lui-même, aucune figure monétaire (`amount`,
  `value_amount`, CA agrégé, valeur de pipeline) ne doit atteindre `TEAM_MEMBER` **où que ce
  soit** dans le CRM — Dashboard et Rapports (Prompt 6) inclus. Les compteurs par étape de
  pipeline et les métriques non monétaires restent visibles pour ce rôle. La garde doit vivre
  dans le **service de sérialisation partagé**, pas être répétée route par route : un widget
  Dashboard qui relit `crm_opportunities.amount` directement contournerait une garde posée
  uniquement sur `/metworkcrm/payments`. Voir `METWORK_OS_DATABASE_SCHEMA.md` §6 (`crm_payments`).
- **R-20** — `PRAGMA foreign_keys = ON` à chaque ouverture de connexion. Sans ça, toutes les
  clés étrangères du schéma sont décoratives.
- **R-21** — Les migrations s'exécutent par commande CLI explicite, **jamais** au démarrage
  d'une route ni d'un handler.

### 2.4 Automatisations

- **R-22** — Toute automatisation s'exécute **après** le commit de l'écriture déclenchante,
  ses erreurs sont journalisées dans `crm_automation_runs` et **avalées**. Aucune
  automatisation ne participe à la transaction principale.
- **R-23** — Idempotence par `automation_key` unique. Un rejeu ne crée jamais de doublon.

### 2.5 Vocabulaire, données entrantes, documents (confirmé 2026-08-20)

- **R-24** — Le mot « client » est **banni** de toute copie UI et de tout identifiant de code
  CRM (composants, routes, variables, colonnes). Utiliser Contact / Organisation. `db.clients`
  (`ClientRecord[]`, store JSON) est le carnet clients **facturables des incubateurs
  partenaires** — sans rapport avec les Contacts CRM de Metwork, jamais lu ni référencé par le
  CRM. Voir `METWORK_OS_PRODUCT_SPEC.md` §3.1.
- **R-25** — Le CRM lit `contactSubmissions` **uniquement** pour peupler l'action « Créer un
  contact CRM » (copie explicite déclenchée par un humain, jamais une synchronisation
  automatique). Le CRM n'écrit **jamais** `ContactSubmissionRecord.handled` — ce marquage reste
  la responsabilité exclusive de `/dashboard/admin/contacts` côté plateforme. Une PR qui ajoute
  la moindre écriture sur ce champ depuis `/metworkcrm*` ou `/api/metworkcrm/*` viole R-1.
- **R-26** — Upload de documents CRM : route dédiée `POST /api/metworkcrm/upload` —
  **`/api/upload` n'est pas réutilisée** (session *cliente* plateforme via `requireApiSession`,
  images uniquement, 5 Mo max — incompatible avec les besoins CRM). Contrat de la nouvelle
  route : session `internal_users` uniquement ; types acceptés `application/pdf`,
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (.docx),
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (.xlsx),
  `application/vnd.openxmlformats-officedocument.presentationml.presentation` (.pptx),
  `image/png`, `image/jpeg` ; taille max **20 Mo** ; dossier Cloudinary
  `metwork/crm-documents` via `uploadBuffer` de `@/lib/cloudinary` (`resourceType: 'raw'` pour
  le non-image) ; rate limit par utilisateur CRM via `checkRateLimitDistributed`. Ne pas
  réutiliser `isSupportedDocumentMime` (PDF uniquement) — allowlist dédiée côté CRM. Voir
  `METWORK_OS_DATABASE_SCHEMA.md` §6 (`crm_documents`).
- **R-27** — `display_name_cache` (une colonne par table du §7.1 du schéma) est **non
  autoritaire** partout : rafraîchie à chaque lecture réussie via `platform-refs.ts`, jamais
  rendue à la place d'un nom plateforme résolu avec succès, jamais lue par une règle métier, un
  KPI ou un export. Sur `crm_organizations` / `crm_contacts` / `crm_partnerships` /
  `crm_programs` / `crm_program_participants` / `crm_space_bookings`, la colonne locale
  (`name`/`full_name`/`title`/`space_label`) est NOT NULL et reste seule indexée pour la
  recherche ; seuls `crm_startups.display_name_cache` et `crm_experts.display_name_cache` sont
  indexés et interrogés par la recherche globale, parce que leur nom local peut être NULL sur
  une fiche liée. Voir `METWORK_OS_DATABASE_SCHEMA.md` §7.4.

### 2.6 Connexion base de données CRM (confirmé 2026-08-20 — voir schéma §12)

- **R-28** — Production : `drizzle-orm` + `@libsql/client` (Turso). Dev/test : `drizzle-orm` +
  `better-sqlite3`. **Un seul** schéma drizzle, **un seul** dossier de migrations ; le choix de
  driver est isolé dans **un seul** fichier (`src/server/metworkcrm/db/client.ts`), sélectionné
  par la variable d'environnement `METWORKCRM_DATABASE_URL` (`libsql://…` / `https://…` → Turso,
  `file:…` → SQLite local). Aucun code de requête applicatif ne teste l'environnement.
- **R-29** — `PRAGMA foreign_keys = ON` et `PRAGMA journal_mode = WAL` sont posés dans ce même
  fichier de connexion pour le driver fichier ; le comportement `foreign_keys` du client libSQL
  contre Turso doit être vérifié explicitement au Prompt 1 plutôt que supposé.
- **R-30** — `better-sqlite3` est un module natif : s'il doit un jour tourner à l'intérieur
  d'une route Next.js (et non plus seulement dans des scripts CLI/tests), il rejoint
  `experimental.serverComponentsExternalPackages` dans `next.config.mjs` (C-3 — modification
  additive d'une ligne, hors périmètre au même titre que R-4, à signaler explicitement dans le
  SESSION_LOG du prompt qui l'introduit). En production (Turso, client HTTP pur), cette
  contrainte ne s'applique pas.

---

## 3. Affectation des modèles

| # | Prompt | Modèle | Branche | Dépend de | Parallélisable |
|---|---|---|---|---|---|
| 0 | Audit & documents de référence | **Opus** | `crm/00-audit-docs` | — | Non — doit passer en premier |
| 1 | Fondation : auth, rôles, schéma complet | **Opus** | `crm/01-foundation` | 0 | Non |
| 2 | Noyau CRM : orgs, contacts, interactions, tâches, recherche | **Sonnet** | `crm/02-core` | 1 | Non |
| 3 | Sales, Startups, Experts, Partenariats | **Opus** | `crm/03-ecosystem` | 1, 2 | Non |
| 4 | Open Innovation + Programmes | **Sonnet** | `crm/04-oi-programs` | 1, 2 | Oui, avec 5 |
| 5 | Espaces & suivi paiements + Documents | **Sonnet** | `crm/05-payments-docs` | 1, 2 | Oui, avec 4 |
| 6 | Dashboard & Reporting / KPI | **Sonnet** | `crm/06-dashboard` | 2, 3, 4, 5 | Non |
| 7 | Notifications & Automatisations | **Sonnet** | `crm/07-automations` | 2, 3, 4, 5, 6 | Non |
| 8 | QA, sécurité, mise en production | **Opus** | `crm/08-hardening` | tous | Non |

**Pourquoi Opus sur 0, 1, 3 et 8 :** ce sont les quatre prompts qui touchent à des décisions
irréversibles — la classification des entités (0), le schéma en une passe et l'isolation
d'authentification (1), le seul endroit du build qui lit des données de production vivantes (3),
et la vérification finale de non-régression (8).

⚠️ « Parallélisable » signifie « ne touche pas les mêmes tables », **pas** « sans risque en
simultané » : 4 et 5 partagent le code de liaison des Documents. Les exécuter à la suite,
pas en même temps, sauf à assumer la résolution du merge.

---

## 4. Choix de l'outillage SQLite — DÉCISION D-2 CONFIRMÉE (2026-08-20)

### 4.1 Réponse courte

**ORM : `drizzle-orm` — confirmé.**
**Driver : `@libsql/client` (Turso) en production, `better-sqlite3` en dev/test — confirmé.**
`better-sqlite3` seul ne peut **pas** être la base de production dans le déploiement actuel ; il
reste le driver de dev/CI. Cette section documente le *pourquoi* ; l'implémentation concrète
(module de connexion, variables d'environnement, ce qui diffère entre les deux drivers) est dans
`METWORK_OS_DATABASE_SCHEMA.md` §12 — c'est la version normative pour le Prompt 1.

### 4.2 Le blocage (à trancher avant le PROMPT 1)

Le dépôt déploie sur **Vercel** (`.vercel/project.json`, `vercel.json` avec région `cdg1`
et 8 crons, `deploy.sh` → push GitHub → déploiement automatique Vercel). Vercel exécute des
**fonctions serverless** :

1. le système de fichiers du déploiement est **en lecture seule** ; seul `/tmp` est inscriptible ;
2. `/tmp` est **par instance** et **éphémère** — deux requêtes concurrentes peuvent tomber sur
   deux instances, donc deux fichiers `.db` différents ;
3. tout est effacé à chaque redéploiement.

⇒ Un fichier SQLite écrit par `better-sqlite3` sur Vercel **perd les données** et **diverge
entre instances**. Ce n'est pas une question de réglage : c'est structurel.

### 4.3 Recommandation

**drizzle-orm (dialecte SQLite) + deux drivers, un seul schéma :**

| Environnement | Driver | Base |
|---|---|---|
| Production (Vercel) | `@libsql/client` | **Turso** (libSQL — SQLite sur HTTP), ou un `sqld` auto-hébergé |
| Dev local | `better-sqlite3` | `.crm-local.db` (gitignoré) |
| Vitest / Playwright | `better-sqlite3` | fichier temporaire ou `:memory:` par exécution |

Pourquoi ça tient :

- **Le SQL reste du SQLite.** libSQL est un fork de SQLite : le schéma de
  `METWORK_OS_DATABASE_SCHEMA.md` s'applique tel quel — `CHECK`, colonnes générées, index
  partiels, FTS5. Aucune réécriture, la décision « SQLite » du cahier est respectée.
- **Un seul fichier de schéma, un seul jeu de migrations** (`drizzle-kit`, `dialect: 'turso'`).
- **Sauvegarde en un fichier** conservée (`turso db dump` / `.dump` libSQL) — c'est ce qui
  motivait SQLite au départ.
- **Dev sans réseau ni compte tiers** grâce à `better-sqlite3`.
- Versions disponibles à l'audit : `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`,
  `@libsql/client@0.17.4`, `better-sqlite3@13.0.3` — toutes compatibles Node ≥ 20
  (`package.json` exige `>=20`, la machine de dev est en Node 24.15.0).

Deux points d'intégration Next.js à ne pas oublier au Prompt 1 :

- si `better-sqlite3` est chargé depuis une route Next.js (et pas seulement des scripts
  CLI/tests — cas envisageable pour le dev local), l'ajouter à
  `experimental.serverComponentsExternalPackages` dans `next.config.mjs` (module natif — même
  raison que `pdfkit`, déjà présent). C'est une modification hors périmètre : elle doit être
  signalée comme telle et rester additive (R-30, C-3). En production, le client Turso est du
  HTTP pur et cette contrainte ne s'applique pas ;
- toutes les routes CRM en `runtime = 'nodejs'` (jamais Edge) — `@libsql/client` comme
  `better-sqlite3` en dépendent.

### 4.4 Alternatives évaluées

| Option | Verdict | Raison |
|---|---|---|
| `better-sqlite3` seul, sur Vercel | ❌ | Perte de données garantie (§4.2) |
| **drizzle + libSQL/Turso (prod) + better-sqlite3 (dev/test)** | ✅ **recommandé** | Reste du SQLite, déployable, sauvegarde mono-fichier, dev hors ligne |
| drizzle + Postgres sur le Supabase existant | ⚠️ repli | Zéro nouveau fournisseur, infra déjà payée, plus solide en concurrence — mais ce n'est plus SQLite, et on perd la sauvegarde mono-fichier. À retenir si l'ajout d'un fournisseur est refusé |
| Auto-hébergement Docker (le `Dockerfile` existe) + volume persistant | ❌ | Vrai SQLite fichier, mais impose de migrer **toute** la plateforme hors de Vercel. Hors sujet |
| Prisma | ❌ | `package.json` porte encore des scripts `prisma:*` mais il n'y a **ni dossier `prisma/`, ni dépendance `prisma` installée** : ce sont des scripts morts. Ne pas les réanimer |

### 4.5 Décision confirmée

**Turso (drizzle-orm + `@libsql/client` en production, `better-sqlite3` en dev/test).**
Le repli Postgres/Supabase (§4.4) reste documenté comme alternative écartée, pas comme option
ouverte : à ne reconsidérer que si un blocage opérationnel imprévu apparaît sur Turso au
Prompt 1 (compte, quotas, latence de la région). Le Prompt 1 implémente l'abstraction de
connexion telle que spécifiée dans `METWORK_OS_DATABASE_SCHEMA.md` §12 — le reste du schéma est
indépendant de ce choix ; seuls le driver et le fichier de connexion changent (R-28, R-29, R-30).

---

## 5. Sauvegarde & restauration (à implémenter au Prompt 8)

- Dump complet en un fichier, planifié, **hors** du dépôt.
- Précédent réutilisable côté plateforme : `scripts/backup-app-state.ts` (sauvegarde du
  document JSON). Le CRM aura son équivalent.
- La procédure de restauration doit être **écrite et testée au moins une fois**, pas seulement
  documentée.
- La sauvegarde CRM et celle du store JSON sont indépendantes : ne jamais restaurer l'une en
  supposant l'état de l'autre — les références `platform_*_id` peuvent devenir pendantes,
  ce qui est un cas d'affichage prévu (§7.4 du schéma), pas une corruption.

---

## 6. Livrables obligatoires de chaque prompt

1. Plan numéroté avec note de risque **par fichier**, puis **arrêt** pour approbation.
2. Après approbation : le code.
3. Entrée `SESSION_LOG.md` — quoi, pourquoi, fichiers touchés.
4. Checklist de test manuel.
5. Nom de branche git utilisé.
6. **Ajout de l'audit :** liste explicite des fichiers modifiés **hors** `/metworkcrm`.
   Attendu : vide, sauf `src/middleware.ts` (Prompt 1, R-4) et `next.config.mjs` (Prompt 1,
   uniquement si `better-sqlite3` doit tourner dans une route — R-30). Toute autre ligne est un
   signal d'alarme à instruire avant de merger.

---

## 7. Historique des révisions

| Date | Changement |
|---|---|
| 2026-08-19 | Version initiale (Prompt 0, audit) |
| 2026-08-20 | Toutes les décisions bloquantes confirmées : D-2 (Turso/libSQL prod + better-sqlite3 dev, §4 + schéma §12), D-6 (`display_name_cache`, R-27), R-4 détaillé (early-return middleware), R-6 confirmé (`#30a735` canonique, écart avec `#278a3f` assumé), R-7 confirmé (Space Grotesk instancié par le CRM, `--font-grotesk-crm`), R-15/R-19 étendus (seed via `METWORKCRM_SEED_PASSWORD`, montants masqués pour `TEAM_MEMBER` partout), nouvelles règles R-24 → R-30 (mot « client » banni, `contactSubmissions` jamais écrit, endpoint d'upload dédié, connexion Turso/SQLite). **Le PROMPT 1 peut démarrer sans ambiguïté bloquante.**
