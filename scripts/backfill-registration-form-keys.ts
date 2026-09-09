/**
 * Backfill `labelKey` / `optionKeys` onto registration form fields that were
 * seeded from the default application set BEFORE those keys were persisted.
 *
 * WHY THIS EXISTS
 * `buildDefaultApplicationFields` used to resolve the `defaultQuestions` i18n
 * keys once, at program-creation time, in whatever locale the host happened to
 * be authoring in — and write only the resulting TEXT. The questions were then
 * frozen: an Arabic visitor read English questions on an otherwise-Arabic page,
 * and editing the message files changed nothing, because the English was
 * already in the database. New programs now store the key alongside the text.
 * This repairs the ones created before that.
 *
 * HOW IT MATCHES
 * A stored field is recognised as a seeded question only when its label is an
 * EXACT match for that question's rendering in one of the three locales (and,
 * for a choice field, its options match that locale's options exactly, in
 * order). Anything a host typed themselves, or edited, fails to match and is
 * left completely alone — their words must never be replaced by the template's.
 *
 * SAFETY
 *   • Dry run by default. Pass `--confirm` to write.
 *   • Idempotent: a field that already has a `labelKey` is skipped.
 *   • Only ever ADDS the two key fields; no label, option, type, order or
 *     answer is ever touched, so a re-run cannot corrupt anything.
 *
 *   npx tsx scripts/backfill-registration-form-keys.ts              # dry run
 *   npx tsx scripts/backfill-registration-form-keys.ts --confirm    # write
 *   USE_LOCAL_DB=true npx tsx scripts/backfill-registration-form-keys.ts
 */

// Set env BEFORE any imports so env.ts validation passes.
(process.env as Record<string, string | undefined>).NODE_ENV ??= 'development';
process.env.SUPABASE_URL ??= 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-not-used-in-local-mode';
process.env.AUTH_SECRET ??= 'local-dev-secret-at-least-32-characters-long-padding-here';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_API_URL ??= 'http://localhost:3000/api';
process.env.API_INTERNAL_URL ??= 'http://localhost:3000/api';

import { db } from '../src/server/db/store';
import { DEFAULT_APPLICATION_QUESTIONS } from '../src/server/programs/default-application-questions';
import en from '../src/i18n/messages/en.json';
import fr from '../src/i18n/messages/fr.json';
import ar from '../src/i18n/messages/ar.json';

const LOCALES = { en, fr, ar } as const;
type LocaleCode = keyof typeof LOCALES;

function messages(locale: LocaleCode): Record<string, string> {
  return (LOCALES[locale] as { defaultQuestions?: Record<string, string> }).defaultQuestions ?? {};
}

/** Normalise for comparison — hosts' copies differ only in stray whitespace. */
function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

interface Match {
  labelKey: string;
  optionKeys: string[] | null;
  locale: LocaleCode;
}

/**
 * Which seeded question, if any, this stored field is — matched against every
 * locale's rendering, because the host could have authored in any of them.
 */
export function matchSeededQuestion(field: {
  label: string;
  type: string;
  options?: string[] | null;
}): Match | null {
  for (const q of DEFAULT_APPLICATION_QUESTIONS) {
    if (q.type !== field.type) continue;
    for (const locale of Object.keys(LOCALES) as LocaleCode[]) {
      const m = messages(locale);
      const expectedLabel = m[q.labelKey];
      if (!expectedLabel || norm(expectedLabel) !== norm(field.label)) continue;

      // A choice field must also match its options exactly, in order — a host
      // who added or reworded a choice keeps their version.
      if (q.optionKeys) {
        const expected = q.optionKeys.map((k) => m[k] ?? '');
        const actual = field.options ?? [];
        if (expected.length !== actual.length) continue;
        if (!expected.every((o, i) => norm(o) === norm(actual[i] ?? ''))) continue;
        return { labelKey: q.labelKey, optionKeys: q.optionKeys, locale };
      }
      if ((field.options ?? []).length > 0) continue;
      return { labelKey: q.labelKey, optionKeys: null, locale };
    }
  }
  return null;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  const data = await db.read();
  const fields = data.registrationFormFields ?? [];

  const planned: Array<{ id: string; label: string; match: Match }> = [];
  let alreadyKeyed = 0;
  let unmatched = 0;

  for (const f of fields) {
    if (f.labelKey) {
      alreadyKeyed++;
      continue;
    }
    const match = matchSeededQuestion(f);
    if (!match) {
      unmatched++;
      continue;
    }
    planned.push({ id: f.id, label: f.label, match });
  }

  console.log(`\nRegistration form fields: ${fields.length}`);
  console.log(`  already keyed : ${alreadyKeyed}`);
  console.log(`  host-written  : ${unmatched}  (left untouched)`);
  console.log(`  to backfill   : ${planned.length}\n`);

  for (const p of planned) {
    const opts = p.match.optionKeys ? ` +${p.match.optionKeys.length} options` : '';
    console.log(`  [${p.match.locale}] ${p.match.labelKey}${opts}  ←  "${p.label}"`);
  }

  if (planned.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  if (!confirm) {
    console.log('\nDRY RUN — nothing written. Re-run with --confirm to apply.');
    return;
  }

  const byId = new Map(planned.map((p) => [p.id, p.match]));
  const written = await db.update((d) => {
    let n = 0;
    for (const f of d.registrationFormFields ?? []) {
      const match = byId.get(f.id);
      // Re-check inside the lock: another writer may have keyed it meanwhile.
      if (!match || f.labelKey) continue;
      f.labelKey = match.labelKey;
      f.optionKeys = match.optionKeys;
      f.updatedAt = new Date().toISOString();
      n++;
    }
    return n;
  });

  console.log(`\n✅ Backfilled ${written} field(s). Re-running is safe — keyed fields are skipped.`);
}

// Only run when invoked directly. `matchSeededQuestion` is imported by the
// unit tests, and importing a module must never touch the database.
if (process.argv[1]?.includes('backfill-registration-form-keys')) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
