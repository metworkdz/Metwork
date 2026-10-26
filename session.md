# Session record — 2026-09-13

The running session history lives in `SESSION_LOG.md`, which `.gitignore` keeps
local (`SESSION_*.md`). This file is the committed copy of this session, so the
reasoning travels with the code rather than staying on one machine.

## 2026-09-13 — Contract layout, portal screenshots, consultant welcome email

Four workstreams in one session. Nothing here changes how money moves.

### 1. The signature block signs as a legal person, at a readable size

The company stamp was drawn in the same 80pt box as the consultant's drawn
signature. Measured first rather than guessed: the real cachet is 632 × 455 px,
so pdfkit's `fit` binds on HEIGHT and it landed at 111 × 80 — small enough to
read as incidental beside a full-width signature. Its box is now 120pt, an exact
1.5× for that aspect, and 166pt still leaves ~55pt before the consultant's
column, so the two-column geometry needed no rebalancing. **For a wide image the
width would bind instead and the same change would do nothing — measure before
picking a number.**

Both marks now hang from the bottom of a band as tall as the larger, so the two
ruled lines stay level and each mark sits ON its line. `SIGNATURE_BLOCK_H` is
derived from the gaps the block is built from instead of being typed, so a later
change to either image box carries its own page-break reservation.

Two captions were wrong. The heading read "Pour METWORK" because the party
record is named `Metwork` — fine for a letterhead, wrong for a signature block,
so `metworkLegalName()` prepends the legal form when the stored name lacks one.
And the name under the line fell back to the COMPANY name when no gérant was
set, printing "Metwork" above the caption "Gérant"; it now falls back to the
manager, and `metworkManagerName` was set in Platform Settings.

Geometry is asserted by reading the placement matrices back out of the deflated
content stream (`src/__tests__/consultant-contracts/signature-block.test.ts`) —
the marks are images, so nothing about their size appears in the PDF's text and
any weaker test would pass either way.

**Honest note:** the reservation bump from 190 to 230 is precautionary. A sweep
of 100 body lengths could not produce a case where the old value actually
clipped or stranded anything.

### 2. Space-rental contracts come out of the same stationery

The coworking and salle-de-formation contracts were rendered by a second, older
generator: DejaVu at 11pt, no logo (the Metwork profile has no logo file),
headings set as ordinary prose, a "Powered by Metwork" footer. That layout now
has exactly ONE implementation — `src/server/pdf/contract-layout.ts` — which both
renderers import: wordmark top-right, 16pt underlined title, Times 12pt
justified, 14pt article headings, "Page N / T". Each document keeps only what it
alone owns (signature block, watermark and provenance stay consultant-only; the
title and contract-number line stay space-only).

**The generated letterhead block is gone.** Both real templates open by naming
the parties in prose — "EURL METWORK, … RC …, NIF …" — so drawing a second
identity block above that printed the same information twice. The
`{{incubator_*}}` tokens remain for anyone who wants the other arrangement. This
is the decision the consultant contract already made, for the same reason.

Heading detection had to widen, because the two templates number their sections
three different ways. `1. OBJET DU CONTRAT` is recognised when numbered AND
capitalised — capitalisation is what separates a heading from the first item of
a list — and `4.1 – Responsabilité du Locataire` is set bold at body size, a
subdivision rather than an article. Bullets are drawn in their own column with
the text hanging beside them: the templates write them as a bullet followed by a
TAB, which has no glyph in an embedded TrueType font. Test cases are quoted
VERBATIM from the production templates.

A third-party incubator's contract carries THEIR logo, not ours — putting the
Metwork wordmark on a contract binding someone else would misstate who is party
to it. The route decides, since it is the only place that knows.

Also `CONTRACT_ESIGNATURE_PLAYBOOK.md` (685 lines): the whole contract +
e-signature stack written up to be portable to another project, with each of the
four defects that cost real time and its fix.

### 3. Mobile screenshots of the consultant portal

Five JPEGs at iPhone 13 metrics for an explainer video, reproducible via a
Playwright project (`consultant-demo-shots`) plus a local-only demo-data script.

The account was created through the REAL signup form and the OTP read off the
dev-server console, which already prints it when Resend is unconfigured outside
production — so **no OTP bypass had to be written**. The money went through
`creditPendingEarning` → `releaseToAvailable` and `createWithdrawalRequest`, so
the 20% commission on screen is the split the real settlement path computes.

