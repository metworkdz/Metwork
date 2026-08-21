'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, MapPin, Phone, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { Timeline } from '@/components/metworkcrm/interactions/timeline';
import { TaskFormDialog, type TaskRow } from '@/components/metworkcrm/tasks/task-form-dialog';
import { DocumentUpload, type DocumentRow } from '@/components/metworkcrm/shared/document-upload';
import {
  EXPERT_STAGE_BADGE,
  EXPERT_STAGE_LABELS,
  TASK_PRIORITY_BADGE,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from '@/components/metworkcrm/shared/labels';
import { ExpertFormDialog, type ExpertRow } from './expert-form-dialog';

export interface ExpertDetailData {
  expert: ExpertRow;
  organization: { id: string; name: string } | null;
  contact: { id: string; fullName: string | null; firstName: string; lastName: string } | null;
  tasks: TaskRow[];
  documents: DocumentRow[];
}

export function ExpertDetail({ initial }: { initial: ExpertDetailData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const res = await fetch(`/api/metworkcrm/experts/${initial.expert.id}`);
    if (res.ok) setData(await res.json());
    refreshing.current = false;
  }, [initial.expert.id]);

  const expert = data.expert;
  const displayName = expert.displayNameCache ?? expert.name ?? '';

  async function onDelete() {
    if (!confirm(`Supprimer « ${displayName} » ? Cette action est irréversible.`)) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/metworkcrm/experts/${expert.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/metworkcrm/experts');
      return;
    }
    const body = await res.json().catch(() => null);
    setDeleteError(body?.error?.message ?? 'Suppression impossible.');
    setDeleting(false);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-[var(--crm-black)]">{displayName}</h1>
              <Badge variant={EXPERT_STAGE_BADGE[expert.pipelineStage] ?? 'default'}>
                {EXPERT_STAGE_LABELS[expert.pipelineStage] ?? expert.pipelineStage}
              </Badge>
            </div>
            <p className="text-sm text-neutral-500">{expert.specialties.length > 0 ? expert.specialties.join(', ') : '—'}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-neutral-600">
              {expert.city ? (
                <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5 text-neutral-400" aria-hidden /> {expert.city}</span>
              ) : null}
              {expert.email ? (
                <a href={`mailto:${expert.email}`} className="inline-flex items-center gap-1.5 hover:text-[var(--crm-green)]">
                  <Mail className="size-3.5 text-neutral-400" aria-hidden /> {expert.email}
                </a>
              ) : null}
              {expert.phone ? (
                <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5 text-neutral-400" aria-hidden /> {expert.phone}</span>
              ) : null}
              {data.organization ? (
                <a href={`/metworkcrm/organizations/${data.organization.id}`} className="hover:text-[var(--crm-green)]">{data.organization.name}</a>
              ) : null}
              {data.contact ? (
                <a href={`/metworkcrm/contacts/${data.contact.id}`} className="hover:text-[var(--crm-green)]">
                  {data.contact.fullName ?? `${data.contact.firstName} ${data.contact.lastName}`}
                </a>
              ) : null}
            </div>
            {expert.dailyRate != null ? (
              <p className="mt-2 text-sm text-neutral-600">Taux journalier : {expert.dailyRate.toLocaleString('fr-FR')} DZD</p>
            ) : null}
            {expert.internalNotes ? (
              <p className="mt-2 max-w-2xl rounded-md bg-neutral-50 p-2 text-xs text-neutral-500">{expert.internalNotes}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 gap-2">
            <ExpertFormDialog expert={expert} onSaved={refresh} trigger={<CrmButton variant="outline" size="sm">Modifier</CrmButton>} />
            <CrmButton variant="destructive" size="sm" loading={deleting} onClick={onDelete}>Supprimer</CrmButton>
          </div>
        </div>
        {deleteError ? <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Timeline expertId={expert.id} entityLabel={displayName} />
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--crm-black)]">
                Tâches <span className="font-normal text-neutral-400">({data.tasks.length})</span>
              </h3>
              <TaskFormDialog
                lockedExpertId={expert.id}
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
                  lockedExpertId={expert.id}
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

          <DocumentUpload entityType="EXPERT" entityId={expert.id} initial={data.documents} />
        </div>
      </div>
    </div>
  );
}
