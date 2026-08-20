import Link from 'next/link';

export default function CrmNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-sm text-neutral-400">404</p>
      <h1 className="mt-2 text-lg font-semibold text-[var(--crm-black)]">Page introuvable</h1>
      <p className="mt-2 max-w-md text-sm text-neutral-500">
        Cette page n’existe pas dans METWORK OS.
      </p>
      <Link
        href="/metworkcrm"
        className="mt-6 text-sm font-medium text-[var(--crm-green)] underline underline-offset-4"
      >
        Retour au tableau de bord
      </Link>
    </div>
  );
}