**The local store had MENTOR_CONSULTATION stale at 30%.** Production says 20%,
and so do the code default and the contract; the first render showed 14 000 net
instead of 16 000, which is how it surfaced. Local was aligned to production.

Two framing bugs worth remembering: the hero block lives INSIDE `<main>`, so
scrolling to `main` moved nothing and all five shots led with the same card; and
the scroll offset is measured from the sticky header rather than guessed, or the
previous field peeks out in a half-cut line beneath it.

### 4. Welcome email for newly approved consultants

One French email, sent when an admin approves a consultant, walking the whole arc
— profile, availability, rate, contract signature, booking link, first paid
client, payout — with the 8-step guide attached as a PDF.

Written from the LinkedIn carousel but **corrected against the product where the
two disagree**, because a welcome email that describes a different app is worse
than none. The carousel says you sign up with a phone number and a code by SMS:
sign-in is by EMAIL code, delivered by email and WhatsApp, and SMS to Algeria
does not deliver at all. It also promises "approuvez la demande en un clic":
there is no approval step — a paid booking confirms itself. A test asserts the
carousel's wording cannot creep back in. The carousel is silent on the contract
and the commission; both are in the email, since a consultant asks about both on
day one.

**A real bug found on the way in:** the approval decision email was dispatched as
a floating `void (async () => …)()` inside a service called from a route handler.
On Vercel the lambda freezes when the response returns, so that send was never
delivered. It is awaited now, and the route carries `maxDuration = 60` because it
now waits on a 4 MB fetch and a ~5.6 MB Resend upload. The static guard that
closed this bug class earlier only scans ROUTE files, which is why a service
slipped past it.

Once-only is enforced by `MentorRecord.welcomeEmailSentAt`, claimed inside the
SAME store update that flips the status so two admins hitting Approve together
cannot both send it — and cannot both attach 4 MB. A re-approval gets the short
localized note instead. A send that reports failure releases the claim, because
the stamp exists to prevent a duplicate, not to swallow a lost email.

The guide is a Cloudinary AUTHENTICATED raw asset fetched server-side — the only
delivery path verified against this account, since a public `.pdf` URL 401s while
PDF delivery is off — and guarded by the `%PDF-` magic number, because a failed
signed link answers 200 with an HTML body. Not bundled: 4.3 MB in every lambda,
and marketing can replace it without a deploy
(`scripts/upload-consultant-guide.ts`).

`scripts/send-consultant-welcome.ts` backfilled the 16 consultants approved
before this existed (dry-run by default, stamps on success, skips anyone already
stamped or without a record). The template gained an optional `greetingName`
because half the profiles are stored surname-first, which had the email opening
"Bienvenue, Khenchouche." — correct-looking and wrong.

### Final review — three defects found and fixed after the work was written

1. **A transient CDN failure was memoised for the life of the lambda.**
   `loadConsultantGuidePdf` cached `null`, so one blink on the first email of a
   warm instance silently dropped the attachment from every welcome it sent
   afterwards. Only successes are cached now; the fetch timeout was also cut
   from 15s to 8s so a hung CDN cannot be what times the request out.
2. **A consultant with no email on file was stamped as "welcomed".** The claim
   was taken before the `if (to)` guard, so they were marked done without a word
   being sent — and once they added an address, a re-approval would have given
   them the short note instead of the welcome they never got. The claim now
   requires an address.
3. **The approval route had no `maxDuration`** while now awaiting a 4 MB fetch
   plus a base64 upload, against the platform default.

Both logic fixes are mutation-tested: reverting each turns its test red.

### Verification
- `npx tsc --noEmit` → 0 errors. `npm run lint` → 0 errors (15 pre-existing
  warnings in `store.ts`). `npx vitest run` → **1173/1173, 108 files**.
- Contracts: both production templates rendered end-to-end (coworking 3 pages,
  salle de formation 2), and the consultant contract re-rendered before/after the
  shared-layout extraction at an unchanged 5 pages.
- Welcome email: 16 sent to real consultants, 0 failed, all 16 stamped and
  verified back out of production; one approval performed by the owner fired the
  email on its own (stamp 20:53:35.386Z, audit 20:53:36.163Z).
- **Flake, unresolved:** one full-suite run showed 1 failure out of 1173 and
  could not be reproduced in four subsequent runs. The failing test was not
  identified.

## 2026-10-23 → 2026-10-25 — Metwork 2.0 phases A–E, AI cost rules, marketing plan

