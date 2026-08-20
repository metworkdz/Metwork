'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { CrmSidebar } from '@/components/metworkcrm/nav/sidebar';
import { GlobalSearch } from '@/components/metworkcrm/shared/global-search';

/**
 * Owns the mobile sidebar's open/close state, so it can render ONE unified top
 * bar (hamburger + global search) instead of the sidebar's self-contained bar
 * from Prompt 1 — which had nowhere to mount a header-level search input.
 * `CrmSidebar` is now a dumb `<aside>` driven by props.
 */
export function CrmShell({
  role,
  userName,
  userEmail,
  children,
}: {
  role: 'ADMIN' | 'TEAM_MEMBER';
  userName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--crm-canvas)]">
      <CrmSidebar role={role} userName={userName} userEmail={userEmail} open={open} onClose={() => setOpen(false)} />

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-neutral-100 lg:hidden"
            aria-label="Ouvrir le menu"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <GlobalSearch />
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
