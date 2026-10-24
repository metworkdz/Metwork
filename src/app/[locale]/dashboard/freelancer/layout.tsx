/**
 * Freelancer dashboard gate.
 *
 * Single chokepoint for every /dashboard/freelancer/* page: the role check
 * lives here so no page under it can forget it. Pages may still call
 * `requireRole(['FREELANCER'])` themselves to get the typed session user.
 */
import { setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { offerContractIfEligible } from '@/server/freelancer-contracts/service';

export const dynamic = 'force-dynamic';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function FreelancerDashboardLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireRole(['FREELANCER']);
  // Catches every path to 100 % (photo, payout account, phone…): the offer is
  // idempotent and only writes the first time the profile is complete.
  await offerContractIfEligible(user.id).catch(() => false);
  return <>{children}</>;
}