Continues the Metwork 2.0 build (phases 0–8b: tax center, copilot, messaging,
hiring tab and orders, cofounder matching and agreement — all on main, Supabase
migration for the messaging/cofounder tables already applied in production).
This stretch: a second round of product work (A–E), approved phase by phase
after mockups, each with tsc + full test suite + browser check (phone width,
fr/ar) + a security pass. All pushed to main; **the production deploy is done by
the owner** (`vercel --prod`), not from here.

Design mockups for A–E live in the private design artifact
https://claude.ai/artifact/YFcSzNgcAVNe6LqBqEGMkP (boards: freelancer home,
copilot, more, founder home, contract + push, guides home, chooser, steps).

### Phase A — premium mobile shell (`fdeb230`)
- Freelancer and founder dashboards get a floating bottom nav: Accueil · second
  tab (Commandes for freelancers, Recrutement for founders) · **Copilote as a
  raised green circle** · Messages · Plus. Config: `premiumNavByRole` /
  `getPremiumNav` in `src/config/mobile-nav.ts`; other roles keep the classic bar.
- "Plus" opens « Tous vos outils », grouped Argent / Travail / Conformité /
  Compte; any nav item not placed in a group lands in the last one.
- New homes built from `src/components/dashboard/premium/premium-cards.tsx`
  (deep-green hero `#0E3B1E` like the wallet card, row cards, stat tiles, order
  progress cards).
- Fix: the consultations table's sr-only button labels escaped the scroll box and
  widened the page on phones (`relative` on the scroller).

### Phase B — for-freelancers header (`0a23969`)
`pages.freelancers.heroTitleHighlight` no longer mentions G12: « enfin simple et
en règle » (fr/en/ar).

### Phase C — copilot as a chat + web fallback (`e05c1f5`)
- Disclaimer removed; ChatGPT-style UI (`copilot-chat.tsx`): header with quota
  badge and new chat, empty state with suggestions, streaming with cursor, copy
  button, composer pinned above the nav.
- When the documents don't cover a question, the answer call writes only the
  sentinel `NOT_IN_DOCUMENTS` (held back from the stream by `sentinelGate`); then
  **Claude Haiku 4.5 with `web_search_20250305` (max 3 searches)** answers.
  Web sources are http(s)-only (`safeUrl`), shown as blue « Web · domain » chips;
  narration before the last search is dropped; `pause_turn` resumed once.
- Landmine: `user_location` with country **DZ is rejected (400)** by web search.

### Phase C2 — business-creation guides (`60246ee`)
- `src/lib/creation-guides.ts` is the single source: guides SARL, EURL,
  personne physique (PP), auto-entrepreneur (AE); steps, official links,
  G08 download (`public/forms/g08.pdf`), chooser `recommend()`:
  partners → SARL; alone + capital > 2 M DA → EURL; alone + service → AE;
  alone + products/e-commerce → PP. Text in `guides.*` (fr/en/ar).
- Owner-confirmed facts: PP pays the 4 000 DA CNRC fee and needs a cachet (not
  "tampon"); AE pays CASNOS forfaitaire **24 000 DA/an**; PP = société steps
  without statuts and without NIS.
- Progress per user in `d.guideProgress` (`/api/copilot/guide`, deleted with the
  account); the copilot is told the user's step.
- The guide text is also a copilot source (`server/copilot/guide-kb.ts`): legal
  passages first, then at most 2 guide passages; SARL and EURL are ONE passage
  so a SARL user is never cited "EURL".

### Phase D — web push (`c978add`)
- `web-push` + VAPID keys. `src/server/notifications/push.ts` is THE sender;
  `createNotification` pushes every in-app notification. Owners: USER or MENTOR
  (consultants, portal auth). Endpoints allow-listed to browser push services
  (no SSRF), click targets same-origin paths only, 404/410 devices deleted,
  5 failures dropped, max 10 devices per owner.
- New notices: payment link paid (not order links — orders notify themselves),
  withdrawal approved/rejected, consultant new booking + reminders, member
  consultation reminder.
- UI: settings switch (all member settings pages + consultant portal profile),
  home prompt (14-day quiet after "Plus tard"); unsubscribe on logout.
  iPhone needs the home-screen install first.
