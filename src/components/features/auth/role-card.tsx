'use client';

import { useTranslations } from 'next-intl';
import { Rocket, TrendingUp, Building2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SignupRole } from '@/types/auth';

interface RoleCardProps {
  role: SignupRole;
  selected: boolean;
  onSelect: (role: SignupRole) => void;
}

const ROLE_META: Record<SignupRole, { icon: typeof Rocket; titleKey: string; descKey: string }> = {
  ENTREPRENEUR: {
    icon: Rocket,
    titleKey: 'auth.signup.roleEntrepreneur',
    descKey: 'auth.signup.roleEntrepreneurDesc',
  },
  INVESTOR: {
    icon: TrendingUp,
    titleKey: 'auth.signup.roleInvestor',
    descKey: 'auth.signup.roleInvestorDesc',
  },
  INCUBATOR: {
    icon: Building2,
    titleKey: 'auth.signup.roleIncubator',
    descKey: 'auth.signup.roleIncubatorDesc',
  },
};

export function RoleCard({ role, selected, onSelect }: RoleCardProps) {
  const t = useTranslations();
  const meta = ROLE_META[role];
  const Icon = meta.icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(role)}
      aria-pressed={selected}
      className={cn(
        'group relative flex w-full items-start gap-4 rounded-lg border-2 p-4 text-start transition-all',
        'hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary bg-primary-50/50'
          : 'border-border bg-background hover:border-primary/30',
      )}
    >
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-md transition-colors',
          selected
            ? 'bg-primary-100 text-primary-700'
            : 'bg-muted text-muted-foreground group-hover:bg-primary-50 group-hover:text-primary-600',
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">{t(meta.titleKey)}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t(meta.descKey)}</p>
      </div>
      {selected && (
        <div className="absolute end-3 top-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" />
        </div>
      )}
    </button>
  );
}
