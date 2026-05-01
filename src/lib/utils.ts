import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind classes intelligently — later classes override earlier ones,
 * even when they belong to the same Tailwind utility group.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
