'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CrmButton } from '@/components/metworkcrm/ui/button';

interface ChangePasswordResponse {
  ok?: boolean;
  next?: string;
  error?: { code: string; message: string; details?: { fieldErrors?: Record<string, string[]> } };
}

const inputClass =
  'h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none transition-colors focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function CrmChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Same split as the login form: fetch() failing and res.json() failing
    // are different problems (network vs. a server-side crash producing a
    // non-JSON body) and deserve different, honest messages — see the note
    // there for why "Erreur réseau" for both was actively misleading.
    let res: Response;
    try {
      res = await fetch('/api/metworkcrm/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
    } catch {
      setError('Impossible de contacter le serveur. Vérifiez votre connexion.');
      setLoading(false);
      return;
    }

    let data: ChangePasswordResponse;
    try {
      data = (await res.json()) as ChangePasswordResponse;
    } catch {
      setError(`Réponse du serveur invalide (code ${res.status}). Réessayez ou contactez l'équipe technique.`);
      setLoading(false);
      return;
    }

    if (!res.ok) {
      // Surface the first field-level message when validation failed.
      const fieldErrors = data.error?.details?.fieldErrors;
      const firstField = fieldErrors
        ? Object.values(fieldErrors).flat().find(Boolean)
        : undefined;
      setError(firstField ?? data.error?.message ?? 'Modification impossible.');
      setLoading(false);
      return;
    }

    router.push(data.next ?? '/metworkcrm');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {forced ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Pour votre sécurité, choisissez un nouveau mot de passe avant d’accéder au CRM.
        </p>
      ) : null}

      <div>
        <label htmlFor="cp-current" className="mb-1.5 block text-sm font-medium text-[var(--crm-black)]">
          Mot de passe actuel
        </label>
        <input
          id="cp-current"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="cp-new" className="mb-1.5 block text-sm font-medium text-[var(--crm-black)]">
          Nouveau mot de passe
        </label>
        <input
          id="cp-new"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={inputClass}
          aria-describedby="cp-new-hint"
        />
        <p id="cp-new-hint" className="mt-1.5 text-xs text-neutral-500">
          8 caractères minimum.
        </p>
      </div>

      <div>
        <label htmlFor="cp-confirm" className="mb-1.5 block text-sm font-medium text-[var(--crm-black)]">
          Confirmer le nouveau mot de passe
        </label>
        <input
          id="cp-confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <CrmButton type="submit" loading={loading} className="w-full">
        Mettre à jour le mot de passe
      </CrmButton>
    </form>
  );
}
