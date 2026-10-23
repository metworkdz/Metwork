'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, LogOut, Settings } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link, useRouter } from '@/i18n/routing';
import { useAuth } from '@/components/providers/auth-provider';
import type { SessionUser } from '@/types/auth';
import { MemberBadge } from '@/components/shared/member-badge';
import { memberBadgeFor } from '@/lib/member-badge';

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

interface UserMenuProps {
  user: SessionUser;
}

export function UserMenu({ user }: UserMenuProps) {
  const t = useTranslations();
  const { logout } = useAuth();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const dashboardHref = `/dashboard/${user.role.toLowerCase()}` as const;
  const badge = memberBadgeFor(user);

  function onLogout() {
    startTransition(async () => {
      await logout();
      router.push('/');
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative size-9 rounded-full p-0"
          aria-label={user.fullName}
        >
          <Avatar>
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName} />}
            <AvatarFallback>{getInitials(user.fullName)}</AvatarFallback>
          </Avatar>
          <MemberBadge badge={badge} className="absolute -bottom-0.5 -end-0.5 ring-2 ring-background" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{user.fullName}</span>
            <MemberBadge badge={badge} />
          </span>
          <span className="text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={dashboardHref} className="cursor-pointer gap-2">
            <LayoutDashboard className="size-4" />
            {t('nav.dashboard')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${dashboardHref}/settings`} className="cursor-pointer gap-2">
            <Settings className="size-4" />
            {t('dashboard.settings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onLogout}
          disabled={isPending}
          className="cursor-pointer gap-2 text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" />
          {t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
