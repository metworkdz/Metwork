/**
 * Apply a prepared question set to one event's registration form, through the
 * public HTTP API — the same endpoint the form builder saves to.
 *
 * WHY AN API CLIENT AND NOT A DB WRITE: it signs in as the incubator, so every
 * ownership, validation and cleanup rule of the real product applies, and it
 * needs no database credentials. Nothing here can do more than the builder can.
 *
 *   npx tsx scripts/apply-registration-form.ts \
 *     --base https://metwork.dz --email you@example.com \
 *     --event "innovation bridge" [--dry-run] [--force]
 *
 * The password is read from METWORK_PASSWORD or typed at a hidden prompt — never
 * a command-line argument, so it does not end up in shell history.
 *
 * SAFETY. Saving REPLACES the whole form. A question that is not in the new set
 * is removed, and so are the answers (and uploaded files) already collected for
 * it. So the script refuses to run when the event already has registrations,
 * unless --force is given, and always prints what it is about to do. --dry-run
 * stops after printing.
 */
import readline from 'node:readline';
import {
  SOURCE_LOCALE,
  TRANSLATION_DRAFTED,
  innovationBridgeFields,
  type FormField,
} from './forms/innovation-bridge-algeria';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const BASE = (arg('base', 'http://localhost:3000') as string).replace(/\/+$/, '');
const EMAIL = arg('email');
const EVENT = arg('event');
const DRY = has('dry-run');
const FORCE = has('force');

function die(msg: string): never {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

async function readPassword(): Promise<string> {
  if (process.env.METWORK_PASSWORD) return process.env.METWORK_PASSWORD;
  if (!process.stdin.isTTY) die('No METWORK_PASSWORD set and no terminal to ask on.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Mute echo so the password is not drawn on screen.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
    if (s.includes('Password')) process.stdout.write(s);
  };
  return new Promise((resolve) =>
    rl.question('Password: ', (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); }),
  );
}

let cookie = '';
async function api<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

const message = (b: unknown) => (b as { error?: { message?: string } })?.error?.message ?? JSON.stringify(b);

async function main() {
  if (!EMAIL) die('Missing --email');
  if (!EVENT) die('Missing --event "<part of the event title>"');
  const fields: FormField[] = innovationBridgeFields;

  console.log(`Target: ${BASE}`);
  console.log(`Form:   ${fields.length} questions (${fields.filter((f) => f.type === 'FILE').length} file uploads), written in ${SOURCE_LOCALE}, translated to ${TRANSLATION_DRAFTED.join(' + ')} (flagged as drafts to check)\n`);

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: await readPassword() }),
  });
  if (login.status !== 200) die(`Sign-in failed (${login.status}): ${message(login.body)}`);
  console.log(`Signed in as ${EMAIL}`);

  const events = await api<{ items: Array<{ id: string; title: string; slug?: string }> }>('/api/incubator/events');
  if (events.status !== 200) die(`Could not list your events (${events.status}): ${message(events.body)}`);
  const matches = events.body.items.filter((e) => e.title.toLowerCase().includes(EVENT.toLowerCase()));
  if (matches.length !== 1) {
    die(
      matches.length === 0
        ? `No event title contains "${EVENT}". Yours: ${events.body.items.map((e) => `"${e.title}"`).join(', ') || '(none)'}`
        : `"${EVENT}" matches ${matches.length} events: ${matches.map((e) => `"${e.title}"`).join(', ')}. Be more specific.`,
    );
  }
  const event = matches[0]!;
  console.log(`Event:  "${event.title}" (${event.id})`);

  const current = await api<{ fields: Array<{ label: string }> }>(`/api/incubator/registration-form?entityType=EVENT&entityId=${event.id}`);
  const regs = await api<{ total: number }>(`/api/incubator/registrations?entityType=EVENT&entityId=${event.id}&pageSize=1`);
  const existing = current.body.fields?.length ?? 0;
  const registered = regs.body.total ?? 0;
  console.log(`Now:    ${existing} questions, ${registered} registration(s)\n`);

  if (existing > 0) {
    console.log(`This REPLACES the ${existing} existing question(s):`);
    current.body.fields.forEach((f) => console.log(`   - ${f.label}`));
    console.log('');
  }
  fields.forEach((f, i) =>
    console.log(
      `${String(i + 1).padStart(2)}. [${f.type}${f.required ? '' : ', optional'}] ${f.label}` +
        (f.options ? `  (${f.options.length} option${f.options.length === 1 ? '' : 's'})` : ''),
    ),
  );

  if (registered > 0 && !FORCE) {
    die(
      `\n${registered} registration(s) already exist. Replacing the form would delete the answers (and files) they hold for any question not in the new set.\n  Re-run with --force only if that is what you want.`,
    );
  }
  if (DRY) { console.log('\n--dry-run: nothing was changed.'); return; }

  const save = await api<{ fields?: Array<{ id: string }> }>('/api/incubator/registration-form', {
    method: 'POST',
    body: JSON.stringify({
      entityType: 'EVENT',
      entityId: event.id,
      fields: fields.map((f, i) => ({
        label: f.label,
        type: f.type,
        options: f.options ?? null,
        required: f.required,
        order: i,
        // Written in one language, shown in the visitor's. Answers are recorded in
        // the source language. The translations are flagged as drafts until a person
        // marks them as checked in the builder.
        sourceLocale: SOURCE_LOCALE,
        translations: f.translations,
        draftedLocales: TRANSLATION_DRAFTED.filter((l) => f.translations[l]),
      })),
    }),
  });
  if (save.status !== 200) die(`Save failed (${save.status}): ${message(save.body)}`);
  console.log(`\n✔ Saved ${save.body.fields?.length ?? '?'} questions to "${event.title}".`);
  if (event.slug) console.log(`  Public page: ${BASE}/en/events/${event.slug}`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
