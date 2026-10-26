import { Navbar } from '@/components/layout/navbar';
import { Footer } from '@/components/layout/footer';
import { getLandingVisibility } from '@/lib/landing-visibility';

/** The marketing site frame (navbar + footer) — the (public) layout and the Academy's "coming soon" page share it. */
export async function PublicShell({ children }: { children: React.ReactNode }) {
  // One request-cached read, shared with the per-page notFound() guards.
  // Defaults to {} (= everything visible) and never throws.
  const landingVisibility = await getLandingVisibility();

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <Navbar landingVisibility={landingVisibility} />
      <main className="flex-1 min-w-0">{children}</main>
      <Footer landingVisibility={landingVisibility} />
    </div>
  );
}
