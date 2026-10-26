import { notFound } from 'next/navigation';
import { isAcademyEnabled } from '@/config/feature-flags';

/** Every Academy page except /academy itself 404s until launch (the flag). */
export function assertAcademyEnabled(): void {
  if (!isAcademyEnabled()) notFound();
}
