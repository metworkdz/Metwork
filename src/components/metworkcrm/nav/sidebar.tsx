'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { navForRole, type CrmNavSection } from './nav-config';

/**
 * CRM shell navigation — the `<aside>` only. Mobile open/close state and the
 * top bar (hamburger + global search) live in `CrmShell`, which is the only
 * place that needs to coordinate both — see components/metworkcrm/shell/crm-shell.tsx.
 *
 * Responsive with Tailwind breakpoints ONLY — no useMediaQuery, no
 * window.innerWidth (dev rules: those cause hydration mismatches). The mobile
 * drawer is pure CSS translate driven by a boolean prop, so the server and
 * client render identical markup; `open` only ever starts false.
 */
export function CrmSidebar({
  role,
  userName,
  userEmail,
  open,
  onClose,
}: {
  role: 'ADMIN' | 'TEAM_MEMBER';
  userName: string;
  userEmail: string;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const sections = navForRole(role);

  return (
    <>
      {/* Backdrop (mobile only) */}
      {open ? (
        <button
          type="button"
          aria-label="Fermer le menu"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[var(--crm-sidebar)] transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-5">
          <Link href="/metworkcrm" className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[var(--crm-green)]" aria-hidden />
            <span className="font-semibold tracking-tight text-white">METWORK OS</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-md text-neutral-400 hover:bg-white/10 lg:hidden"
            aria-label="Fermer le menu"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {sections.map((section: CrmNavSection, i) => (
            <div key={section.title ?? `root-${i}`} className="mb-5">
              {section.title ? (
                <p className="px-3 pb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--crm-sidebar-muted)]">
                  {section.title}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  // Exact match for the dashboard root; prefix match elsewhere,
                  // so /metworkcrm/contacts/123 keeps "Contacts" highlighted.
                  const active =
                    item.href === '/metworkcrm'
                      ? pathname === '/metworkcrm'
                      : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                          active
                            ? 'bg-[var(--crm-green)] font-medium text-white'
                            : 'text-[var(--crm-sidebar-foreground)] hover:bg-[var(--crm-sidebar-hover)]',
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">{item.label}</span>
                        {item.status === 'coming-soon' ? (
                          <span
                            className={cn(
                              'ms-auto size-1.5 shrink-0 rounded-full',
                              active ? 'bg-white/60' : 'bg-neutral-600',
                            )}
                            aria-hidden
                          />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-white/10 p-3">
          <div className="mb-2 px-2">
            <p className="truncate text-sm font-medium text-white">{userName}</p>
            <p className="truncate text-xs text-[var(--crm-sidebar-muted)]">{userEmail}</p>
            <p className="mt-1 text-[0.6875rem] uppercase tracking-wide text-[var(--crm-sidebar-muted)]">
              {role === 'ADMIN' ? 'Administrateur' : 'Membre'}
            </p>
          </div>
          <form action="/metworkcrm/logout" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--crm-sidebar-foreground)] transition-colors hover:bg-[var(--crm-sidebar-hover)]"
            >
              <LogOut className="size-4" aria-hidden />
              Se déconnecter
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
