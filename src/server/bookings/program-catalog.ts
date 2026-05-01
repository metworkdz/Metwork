/**
 * Program catalog. Reads from `lib/demo-data` for now so the same
 * inventory feeds the public Programs page and the apply validator.
 *
 * When the programs backend lands, replace the body of `findProgramById`
 * with `await programsRepo.findById(id)` — every caller already awaits.
 */
import { demoPublicPrograms } from '@/lib/demo-data';
import type { Program } from '@/types/domain';

export async function findProgramById(id: string): Promise<Program | null> {
  return demoPublicPrograms.find((p) => p.id === id) ?? null;
}

export async function listPrograms(): Promise<Program[]> {
  return demoPublicPrograms;
}
