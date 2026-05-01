/**
 * Static UI metadata for spaces — labels, ordering. Kept separate so the
 * server side can import without pulling React into the bundle.
 */
import type { SpaceCategory } from '@/types/domain';

export const categoryLabel: Record<SpaceCategory, string> = {
  COWORKING: 'Coworking',
  PRIVATE_OFFICE: 'Private office',
  TRAINING_ROOM: 'Training room',
  DOMICILIATION: 'Domiciliation',
};

export const categoryOrder: SpaceCategory[] = [
  'COWORKING',
  'PRIVATE_OFFICE',
  'TRAINING_ROOM',
  'DOMICILIATION',
];

export const unitLabel = {
  HOUR: 'Hour',
  DAY: 'Day',
  MONTH: 'Month',
} as const;
