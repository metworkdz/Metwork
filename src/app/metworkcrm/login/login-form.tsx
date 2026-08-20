'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CrmButton } from '@/components/metworkcrm/ui/button';

interface LoginResponse {
  ok?: boolean;
  next?: string;
  error?: { code: string; message: string };
}

export function CrmLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/metworkcrm/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as LoginResponse;

      if (!res.ok) {
        setError(data.error?.message ?? 'Connexion impossible.');
        setLoading(false);
        return;
      }

      // The server decides the destination, so it cannot be tampered with here.
      router.push(data.next ?? '/metworkcrm');
      router.refresh();
    } catch {
      setError('Erreur réseau. Réessayez.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="crm-email" className="mb-1.5 block text-sm font-medium text-[var(--crm-black)]">
          Adresse e-mail
        </label>
        <input
          id="crm-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none transition-colors focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20"
        />
      </div>

      <div>
        <label htmlFor="crm-password" className="mb-1.5 block text-sm font-medium text-[var(--crm-black)]">
          Mot de passe
        </label>
        <input
          id="crm-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none transition-colors focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20"
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <CrmButton type="submit" loading={loading} className="w-full">
        Se connecter
      </CrmButton>
    </form>
  );
}
