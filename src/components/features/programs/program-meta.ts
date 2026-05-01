/**
 * Static UI metadata for programs — labels, ordering, type tints.
 */
import type { ProgramType } from '@/types/domain';

export const programTypeLabel: Record<ProgramType, string> = {
  INCUBATION: 'Incubation',
  ACCELERATION: 'Acceleration',
  TRAINING: 'Training',
  BOOTCAMP: 'Bootcamp',
  WORKSHOP: 'Workshop',
};

export const programTypeOrder: ProgramType[] = [
  'ACCELERATION',
  'INCUBATION',
  'BOOTCAMP',
  'TRAINING',
  'WORKSHOP',
];

/** Tailwind classes for the gradient image placeholder per program type. */
export const programTypeTint: Record<ProgramType, { gradient: string; iconBg: string }> = {
  ACCELERATION: {
    gradient: 'from-amber-200 via-orange-100 to-rose-200',
    iconBg: 'bg-amber-500/10 text-amber-700',
  },
  INCUBATION: {
    gradient: 'from-emerald-200 via-emerald-100 to-teal-200',
    iconBg: 'bg-emerald-500/10 text-emerald-700',
  },
  BOOTCAMP: {
    gradient: 'from-violet-200 via-purple-100 to-fuchsia-200',
    iconBg: 'bg-violet-500/10 text-violet-700',
  },
  TRAINING: {
    gradient: 'from-sky-200 via-blue-100 to-cyan-200',
    iconBg: 'bg-sky-500/10 text-sky-700',
  },
  WORKSHOP: {
    gradient: 'from-slate-200 via-zinc-100 to-neutral-200',
    iconBg: 'bg-slate-500/10 text-slate-700',
  },
};
