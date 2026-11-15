# Registration form questions in each visitor's language

Seeded questions already localized through `labelKey`. A question a host **typed**
was shown in the host's language to everyone. Each host-written question can now
carry translations, and the public form shows the visitor's own language.

## What the visitor sees
The visitor's language is the site language, which the middleware negotiates from
the browser's `Accept-Language` on a first visit (then the language switcher /
`NEXT_LOCALE` cookie). A question shows its translation for that language, else
the host's own wording — a missing translation is never an empty question.

## What is recorded (important)
Translations are for **display only**. Answers are recorded as the host's own
option: a visitor who picks "Oui" (fr) or "نعم" (ar) is stored as "Yes". So the
answer summary, "ask only if" rules, the table and the CSV never split by the
language someone browsed in. (Seeded questions keep their older behaviour — the
text shown is recorded — and the summary already folds those across languages.)

## Data (additive, optional — no migration)
On a registration form field: `sourceLocale` (the language `label`/`options` are
written in), `translations` (`{ en|fr|ar: { label?, options? } }`) and
`draftedLocales` (languages that are unreviewed machine drafts).
- A language's `options` are kept only if they line up **one-for-one** with the
  source options; otherwise just those choices are dropped (never a wrong match).
- Empty languages are removed; text is trimmed and bounded to 200 characters.
- Rules live in `src/lib/registration-translations.ts` (shared by the builder, the
  form and the save routes); display in `src/lib/registration-question.ts`.

## Builder
- **Questions are written in** — one choice for the form.
- Under each question, **Translations**: wording + choices (one per line, same
  order as the options) per language; paste a list to fill many at once.
- **Translate with AI** drafts every *missing* language of every host-written
  question (`POST /api/{incubator,consultant}/registration-form/translate`,
  Claude Haiku 4.5 like the Academy translator; rate limited to 10/hour; the
  question text is treated as data, never as instructions). It **stores nothing**:
  drafts appear marked *"AI draft — check it"* and are saved only when the host
  presses Save. A person's own wording is never overwritten. Needs
  `ANTHROPIC_API_KEY`; without it the button says so and translations can be typed
  by hand.
- Editing the host's own wording drops that question's machine drafts (they
  described the old wording); translations a person wrote or checked are kept.
- Switching the source language drops any translation *into* the new source, so it
  cannot shadow the host's own words.

## Owner surfaces
The registrations table, CSV export, answer summary and desk dialog show the
host's own wording and options — one language for the people reading results.

## Innovation Bridge Algeria
`scripts/forms/innovation-bridge-algeria.ts` carries French and Arabic for all 20
questions (wilaya names from `src/config/cities.ts`). The French/Arabic wording is
saved flagged as drafts until someone who reads both marks them as checked.
