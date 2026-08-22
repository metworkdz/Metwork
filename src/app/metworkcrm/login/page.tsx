import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { readCrmSession } from '@/server/metworkcrm/auth/session';
import { CrmLoginForm } from './login-form';

export const metadata: Metadata = { title: 'Connexion' };
export const dynamic = 'force-dynamic';

export default async function CrmLoginPage() {
  // Already signed in? Skip the form. Honour the pending password change so a
  // user cannot dodge it by navigating back to /login.
  //
  // This check is deliberately best-effort: it only runs when a session
  // cookie is present (readCrmSession() returns null without touching the
  // database otherwise), but if the database IS reachable-but-erroring at
  // that moment, failing here must never block the one page whose entire job
  // is letting someone log in. A visitor with a stale/irrelevant cookie
  // during a transient database issue should still see the form and be able
  // to attempt a real login (which has its own error handling) rather than
  // being stuck on a blank error-boundary page with no way forward.
  let session: Awaited<ReturnType<typeof readCrmSession>> = null;
  try {
    session = await readCrmSession();
  } catch (err) {
    console.error('[metworkcrm] readCrmSession failed on the login page — rendering the form anyway:', err);
  }
  if (session) {
    redirect(session.user.mustChangePassword ? '/metworkcrm/change-password' : '/metworkcrm');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--crm-canvas)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-[var(--crm-green)]" aria-hidden />
            <span className="text-lg font-semibold tracking-tight text-[var(--crm-black)]">
              METWORK OS
            </span>
          </div>
          <p className="text-sm text-neutral-500">Outil interne — accès réservé à l’équipe.</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <CrmLoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-neutral-400">
          Cet espace est indépendant des comptes clients Metwork.
        </p>
      </div>
    </main>
  );
}
