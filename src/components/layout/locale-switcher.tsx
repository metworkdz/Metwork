'use client';

import { useTransition } from 'react';
import { useLocale } from 'next-intl';
import { Globe, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { usePathname, useRouter } from '@/i18n/routing';
import { locales, localeMetadata, type Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function onSelect(next: Locale) {
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  const current = localeMetadata[locale as Locale];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          aria-label="Change language"
          className="gap-1.5"
        >
          <Globe className="size-4" />
          <span className="hidden text-xs font-medium sm:inline">{current?.nativeName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {locales.map((l) => {
          const meta = localeMetadata[l];
          const isActive = l === locale;
          return (
            <DropdownMenuItem
              key={l}
              onClick={() => onSelect(l)}
              className={cn('cursor-pointer gap-2', isActive && 'bg-accent')}
            >
              <span aria-hidden>{meta.flag}</span>
              <span className="flex-1">{meta.nativeName}</span>
              {isActive && <Check className="size-4" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
