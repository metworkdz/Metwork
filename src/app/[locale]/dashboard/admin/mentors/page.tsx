import { setRequestLocale } from 'next-intl/server';
import { Users } from 'lucide-react';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { MentorsManager } from '@/components/features/admin/mentors-manager';
import { requireRole } from '@/lib/auth-guards';
import { listMentors } from '@/server/mentors/service';
import { toMentorDto } from '@/server/mentors/serialize';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminMentorsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['ADMIN']);

  // Server-render with the live roster — instant first paint, no flash.
  const mentors = (await listMentors()).map(toMentorDto);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Mentors"
        subtitle="The roster shown in the landing-page carousel."
        action={
          <Badge variant="outline" className="gap-1">
            <Users className="size-3" />
            {mentors.length} live
          </Badge>
        }
      />
      <MentorsManager initial={mentors} />
    </div>
  );
}
