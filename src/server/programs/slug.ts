/**
 * A program's link — `/programs/{slug}` — unique across the whole platform.
 *
 * Slugs used to be unique per owner only, while the public page looks a link
 * up across every program and takes the first match. Two hosts naming a
 * program "Formation juridique" therefore shared one link, and the second
 * host's shared link opened the first host's program. Now that a program can
 * be unlisted — reachable by that link and nothing else — the link has to
 * lead to exactly one program.
 *
 * A slug may not equal another program's id either: the public lookup accepts
 * both, so a slug shaped like someone's id would shadow their program.
 */
import type { ProgramRecord } from '@/server/db/store';
import { slugify, uniqueSlug } from '@/lib/slugify';

type SlugShape = Pick<ProgramRecord, 'id' | 'slug'>;

function takenBy(programs: ReadonlyArray<SlugShape>, exceptId?: string): string[] {
  const taken: string[] = [];
  for (const p of programs) {
    if (p.id === exceptId) continue;
    taken.push(p.id);
    if (p.slug) taken.push(p.slug);
  }
  return taken;
}

/** Is this slug free for the given program (or for a new one)? */
export function isProgramSlugFree(
  programs: ReadonlyArray<SlugShape>,
  slug: string,
  exceptId?: string,
): boolean {
  return !takenBy(programs, exceptId).includes(slug);
}

/**
 * The slug a new program gets: the one asked for, or one made from the title,
 * suffixed "-2", "-3"… until no other program uses it.
 */
export function allocateProgramSlug(
  programs: ReadonlyArray<SlugShape>,
  requested: string | null | undefined,
  title: string,
): string {
  // A title with nothing slug-able in it (symbols only) still gets a link.
  const base = requested || slugify(title) || 'programme';
  return uniqueSlug(base, takenBy(programs));
}
