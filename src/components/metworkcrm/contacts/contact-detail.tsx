'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Linkedin, Mail, MapPin, MessageCircle, Phone, Plus, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { Timeline } from '@/components/metworkcrm/interactions/timeline';
import { TaskFormDialog, type TaskRow } from '@/components/metworkcrm/tasks/task-form-dialog';
import { OpportunityFormDialog, type OpportunityRow } from '@/components/metworkcrm/opportunities/opportunity-form-dialog';
import { DocumentUpload, type DocumentRow } from '@/components/metworkcrm/shared/document-upload';
import {
  CONTACT_LANGUAGE_LABELS,
  OPPORTUNITY_STAGE_BADGE,
  OPPORTUNITY_STAGE_LABELS,
  RECORD_STATUS_BADGE,
  RECORD_STATUS_LABELS,
  TASK_PRIORITY_BADGE,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from '@/components/metworkcrm/shared/labels';
import { ContactFormDialog, type ContactRow } from './contact-form-dialog';
import { ContactOrganizationsEditor, type LinkedOrganization } from './contact-organizations-editor';

export interface ContactDetailData {
  contact: ContactRow;
  organizations: LinkedOrganization[];
  tasks: TaskRow[];
  opportunities: OpportunityRow[];
  documents: DocumentRow[];
}

export function ContactDetail({ initial }: { initial: ContactDetailData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const res = await fetch(`/api/metworkcrm/contacts/${initial.contact.id}`);
    if (res.ok) setData(await res.json());
    refreshing.current = false;
  }, [initial.contact.id]);

  const contact = data.contact;
  // `full_name` is a STORED GENERATED column — drizzle types it nullable even
  // though it's computed from two NOT NULL columns and is never actually null.
  const displayName = contact.fullName ?? `${contact.firstName} ${contact.lastName}`;

  async function onDelete() {
    if (!confirm(`Supprimer « ${displayName} » ? Cette action est irréversible.`)) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/metworkcrm/contacts/${contact.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/metworkcrm/contacts');
      return;
    }
    const body = await res.json().catch(() => null);
    setDeleteError(body?.error?.message ?? 'Suppression impossible.');
    setDeleting(false);
  }

  async function onArchive() {
    await fetch(`/api/metworkcrm/contacts/${contact.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ARCHIVE' }),
    });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-[var(--crm-black)]">{displayName}</h1>
              <Badge variant={RECORD_STATUS_BADGE[contact.status] ?? 'default'}>
                {RECORD_STATUS_LABELS[contact.status] ?? contact.status}
              </Badge>
            </div>
            <p className="text-sm text-neutral-500">
              {contact.position ?? '—'}
              {contact.language ? ` · ${CONTACT_LANGUAGE_LABELS[contact.language] ?? contact.language}` : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-neutral-600">
              {contact.city ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-neutral-400" aria-hidden /> {contact.city}
                </span>
              ) : null}
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1.5 hover:text-[var(--crm-green)]">
                  <Mail className="size-3.5 text-neutral-400" aria-hidden /> {contact.email}
                </a>
              ) : null}
              {contact.phone ? (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5 text-neutral-400" aria-hidden /> {contact.phone}
                </span>
              ) : null}
              {contact.whatsapp ? (
                <span className="inline-flex items-center gap-1.5">
                  <MessageCircle className="size-3.5 text-neutral-400" aria-hidden /> {contact.whatsapp}
                </span>
              ) : null}
              {contact.linkedinUrl ? (
                <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-[var(--crm-green)]">
                  <Linkedin className="size-3.5 text-neutral-400" aria-hidden /> LinkedIn
                </a>
              ) : null}
            </div>
            {contact.notes ? (
              <p className="mt-3 max-w-2xl rounded-md bg-neutral-50 p-2 text-xs text-neutral-500">{contact.notes}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 gap-2">
            <ContactFormDialog contact={contact} onSaved={refresh} trigger={<CrmButton variant="outline" size="sm">Modifier</CrmButton>} />
            {contact.status !== 'ARCHIVE' ? (
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
          <Timeline contactId={contact.id} entityLabel={displayName} />
        </div>

        <div className="space-y-6">
          {/* Organizations */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--crm-black)]">
                Organisations <span className="font-normal text-neutral-400">({data.organizations.length})</span>
              </h3>
              <ContactOrganizationsEditor
                contactId={contact.id}
                organizations={data.organizations}
                onSaved={refresh}
                trigger={
                  <button type="button" className="inline-flex size-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600">
                    <Plus className="size-4" aria-hidden />
                  </button>
                }
              />
            </div>
            <ul className="space-y-2">
              {data.organizations.map((o) => (
                <li key={o.id}>
                  <a href={`/metworkcrm/organizations/${o.id}`} className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-neutral-50">
                    {o.isPrimary ? (
                      <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-hidden />
                    ) : (
                      <Building2 className="size-3.5 shrink-0 text-neutral-300" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[var(--crm-black)]">{o.name}</span>
                    {o.role ? <span className="shrink-0 text-xs text-neutral-400">{o.role}</span> : null}
                  </a>
                </li>
              ))}
              {data.organizations.length === 0 ? <li className="text-sm text-neutral-400">Aucune organisation liée.</li> : null}
            </ul>
          </div>

          {/* Tasks */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--crm-black)]">
                Tâches <span className="font-normal text-neutral-400">({data.tasks.length})</span>
              </h3>
              <TaskFormDialog
                lockedContactId={contact.id}
                lockedContactLabel={displayName}
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
                  lockedContactId={contact.id}
                  lockedContactLabel={displayName}
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

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--crm-black)]">
                Opportunités <span className="font-normal text-neutral-400">({data.opportunities.length})</span>
              </h3>
              <OpportunityFormDialog
                lockedContactId={contact.id}
                lockedContactLabel={displayName}
                onSaved={refresh}
                trigger={
                  <button type="button" className="inline-flex size-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600">
                    <Plus className="size-4" aria-hidden />
                  </button>
                }
              />
            </div>
            <ul className="space-y-2">
              {data.opportunities.map((o) => (
                <li key={o.id}>
                  <a href={`/metworkcrm/sales/${o.id}`} className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-neutral-50">
                    <span className="min-w-0 flex-1 truncate text-[var(--crm-black)]">{o.title}</span>
                    <Badge variant={OPPORTUNITY_STAGE_BADGE[o.stage] ?? 'default'}>{OPPORTUNITY_STAGE_LABELS[o.stage] ?? o.stage}</Badge>
                  </a>
                </li>
              ))}
              {data.opportunities.length === 0 ? <li className="text-sm text-neutral-400">Aucune opportunité.</li> : null}
            </ul>
          </div>

          <DocumentUpload entityType="CONTACT" entityId={contact.id} initial={data.documents} />
        </div>
      </div>
    </div>
  );
}
