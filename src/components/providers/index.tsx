import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import type { AbstractIntlMessages } from 'next-intl';
import { AuthProvider } from './auth-provider';
import { ThemeProvider } from './theme-provider';
import type { SessionUser } from '@/types/auth';

interface ProvidersProps {
  children: ReactNode;
  locale: string;
  messages: AbstractIntlMessages;
  initialUser: SessionUser | null;
}

/**
 * Top-level provider stack. Order matters:
 * 1. NextIntlClientProvider — translations available to everything below
 * 2. ThemeProvider — light/dark mode, no SSR mismatch
 * 3. AuthProvider — needs translations for error messages
 */
export function Providers({ children, locale, messages, initialUser }: ProvidersProps) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Africa/Algiers">
      <ThemeProvider>
        <AuthProvider initialUser={initialUser}>{children}</AuthProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
