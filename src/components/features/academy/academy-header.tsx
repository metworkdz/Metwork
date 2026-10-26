'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { UserMenu } from '@/components/layout/user-menu';
import { useAuth } from '@/components/providers/auth-provider';
import { AcademyThemeSwitch } from './academy-theme-switch';

/**
 * The Academy's own top bar: wordmark, theme switch, language, account.
 * Catalogue / mentors / Pass links join it as those pages ship (phases 1–3).
 */
export function AcademyHeader() {
  const t = useTranslations('academy.header');
  const { isAuthenticated, user } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/academy" className="flex min-w-0 items-center gap-3" aria-label={t('home')}>
          <Image src="/assets/metworklogo.svg" alt="Metwork" width={147} height={24} priority className="h-6 w-auto dark:hidden" />
          <Image src="/assets/Metworkwhitelogo.png" alt="Metwork" width={113} height={24} priority className="hidden h-6 w-auto dark:block" />
          <span className="hidden border-s border-border ps-3 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-primary sm:inline">
            {t('wordmark')}
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <AcademyThemeSwitch className="hidden sm:inline-flex" />
          <AcademyThemeSwitch compact className="sm:hidden" />
          <LocaleSwitcher />
          {isAuthenticated && user ? (
            <UserMenu user={user} />
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href={{ pathname: '/login', query: { next: '/academy' } }}>{t('login')}</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/join">{t('signup')}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