- Env: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT=mailto:contact@metwork.dz` — set on Vercel **Production** only
  (not Preview) and in `.env.local`. **Never regenerate the keys**: every
  subscribed phone would have to opt in again.

### Phase E — freelancer contract with Metwork (`71e7681`)
- Text: the consultant contract with consultant → freelancer, Articles 1–2 about
  orders and payment links, Article 3 quoting **both plans** (missions 10 % free
  / 7 % Premium; payment links 3 % / 0 %), CIN and **auto-entrepreneur card
  number** in the party block. Default in `src/lib/freelancer-contract-text.ts`;
  admin-editable (Settings, `platformSettings.freelancerContractTemplate`).
  PDF title: « CONTRAT DE PARTENARIAT / ENTRE METWORK ET LE FREELANCER ».
- `src/server/freelancer-contracts/service.ts`: offered automatically at 100 %
  profile (notification + push), signed with CIN (typed at signing) + drawn
  signature + WhatsApp code; frozen text, hashed private PDF. Withdrawals are
  refused (`FREELANCER_NOT_ELIGIBLE`, inside the withdrawal lock) until profile
  100 % AND contract signed — applies immediately to existing freelancers.
- Landmine: Next renders layout and page **in parallel**; the contract page
  makes the offer itself before reading, or it shows "locked" at 100 %.
- `.claude/launch.json` `metwork-localdb` now sets `SMS_PROVIDER=mock`: local
  OTP codes print in the dev log instead of going through Infobip.

### AI cost rules (`9e0c12d`, `5c8b74b`) — owner decision
**Never use Opus.** Copilot: Haiku 4.5 plans queries and answers from the web,
Sonnet 5.5 at **low effort** writes the cited answer. Hiring matcher and
cofounder matching: Sonnet 5.5 low effort. Server-side fallback removed
everywhere (it could reroute to Opus). `src/__tests__/no-opus-models.test.ts`
fails if any server/app code names an Opus model. Legal document review stays on
Sonnet 5.5 default effort; mentor matching on Haiku 4.5.

### Marketing plan
`docs/Metwork-Marketing-Plan.pdf` (11 pages, Metwork design system: logo green
`#00A550`, deep green, mint, Montserrat, white logo on the cover), regenerated by
`docs/marketing-plan-pdf.py`. Strategy: **freelancers first** (value on day one,
every link/invoice shows Metwork to a client), founders from month 3 through
their clients, the creation guides and incubator cohorts; conversion from
in-product moments (fees saved, quotas, commission 10→7 %). Phases 0–4 over
12 months; target ~600 paying ≈ 1.4 M DA MRR. Offers in the plan that are NOT
built yet: « Les 500 fondateurs » (badge + 2 Premium months), referral Premium
months, client banner on payment pages, fee-savings calculator, upgrade prompts,
public guide articles.

### Verification
`tsc` 0 errors · lint 0 errors (17 pre-existing warnings) · vitest
**2166 / 2166, 172 files**. Live checks: copilot documents path (IFU, cited
art. 282 sexies, 9 s on Haiku+Sonnet) and web path (BNA account); a freelancer
contract signed end to end locally (test freelancer at 100 %, test CIN).

### Still open
- Production deploy of A–E by the owner; then test push on a real phone
  (iPhone: home screen first), the copilot web path, and the contract offer.
- Not built: freelancer "project due" reminders; consultants' program/space
  booking pushes; the marketing offers listed above.
- Earlier carry-overs: `kb:sync --upload` in prod, membership repricing
  `--confirm`, accountant and lawyer reviews of the tax texts and contracts.

## 2026-10-26 — Startup Academy: plan, decisions, phase 0

Plan + mockups (private artifact, rev 2): https://claude.ai/artifact/1aRxaVHPcSCCVhU8ymmSuq
(source `docs/startup-academy-blueprint.html`). Owner decisions: VdoCipher; Pass
3 500 DA/month, yearly −20 %, admin-editable; course price set by the author,
≥ 2 900 DA; mentors 30 % / Metwork 70 % by default, per-mentor override; Pass split
per subscriber by watch time; 7-day refund under 25 % watched; admin review before
publishing; −20 % for Founder and Freelancer Premium only (incubators hand out 20 %
Founder promo codes instead); admin-uploaded stamp on certificates; buyers keep
access if a mentor leaves; Module 1 mentor = Yacine Kheddaoui, courses grow module by
module. Academy has its own light/dark switch (default = device) and translated
course/module/lesson titles.

### Phase 0 (branch `feat/academy-phase0`, uncommitted at report)
- `src/lib/academy.ts`: prices, shares, watch-time caps (35 s per heartbeat, 2× lesson
  length per day). `src/lib/localized-text.ts`: fr/en/ar titles with source language
  and reviewed/drafted state.
- Store: `academySettings`, `academyFields`, `academyCourses`, `academyEnrollments`,
  `MentorRecord.academyShareRate`. Enrollments stay in JSONB (granted in the same
  update as the payment). `server/academy/settings.ts` (validated, audited).
