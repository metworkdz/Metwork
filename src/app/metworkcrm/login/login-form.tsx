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

    // Split fetch() from res.json(): each fails for a DIFFERENT reason, and
    // conflating them under one "Erreur réseau" message actively misleads —
    // a server-side crash (uncaught exception, unreachable database) shows up
    // as a non-JSON response, and blaming the user's network sends them
    // retrying something that will never succeed until the server is fixed.
    let res: Response;
    try {
      res = await fetch('/api/metworkcrm/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      // fetch() itself rejected — no response was ever received (offline,
      // DNS failure, connection refused). A genuine network problem.
      setError('Impossible de contacter le serveur. Vérifiez votre connexion.');
      setLoading(false);
      return;
    }

    let data: LoginResponse;
    try {
      data = (await res.json()) as LoginResponse;
    } catch {
      // A response came back but its body isn't valid JSON — almost always
      // means the server errored before it could build a proper response
      // (e.g. an unhandled exception rendering an HTML error page). Say so.
      setError(`Réponse du serveur invalide (code ${res.status}). Réessayez ou contactez l'équipe technique.`);
      setLoading(false);
      return;
    }

    if (!res.ok) {
      setError(data.error?.message ?? 'Connexion impossible.');
      setLoading(false);
      return;
    }

    // The server decides the destination, so it cannot be tampered with here.
    router.push(data.next ?? '/metworkcrm');
    router.refresh();
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
