'use client';

/**
 * The "18 Aug Call / 17 Aug Email / 15 Aug Meeting" pattern from the product
 * spec — reused unmodified on both the Organization and Contact detail pages.
 * Self-contained: fetches its own data for the given entity and manages its
 * own create/edit/delete/mark-done actions.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  CalendarClock,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  Trash2,
  Users,
  Video,
} from 'lucide-react';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { INTERACTION_TYPE_LABELS } from '@/components/metworkcrm/shared/labels';
import { InteractionFormDialog, type InteractionRow } from './interaction-form-dialog';

const TYPE_ICON: Record<string, typeof Phone> = {
  APPEL: Phone,
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  LINKEDIN: Users,
  REUNION: Users,
  VISIO: Video,
  VISITE: Building2,
  RELANCE: CalendarClock,
  PROPOSITION: Mail,
  DOCUMENT_ENVOYE: Mail,
  AUTRE: MoreHorizontal,
};

function formatDayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

interface TimelineProps {
  organizationId?: string;
  contactId?: string;
  /** Pre-filled label shown in the "new interaction" dialog once opened. */
  entityLabel?: string;
}

export function Timeline({ organizationId, contactId, entityLabel }: TimelineProps) {
  const [rows, setRows] = useState<InteractionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (organizationId) params.set('organizationId', organizationId);
    if (contactId) params.set('contactId', contactId);
    const res = await fetch(`/api/metworkcrm/interactions?${params.toString()}`);
    const data = res.ok ? ((await res.json()) as { rows: InteractionRow[] }) : { rows: [] };
    setRows(data.rows);
    setLoading(false);
  }, [organizationId, contactId]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleDone(row: InteractionRow) {
    // Optimistic — a next-action checkbox that visibly lags feels broken.
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, nextActionDone: !r.nextActionDone } : r)));
    const res = await fetch(`/api/metworkcrm/interactions/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextActionDone: !row.nextActionDone }),
    });
    if (!res.ok) load(); // revert by refetching on failure
  }

  async function remove(row: InteractionRow) {
    if (!confirm(`Supprimer l'interaction « ${row.subject} » ?`)) return;
    const res = await fetch(`/api/metworkcrm/interactions/${row.id}`, { method: 'DELETE' });
    if (res.ok) load();
  }

  // Group consecutive rows by calendar day, preserving the already-chronological order from the API.
  const groups: { day: string; items: InteractionRow[] }[] = [];
  for (const row of rows) {
    const day = formatDayHeading(row.occurredAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(row);
    else groups.push({ day, items: [row] });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--crm-black)]">Historique</h3>
        <InteractionFormDialog
          lockedOrganizationId={organizationId}
          lockedOrganizationLabel={entityLabel}
          lockedContactId={contactId}
          lockedContactLabel={entityLabel}
          onSaved={load}
          trigger={
            <CrmButton size="sm" variant="outline">
              <Plus className="size-3.5" aria-hidden /> Interaction
            </CrmButton>
          }
        />
      </div>

      {loading ? (
        <p className="text-sm text-neutral-400">Chargement…</p>
      ) : groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-400">
          Aucune interaction enregistrée.
        </p>
      ) : (
        <ol className="space-y-5">
          {groups.map((group) => (
            <li key={group.day}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">{group.day}</p>
              <ul className="space-y-2 border-s border-neutral-200 ps-4">
                {group.items.map((row) => {
                  const Icon = TYPE_ICON[row.type] ?? MoreHorizontal;
                  return (
                    <li key={row.id} className="relative rounded-lg border border-neutral-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <Icon className="mt-0.5 size-4 shrink-0 text-neutral-400" aria-hidden />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--crm-black)]">
                              {INTERACTION_TYPE_LABELS[row.type] ?? row.type}
                              <span className="ms-2 font-normal text-neutral-400">{formatTime(row.occurredAt)}</span>
                            </p>
                            <p className="text-sm text-neutral-600">{row.subject}</p>
                            {row.outcome ? <p className="mt-1 text-xs text-neutral-400">{row.outcome}</p> : null}
                            {row.nextAction ? (
                              <button
                                type="button"
                                onClick={() => toggleDone(row)}
                                className="mt-2 inline-flex items-center gap-1.5"
                              >
                                <Badge variant={row.nextActionDone ? 'default' : 'warning'}>
                                  {row.nextActionDone ? '✓ ' : ''}
                                  {row.nextAction}
                                  {row.nextActionDate ? ` · ${row.nextActionDate}` : ''}
                                </Badge>
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                              aria-label="Actions"
                            >
                              <MoreHorizontal className="size-4" aria-hidden />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <InteractionFormDialog
                              interaction={row}
                              lockedOrganizationId={organizationId}
                              lockedContactId={contactId}
                              onSaved={load}
                              trigger={
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>Modifier</DropdownMenuItem>
                              }
                            />
                            <DropdownMenuItem className="text-red-600" onClick={() => remove(row)}>
                              <Trash2 className="size-3.5" aria-hidden /> Supprimer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