- Postgres `supabase/migrations/20261026000000_academy_foundation.sql` (**apply before
  deploying the Academy**): `academy_progress`, `academy_watch_ledger`, atomic
  `academy_add_watch` and `academy_watch_totals`; RLS on, no policies. Repo
  `server/academy/repo.ts` (memory / file / Supabase), erased on account deletion.
- Video: `server/academy/video/` (VdoCipher adapter + mock; production refuses the
  mock). Env `ACADEMY_VIDEO_PROVIDER`, `VDOCIPHER_API_SECRET`. VdoCipher webhooks are
  unsigned → re-read the video by id, never trust the body. Watermark
  `server/academy/watermark.ts` (HMAC account code, masked phone).
- Routes: `/academy` moved out of `(public)` into `app/[locale]/academy`. Flag
  `isAcademyEnabled()` OFF in production → the unchanged coming-soon page;
  `NEXT_PUBLIC_ACADEMY_PREVIEW=true` (launch config `metwork-academy`, port 3998)
  shows the new landing. Theme scoped to the Academy wrapper (`.dark` on the div,
  inline bootstrap script, `metwork-academy-theme` in localStorage). Known gap:
  Radix portals render outside the wrapper, so menus stay light in dark mode.
- Landing CTAs link to `/academy/pass` and `/academy/courses`, built in phases 1–2.
- Verification: tsc 0, lint 0 errors (17 old warnings), vitest 2204/2204 (25 new),
  browser fr/ar, light/dark/auto, 375 px, flag off = coming-soon page.

### Phase 1 — catalogue and admin authoring (`feat/academy-phase0`, uncommitted at report)
Phase 0 committed as `310a3f7` after owner approval.
- `server/academy/catalog.ts` is THE catalogue: `createCourse` / `saveCourseDraft`
  (whole builder state; each lesson's video fields are carried over from the
  stored lesson with the same id, unknown ids get fresh ids, so a request can never
  point a lesson at a video) / `setCourseStatus` (publish re-checks
  `publishProblems`; archive keeps buyers) / `deleteCourse` (refused once bought).
  Public reads return DTOs with titles resolved to the reader's language and NO
  video ids (tested). Mentor Academy page only while approved + ≥1 published course.
- Videos: `server/academy/videos.ts` (direct upload ticket → host; refresh re-reads
  status and length; a newer upload wins a race). Webhook `/api/webhooks/vdocipher`
  needs `?token=VDOCIPHER_WEBHOOK_TOKEN` in production and only re-reads by id.
  Mock host is stateless (dev route bundles each have their own module copy).
- Translation drafts: `server/academy/translate.ts`, Claude Haiku 4.5 + JSON schema
  (no `effort`: Haiku 4.5 rejects it), fills only empty languages, marks them
  `drafted`, re-reads inside the update; 30 runs/hour/admin.
- Admin: `/dashboard/admin/academy` (list + new course), `/courses/[id]` (builder:
  fr/en/ar editing tabs, programme with up/down ordering, per-lesson upload with
  progress and processing poll, "coming soon" modules, free preview, publish
  checklist), `/settings` (Pass price, annual and Premium discounts, default share,
  Cloudinary stamp, per-mentor share). Authoring works while the public flag is off.
- Public: `/academy/courses` (GET-form filters: field chips, search across all
  languages with accents folded, level, video language, sort, in-Pass), course page
  (Course JSON-LD, Premium price, Pass box, programme, mentors), `/academy/mentors/[slug]`;
  landing shows 4 courses once published. All 404 while the flag is off.
- Covers and the stamp must be Cloudinary URLs: the CSP `img-src` and the PDF image
  fetcher only allow Cloudinary.
- `scripts/academy-seed-module1.ts` (dry run; `--confirm`): DRAFT course for Module 1,
  mentor Yacine Kheddaoui found by name, 7 lessons, intro = free preview, en/ar drafted.
  Verified locally end to end (seed → upload ×7 → publish → public pages), then
  `.local-db.json` restored.
- Not built yet (phase 2+): checkout / buying, the player and playback tokens, the
  Pass page (the landing and course CTAs point to `/academy/pass` and
  `/academy/checkout`, which 404 in preview until then), trailer upload.
- Verification: tsc 0, lint 0 errors (17 old warnings), vitest 2220/2220 (16 new),
  browser fr/en/ar, 375 px, no horizontal overflow.
