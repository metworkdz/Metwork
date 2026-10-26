/**
 * Create the Startup Academy course for Module 1 ("Trouver et valider son idée
 * startup", 7 episodes) as a DRAFT, attached to mentor Yacine Kheddaoui, with
 * French texts and English/Arabic drafts to review.
 *
 * Videos are NOT uploaded by this script: open the course in
 * Admin → Startup Academy and upload each episode on its lesson (they go
 * straight to VdoCipher). Then publish from the builder.
 *
 * Idempotent: does nothing if a course with this slug already exists.
 * SAFE BY DEFAULT: prints what it would create; writes only with --confirm.
 *
 *   npx tsx scripts/academy-seed-module1.ts              # dry run
 *   npx tsx scripts/academy-seed-module1.ts --confirm    # create the draft
 *   USE_LOCAL_DB=true npx tsx scripts/academy-seed-module1.ts --confirm
 */
import { loadScriptEnv } from './_env';

const TARGET = loadScriptEnv();
const CONFIRM = process.argv.includes('--confirm');

import { randomUUID } from 'node:crypto';
import { db, type AcademyCourseRecord } from '../src/server/db/store';
import { MODULE1_COURSE, MODULE1_MENTOR_NAME, MODULE1_SLUG } from '../src/server/academy/seed/module1';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

async function main() {
  console.log(`Target: ${TARGET.kind} (${TARGET.label})${CONFIRM ? '' : ' — DRY RUN'}`);
  const d = await db.read();

  if ((d.academyCourses ?? []).some((c) => c.slug === MODULE1_SLUG)) {
    console.log(`✓ Course "${MODULE1_SLUG}" already exists. Nothing to do.`);
    return;
  }

  const matches = d.mentors.filter((m) => fold(m.fullName) === fold(MODULE1_MENTOR_NAME)
    || fold(m.fullName) === fold(MODULE1_MENTOR_NAME.split(' ').reverse().join(' ')));
  if (matches.length !== 1) {
    const close = d.mentors.filter((m) => /yacine|kheddaoui/i.test(m.fullName)).map((m) => `${m.fullName} (${m.id})`);
    console.error(`✘ Expected exactly one mentor named "${MODULE1_MENTOR_NAME}", found ${matches.length}.`);
    console.error(close.length ? `  Close matches: ${close.join(', ')}` : '  No close match. Add him in Admin → Mentors first.');
    process.exit(1);
  }
  const mentor = matches[0]!;

  const now = new Date().toISOString();
  const course: AcademyCourseRecord = {
    id: randomUUID(),
    slug: MODULE1_SLUG,
    fieldId: 'ideation',
    mentorIds: [mentor.id],
    title: MODULE1_COURSE.title,
    subtitle: MODULE1_COURSE.subtitle,
    description: MODULE1_COURSE.description,
    outcomes: [...MODULE1_COURSE.outcomes],
    level: 'BEGINNER',
    audioLanguage: 'DARIJA_FR',
    priceDzd: 2900,
    includedInPass: true,
    thumbnailUrl: null,
    trailerVideoId: null,
    modules: [{
      id: randomUUID(),
      title: MODULE1_COURSE.moduleTitle,
      comingSoon: false,
      lessons: MODULE1_COURSE.lessons.map((title, i) => ({
        id: randomUUID(),
        title,
        description: null,
        kind: 'VIDEO' as const,
        videoId: null,
        videoStatus: 'NONE' as const,
        durationSec: 0,
        // The introduction is the free sample.
        isPreview: i === 0,
        resources: [],
      })),
    }],
    status: 'DRAFT',
    createdBy: { kind: 'ADMIN', id: 'script:academy-seed-module1' },
    reviewNote: null,
    submittedAt: null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  console.log(`Mentor: ${mentor.fullName} (${mentor.id})`);
  console.log(`Course: ${course.title.fr} — ${course.modules[0]!.lessons.length} lessons, ${course.priceDzd} DA, DRAFT`);
  if (!CONFIRM) {
    console.log('Dry run: nothing written. Re-run with --confirm.');
    return;
  }
  await db.update((s) => {
    if (!Array.isArray(s.academyCourses)) s.academyCourses = [];
    if (s.academyCourses.some((c) => c.slug === MODULE1_SLUG)) return;
    s.academyCourses.push(course);
  });
  console.log(`✓ Created draft ${course.id}. Upload the 7 videos in Admin → Startup Academy.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
