'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Linkedin, Mail, MapPin, Phone, Plus, Star, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { EntityPicker } from '@/components/metworkcrm/shared/entity-picker';
import { Timeline } from '@/components/metworkcrm/interactions/timeline';
import { TaskFormDialog, type TaskRow } from '@/components/metworkcrm/tasks/task-form-dialog';
import { TASK_PRIORITY_BADGE, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, ORG_TYPE_LABELS, RECORD_STATUS_BADGE, RECORD_STATUS_LABELS } from '@/components/metworkcrm/shared/labels';
import { OrganizationFormDialog, type OrganizationRow } from './organization-form-dialog';
import { ContactFormDialog, type ContactRow } from '@/components/metworkcrm/contacts/contact-form-dialog';

interface LinkedContact extends ContactRow {
  role: string | null;
  isPrimary: boolean;
}

export interface OrganizationDetailData {
  organization: OrganizationRow;
  contacts: LinkedContact[];
  tasks: TaskRow[];
  opportunities: unknown[];
}

export function OrganizationDetail({ initial }: { initial: OrganizationDetailData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [addContactValue, setAddContactValue] = useState<{ id: string; label: string } | null>(null);
  const [linking, setLinking] = useState(false);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const res = await fetch(`/api/metworkcrm/organizations/${initial.organization.id}`);
    if (res.ok) setData(await res.json());
    refreshing.current = false;
  }, [initial.organization.id]);

  const org = data.organization;

  async function onDelete() {
    if (!confirm(`Supprimer « ${org.name} » ? Cette action est irréversible.`)) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/metworkcrm/organizations/${org.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/metworkcrm/organizations');
      return;
    }
    const body = await res.json().catch(() => null);
    setDeleteError(body?.error?.message ?? 'Suppression impossible.');
    setDeleting(false);
  }

  async function onArchive() {
    await fetch(`/api/metworkcrm/organizations/${org.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ARCHIVE' }),
    });
    refresh();
  }

  async function linkExistingContact() {
    if (!addContactValue) return;
    setLinking(true);
    // Read the contact's CURRENT org links first — this endpoint replaces the
    // full set, so we must append rather than overwrite.
    const existingRes = await fetch(`/api/metworkcrm/contacts/${addContactValue.id}`);
    const existing = existingRes.ok ? await existingRes.json() : { organizations: [] };
    const links = (existing.organizations as { id: string; role: string | null; isPrimary: boolean }[]).map(
      (o: { id: string; role: string | null; isPrimary: boolean }) => ({
        organizationId: o.id,
        role: o.role ?? undefined,
        isPrimary: o.isPrimary,
      }),
    );
    if (!links.some((l) => l.organizationId === org.id)) {
      links.push({ organizationId: org.id, role: undefined, isPrimary: links.length === 0 });
    }
    await fetch(`/api/metworkcrm/contacts/${addContactValue.id}/organizations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizations: links }),
    });
    setAddContactValue(null);
    setLinking(false);
    refresh();
  }

  return (
    <div className="space-y-6">
      {/* Header — everything about the org itself, no digging */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-[var(--crm-black)]">{org.name}</h1>
              <Badge variant={RECORD_STATUS_BADGE[org.status] ?? 'default'}>{RECORD_STATUS_LABELS[org.status] ?? org.status}</Badge>
            </div>
            <p className="text-sm text-neutral-500">
              {ORG_TYPE_LABELS[org.type] ?? org.type}
              {org.sector ? ` · ${org.sector}` : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-neutral-600">
              {org.city ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-neutral-400" aria-hidden /> {org.city}
                </span>
              ) : null}
              {org.email ? (
                <a href={`mailto:${org.email}`} className="inline-flex items-center gap-1.5 hover:text-[var(--crm-green)]">
                  <Mail className="size-3.5 text-neutral-400" aria-hidden /> {org.email}
                </a>
              ) : null}
              {org.phone ? (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5 text-neutral-400" aria-hidden /> {org.phone}
                </span>
              ) : null}
              {org.website ? (
                <a href={org.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-[var(--crm-green)]">
                  <Globe className="size-3.5 text-neutral-400" aria-hidden /> Site web
                </a>
              ) : null}
              {org.linkedinUrl ? (
                <a href={org.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-[var(--crm-green)]">
                  <Linkedin className="size-3.5 text-neutral-400" aria-hidden /> LinkedIn
                </a>
              ) : null}
            </div>
            {org.description ? <p className="mt-3 max-w-2xl text-sm text-neutral-600">{org.description}</p> : null}
            {org.notes ? (
              <p className="mt-2 max-w-2xl rounded-md bg-neutral-50 p-2 text-xs text-neutral-500">{org.notes}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 gap-2">
            <OrganizationFormDialog
              organization={org}
              onSaved={refresh}
              trigger={<CrmButton variant="outline" size="sm">Modifier</CrmButton>}
            />
            {org.status !== 'ARCHIVE' ? (
              <CrmButton variant="outline" size="sm" onClick={onArchive}>
                Archiver
              </CrmButton>
            ) : null}
            <CrmButton variant="destructive" size="sm" loading={deleting} onClick={onDelete}>
              Supprimer
            </CrmButton>
          </div>
        </div>
        {deleteError ? (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {deleteError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Timeline organizationId={org.id} entityLabel={org.name} />
        </div>

        <div className="space-y-6">
          {/* Contacts */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--crm-black)]">
              Contacts <span className="font-normal text-neutral-400">({data.contacts.length})</span>
            </h3>
            <ul className="mb-3 space-y-2">
              {data.contacts.map((c) => (
                <li key={c.id}>
                  <a
                    href={`/metworkcrm/contacts/${c.id}`}
                    className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-neutral-50"
                  >
                    {c.isPrimary ? <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-hidden /> : <span className="size-3.5 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate text-[var(--crm-black)]">{c.fullName ?? `${c.firstName} ${c.lastName}`}</span>
                    {c.role ? <span className="shrink-0 text-xs text-neutral-400">{c.role}</span> : null}
                  </a>
                </li>
              ))}
              {data.contacts.length === 0 ? <li className="text-sm text-neutral-400">Aucun contact lié.</li> : null}
            </ul>
            <div className="flex items-center gap-1.5">
              <div className="flex-1">
                <EntityPicker kind="contact" value={addContactValue} onChange={setAddContactValue} />
              </div>
              <CrmButton size="sm" variant="outline" disabled={!addContactValue} loading={linking} onClick={linkExistingContact}>
                Lier
              </CrmButton>
            </div>
            <ContactFormDialog
              presetOrganization={{ id: org.id, label: org.name }}
              onSaved={refresh}
              trigger={
                <CrmButton size="sm" variant="ghost" className="mt-1.5 w-full">
                  <UserPlus className="size-3.5" aria-hidden /> Nouveau contact
                </CrmButton>
              }
            />
          </div>

          {/* Tasks */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--crm-black)]">
                Tâches <span className="font-normal text-neutral-400">({data.tasks.length})</span>
              </h3>
              <TaskFormDialog
                lockedOrganizationId={org.id}
                lockedOrganizationLabel={org.name}
                onSaved={refresh}
                trigger={
                  <button type="button" className="inline-flex size-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600">
                    <Plus className="size-4" aria-hidden />
                  </button>
                }
              />
            </div>
            <ul className="space-y-2">
              {data.tasks.map((t) => (
                <TaskFormDialog
                  key={t.id}
                  task={t}
                  lockedOrganizationId={org.id}
                  lockedOrganizationLabel={org.name}
                  onSaved={refresh}
                  trigger={
                    <li className="cursor-pointer rounded-md p-1.5 text-sm hover:bg-neutral-50">
                      <div className="flex items-center gap-2">
                        <Badge variant={TASK_PRIORITY_BADGE[t.priority] ?? 'default'}>{TASK_PRIORITY_LABELS[t.priority] ?? t.priority}</Badge>
                        <span className="min-w-0 flex-1 truncate text-[var(--crm-black)]">{t.title}</span>
                      </div>
                      <p className="ms-0.5 mt-0.5 text-xs text-neutral-400">
                        {TASK_STATUS_LABELS[t.status] ?? t.status}
                        {t.dueDate ? ` · ${t.dueDate}` : ''}
                      </p>
                    </li>
                  }
                />
              ))}
              {data.tasks.length === 0 ? <li className="text-sm text-neutral-400">Aucune tâche.</li> : null}
            </ul>
          </div>

          {/* Opportunities — Prompt 3 module; always empty for now, and that's correct */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-[var(--crm-black)]">Opportunités</h3>
            <p className="text-sm text-neutral-400">
              {data.opportunities.length === 0 ? 'Module disponible prochainement.' : `${data.opportunities.length} opportunité(s).`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
