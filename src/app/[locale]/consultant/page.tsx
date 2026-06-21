import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * The consultant portal moved to the non-localized `/mentordashboard` route
 * (its own PWA scope). This locale-prefixed path is kept only to redirect any
 * old bookmarks / shared links to the canonical entry.
 */
export default function LegacyConsultantPortalRedirect() {
  redirect('/mentordashboard');
}
