'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { EntityPicker } from '@/components/metworkcrm/shared/entity-picker';
import { Timeline } from '@/components/metworkcrm/interactions/timeline';
import { TaskFormDialog, type TaskRow } from '@/components/metworkcrm/tasks/task-form-dialog';
import { DocumentUpload, type DocumentRow } from '@/components/metworkcrm/shared/document-upload';
import {
  PARTNERSHIP_STAGE_BADGE,
  PARTNERSHIP_STAGE_LABELS,
  PARTNERSHIP_TYPE_LABELS,
  TASK_PRIORITY_BADGE,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from '@/components/metworkcrm/shared/labels';
import { PartnershipFormDialog, type PartnershipRow } from './partnership-form-dialog';

interface LinkedContact {
  id: string;
  fullName: string | null;
  firstName: string;
  lastName: string;
  role: string | null;
}

export interface PartnershipDetailData {
  partnership: PartnershipRow;
  organization: { id: string; name: string } | null;
  contacts: LinkedContact[];
  tasks: TaskRow[];
  documents: DocumentRow[];
}

export function PartnershipDetail({ initial }: { initial: PartnershipDetailData }) {
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
    const res = await fetch(`/api/metworkcrm/partnerships/${initial.partnership.id}`);
    if (res.ok) setData(await res.json());
    refreshing.current = false;
  }, [initial.partnership.id]);

  const partnership = data.partnership;

  async function onDelete() {
    if (!confirm(`Supprimer « ${partnership.name} » ? Cette action est irréversible.`)) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/metworkcrm/partnerships/${partnership.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/metworkcrm/partnerships');
      return;
    }
    const body = await res.json().catch(() => null);
    setDeleteError(body?.error?.message ?? 'Suppression impossible.');
    setDeleting(false);
  }

  async function linkExistingContact() {
    if (!addContactValue) return;
    setLinking(true);
    const nextContacts = [
      ...data.contacts.map((c) => ({ contactId: c.id, role: c.role ?? undefined })),
      { contactId: addContactValue.id },
    ];
    await fetch(`/api/metworkcrm/partnerships/${partnership.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts: nextContacts }),
    });
    setAddContactValue(null);
    setLinking(false);
    refresh();
  }

  async function unlinkContact(contactId: string) {
    const nextContacts = data.contacts.filter((c) => c.id !== contactId).map((c) => ({ contactId: c.id, role: c.role ?? undefined }));
    await fetch(`/api/metworkcrm/partnerships/${partnership.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts: nextContacts }),
    });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-[var(--crm-black)]">{partnership.name}</h1>
              <Badge variant={PARTNERSHIP_STAGE_BADGE[partnership.stage] ?? 'default'}>
                {PARTNERSHIP_STAGE_LABELS[partnership.stage] ?? partnership.stage}
              </Badge>
            </div>
            <p className="text-sm text-neutral-500">
              {PARTNERSHIP_TYPE_LABELS[partnership.type] ?? partnership.type}
              {partnership.valueAmount != null ? ` · ${partnership.valueAmount.toLocaleString('fr-FR')} DZD` : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-neutral-600">
              {data.organization ? (
                <a href={`/metworkcrm/organizations/${data.organization.id}`} className="hover:text-[var(--crm-green)]">{data.organization.name}</a>
              ) : null}
              {partnership.startDate ? <span>Début : {partnership.startDate}</span> : null}
              {partnership.endDate ? <span>Fin : {partnership.endDate}</span> : null}
              {partnership.renewalDate ? <span>Renouvellement : {partnership.renewalDate}</span> : null}
            </div>
            {partnership.description ? <p className="mt-3 max-w-2xl text-sm text-neutral-600">{partnership.description}</p> : null}
          </div>

          <div className="flex shrink-0 gap-2">
            <PartnershipFormDialog
              partnership={partnership}
              lockedOrganizationId={data.organization?.id}
              lockedOrganizationLabel={data.organization?.name}
              onSaved={refresh}
              trigger={<CrmButton variant="outline" size="sm">Modifier</CrmButton>}
            />
            <CrmButton variant="destructive" size="sm" loading={deleting} onClick={onDelete}>Supprimer</CrmButton>
          </div>
        </div>
        {deleteError ? <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Timeline partnershipId={partnership.id} entityLabel={partnership.name} />
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--crm-black)]">
              Contacts <span className="font-normal text-neutral-400">({data.contacts.length})</span>
            </h3>
            <ul className="mb-3 space-y-2">
              {data.contacts.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-neutral-50">
                  <a href={`/metworkcrm/contacts/${c.id}`} className="min-w-0 flex-1 truncate text-[var(--crm-black)]">
                    {c.fullName ?? `${c.firstName} ${c.lastName}`}
                  </a>
                  <button type="button" onClick={() => unlinkContact(c.id)} className="shrink-0 text-xs text-neutral-400 hover:text-red-600">
                    Retirer
                  </button>
                </li>
              ))}
              {data.contacts.length === 0 ? <li className="text-sm text-neutral-400">Aucun contact lié.</li> : null}
            </ul>
            <div className="flex items-center gap-1.5">
              <div className="flex-1">
                <EntityPicker kind="contact" value={addContactValue} onChange={setAddContactValue} />
              </div>
              <CrmButton size="sm" variant="outline" disabled={!addContactValue} loading={linking} onClick={linkExistingContact}>Lier</CrmButton>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--crm-black)]">
                Tâches <span className="font-normal text-neutral-400">({data.tasks.length})</span>
              </h3>
              <TaskFormDialog
                lockedPartnershipId={partnership.id}
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
                  lockedPartnershipId={partnership.id}
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

          <DocumentUpload entityType="PARTNERSHIP" entityId={partnership.id} initial={data.documents} />
        </div>
      </div>
    </div>
  );
}
