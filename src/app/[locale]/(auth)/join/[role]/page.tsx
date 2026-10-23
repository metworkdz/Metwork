import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Check } from 'lucide-react';
import { SignupForm } from '@/components/features/auth/signup-form';
import { JOIN_SLUGS, isJoinSlug } from '@/config/join-pages';

interface PageProps {
  params: Promise<{ locale: string; role: string }>;
}

export function generateStaticParams() {
  return Object.keys(JOIN_SLUGS).map((role) => ({ role }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, role } = await params;
  setRequestLocale(locale);
  if (!isJoinSlug(role)) return {};
  const t = await getTranslations('join');
  return { title: t(`${role}.title`), description: t(`${role}.subtitle`) };
}

/**
 * /join/<audience> — one audience's pitch above the shared signup engine with
 * the role locked. No role picker: the visitor already said who they are.
 */
export default async function JoinRolePage({ params }: PageProps) {
  const { locale, role } = await params;
  setRequestLocale(locale);
  if (!isJoinSlug(role)) notFound();
  const t = await getTranslations('join');
  const points = [t(`${role}.point1`), t(`${role}.point2`), t(`${role}.point3`)];

  return (
    <div className="space-y-5">
      <section className="px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">{t(`${role}.eyebrow`)}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance">{t(`${role}.title`)}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t(`${role}.subtitle`)}</p>
        <ul className="mt-4 space-y-2">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-primary-600" />
              <span className="min-w-0">{p}</span>
            </li>
          ))}
        </ul>
      </section>
      <Suspense fallback={null}>
        <SignupForm lockedRole={JOIN_SLUGS[role]} />
      </Suspense>
    </div>
  );
}
