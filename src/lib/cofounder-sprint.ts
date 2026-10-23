/**
 * The 14-day trial sprint two matched founders run before committing
 * (Metwork 2.0 phase 8b). Client-safe: the checklist and its order.
 * Labels and hints live in i18n `cofounderSprint.items.<key>`.
 */
export const SPRINT_DAYS = 14;

export const SPRINT_ITEMS = [
  'meet',
  'problem',
  'customers',
  'prototype',
  'roles',
  'time',
  'money',
  'decision',
] as const;
export type SprintItem = (typeof SPRINT_ITEMS)[number];

export function isSprintItem(v: unknown): v is SprintItem {
  return typeof v === 'string' && (SPRINT_ITEMS as readonly string[]).includes(v);
}

/** Day of the sprint (1-based), capped at SPRINT_DAYS + 1 ("over"). */
export function sprintDay(startedAt: string, now = new Date()): number {
  const days = Math.floor((now.getTime() - new Date(startedAt).getTime()) / 86_400_000) + 1;
  return Math.max(1, Math.min(SPRINT_DAYS + 1, days));
}
