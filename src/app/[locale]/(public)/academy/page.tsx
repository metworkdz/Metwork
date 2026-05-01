import { redirect } from 'next/navigation';
import { siteConfig } from '@/config/site';

/**
 * Startup Academy is hosted externally.
 * This route exists for navigation consistency — it 308-redirects to the actual URL.
 *
 * In the navbar we set `external: true` which opens this in a new tab,
 * so users land directly on the Academy.
 */
export default function AcademyPage() {
  redirect(siteConfig.academy.externalUrl);
}
