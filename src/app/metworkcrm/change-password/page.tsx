import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmChangePasswordForm } from './change-password-form';

export const metadata: Metadata = { title: 'Changer le mot de passe' };
export const dynamic = 'force-dynamic';

/**
 * Deliberately OUTSIDE the `(app)` group: that layout redirects users with a
 * pending password change here, so living inside it would loop.
 *
 * `allowPasswordChangePending` lets a user in that state reach this page — and
 * only this page. It still requires a valid session, so it is not an
 * unauthenticated bypass route.
 */
export default async function CrmChangePasswordPage() {
  const user = await requireCrmUser({ allowPasswordChangePending: true });

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
          <p className="text-sm text-neutral-500">{user.email}</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <CrmChangePasswordForm forced={user.mustChangePassword} />
        </div>

        {!user.mustChangePassword ? (
          <p className="mt-6 text-center text-xs text-neutral-400">
            <a href="/metworkcrm" className="underline underline-offset-2 hover:text-neutral-600">
              Retour au tableau de bord
            </a>
          </p>
        ) : null}
      </div>
    </main>
  );
}
