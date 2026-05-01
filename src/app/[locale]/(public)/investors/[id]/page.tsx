import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { ArrowLeft, Target, Percent, BarChart3, User } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Container } from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { findStartupById } from '@/server/startups/service';
import { toStartupDto } from '@/server/startups/serialize';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id, locale } = await params;
  setRequestLocale(locale);
  const record = await findStartupById(id);
  if (!record) return { title: 'Startup not found' };
  return {
    title: record.name,
    description: record.description.slice(0, 160),
  };
}

function formatDZD(amount: number): string {
  return new Intl.NumberFormat('fr-DZ', {
    style: 'currency',
    currency: 'DZD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export default async function StartupDetailPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const record = await findStartupById(id);
  if (!record || record.status !== 'ACTIVE') notFound();

  const startup = toStartupDto(record);

  // Resolve founder display name from the store directly.
  const { users } = await db.read();
  const founder = users.find((u) => u.id === startup.founderId);

  const metrics = [
    {
      icon: Target,
      label: 'Funding goal',
      value: formatDZD(startup.fundingGoal),
    },
    {
      icon: Percent,
      label: 'Equity offered',
      value: `${startup.equityOffered}%`,
    },
    ...(startup.valuation
      ? [{ icon: BarChart3, label: 'Pre-money valuation', value: formatDZD(startup.valuation) }]
      : []),
  ];

  return (
    <Container size="md" className="py-10 sm:py-14">
      {/* Back */}
      <Link
        href="/investors"
        className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Back to marketplace
      </Link>

      {/* Header */}
      <div className="space-y-3">
        <Badge variant="default">{startup.industry}</Badge>
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          {startup.name}
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">{startup.description}</p>
      </div>

      {/* Metrics */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {metrics.map(({ icon: Icon, label, value }) => (
          <Card key={label} className="border-border/60">
            <CardContent className="p-5">
              <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-600">
                <Icon className="size-4" />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-xl font-semibold tracking-tight text-foreground">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Founder */}
      {founder && (
        <div className="mt-8 flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-5 py-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
            <User className="size-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Founder</p>
            <p className="text-sm font-medium text-foreground">{founder.fullName}</p>
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" asChild>
          <Link href="/signup">Connect with founder</Link>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link href="/investors">Browse more startups</Link>
        </Button>
      </div>
    </Container>
  );
}
