/**
 * One real call to the form-translation model — to confirm, BEFORE a host
 * clicks "Translate with AI", that the deployed key and model work.
 *
 *   vercel env pull .env.local          # brings ANTHROPIC_API_KEY down
 *   npx tsx scripts/translate-smoke.ts
 *
 * or:  ANTHROPIC_API_KEY=sk-ant-… npx tsx scripts/translate-smoke.ts
 *
 * It translates three short sample questions (English → French and Arabic),
 * prints them, and checks the shape the builder relies on: a label per language
 * and a choice list the same length as the source. It writes nothing anywhere and
 * costs a fraction of a cent (Claude Haiku). The key is never printed.
 */
import fs from 'node:fs';
import path from 'node:path';

// The app's env module insists on a few server variables even for a script that
// never touches them; local-mode placeholders satisfy it. Nothing here connects.
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV ??= 'development';
env.USE_LOCAL_DB = 'true';
env.SUPABASE_URL ??= 'https://placeholder.supabase.co';
env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-not-used-in-local-mode';
env.AUTH_SECRET ??= 'local-script-secret-at-least-32-characters-long-padding';
env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
env.NEXT_PUBLIC_API_URL ??= 'http://localhost:3000/api';
env.API_INTERNAL_URL ??= 'http://localhost:3000/api';

// Take the key from the environment, else from `vercel env pull`'s .env.local.
if (!env.ANTHROPIC_API_KEY) {
  const file = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(file)) {
    const m = /^ANTHROPIC_API_KEY=(.*)$/m.exec(fs.readFileSync(file, 'utf8'));
    if (m) env.ANTHROPIC_API_KEY = m[1]!.trim().replace(/^['"]|['"]$/g, '');
  }
}

async function main() {
  if (!env.ANTHROPIC_API_KEY?.trim()) {
    console.error('✘ No ANTHROPIC_API_KEY in the environment or in .env.local (run `vercel env pull .env.local`).');
    process.exit(1);
  }
  console.log(`Key found (${env.ANTHROPIC_API_KEY.trim().length} characters, not shown). Asking the model…\n`);

  const { draftFormTranslations } = await import('../src/server/registrations/translate');
  const sample = [
    { label: 'Are you available to participate in the preparation phase if selected?', options: ['Yes', 'No'], targets: ['fr', 'ar'] as const },
    { label: 'Which challenge areas does your solution address?', options: ['Quality, HSE & Compliance', 'FoodTech & Agritech', 'Supply Chain & Logistics'], targets: ['fr', 'ar'] as const },
    { label: 'Who will represent the startup during the final pitch?', targets: ['fr', 'ar'] as const },
  ].map((f) => ({ ...f, targets: [...f.targets] }));

  const res = await draftFormTranslations('en', sample);
  if (!res.ok) {
    console.error(`✘ ${res.code === 'UNAVAILABLE' ? 'The key was not picked up.' : 'The call failed — see the error logged above (status and message).'}`);
    process.exit(1);
  }

  let problems = 0;
  res.fields.forEach((out, i) => {
    console.log(`Q${i + 1}: ${sample[i]!.label}`);
    for (const l of ['fr', 'ar'] as const) {
      const t = out[l];
      console.log(`   ${l}: ${t?.label ?? '(missing)'}${t?.options ? `  [${t.options.join(' | ')}]` : ''}`);
      if (!t?.label) problems++;
      if (sample[i]!.options && t?.options?.length !== sample[i]!.options!.length) problems++;
    }
  });
  if (problems) { console.error(`\n✘ ${problems} problem(s): a language or choice list came back incomplete.`); process.exit(1); }
  console.log('\n✔ The key and model work, and the answers have the shape the builder needs.');
}

main().catch((e) => { console.error('✘', e instanceof Error ? e.message : e); process.exit(1); });
