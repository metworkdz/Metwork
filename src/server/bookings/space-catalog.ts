/**
 * Space catalog. Currently reads from `lib/demo-data` so the same
 * inventory feeds the public Spaces page and the booking validator.
 *
 * When the spaces backend lands, replace the body of `findById` with
 * `await spacesRepo.findById(id)` — every caller already awaits.
 */
import { demoPublicSpaces } from '@/lib/demo-data';
import type { Space } from '@/types/domain';

export async function findSpaceById(id: string): Promise<Space | null> {
  return demoPublicSpaces.find((s) => s.id === id) ?? null;
}

export async function listSpaces(): Promise<Space[]> {
  return demoPublicSpaces;
}
