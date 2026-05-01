/**
 * Event catalog. See `program-catalog.ts` for the same pattern.
 */
import { demoPublicEvents } from '@/lib/demo-data';
import type { Event as PlatformEvent } from '@/types/domain';

export async function findEventById(id: string): Promise<PlatformEvent | null> {
  return demoPublicEvents.find((e) => e.id === id) ?? null;
}

export async function listEvents(): Promise<PlatformEvent[]> {
  return demoPublicEvents;
}
