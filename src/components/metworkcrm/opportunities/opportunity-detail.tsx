'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { Timeline } from '@/components/metworkcrm/interactions/timeline';
import { TaskFormDialog, type TaskRow } from '@/components/metworkcrm/tasks/task-form-dialog';
import { DocumentUpload, type DocumentRow } from '@/components/metworkcrm/shared/document-upload';
import {
  OPPORTUNITY_STAGE_BADGE,
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_TYPE_LABELS,
  TASK_PRIORITY_BADGE,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from '@/components/metworkcrm/shared/labels';
import { OpportunityFormDialog, type OpportunityRow } from './opportunity-form-dialog';

interface StageHistoryRow {
  id: string;
  fromStage: string | null;
  toStage: string;
  changedAt: string;
}

export interface OpportunityDetailData {
  opportunity: OpportunityRow;
  organization: { id: string; name: string } | null;
  contact: { id: string; fullName: string | null; firstName: string; lastName: string } | null;
  tasks: TaskRow[];
  stageHistory: StageHistoryRow[];
  documents: DocumentRow[];
}

export function OpportunityDetail({ initial }: { initial: OpportunityDetailData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const res = await fetch(`/api/metworkcrm/opportunities/${initial.opportunity.id}`);
    if (res.ok) setData(await res.json());
    refreshing.current = false;
  }, [initial.opportunity.id]);

  const opp = data.opportunity;

  async function onDelete() {
    if (!confirm(`Supprimer « ${opp.title} » ? Cette action est irréversible.`)) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/metworkcrm/opportunities/${opp.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/metworkcrm/sales');
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
              <h1 className="text-xl font-semibold text-[var(--crm-black)]">{opp.title}</h1>
              <Badge variant={OPPORTUNITY_STAGE_BADGE[opp.stage] ?? 'default'}>{OPPORTUNITY_STAGE_LABELS[opp.stage] ?? opp.stage}</Badge>
            </div>
            <p className="text-sm text-neutral-500">
              {OPPORTUNITY_TYPE_LABELS[opp.type] ?? opp.type}
              {opp.amount != null ? ` · ${opp.amount.toLocaleString('fr-FR')} DZD` : ''}
              {opp.probability != null ? ` · ${opp.probability}% probabilité` : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-neutral-600">
              {data.organization ? (
                <a href={`/metworkcrm/organizations/${data.organization.id}`} className="hover:text-[var(--crm-green)]">
                  {data.organization.name}
                </a>
              ) : null}
              {data.contact ? (
                <a href={`/metworkcrm/contacts/${data.contact.id}`} className="hover:text-[var(--crm-green)]">
                  {data.contact.fullName ?? `${data.contact.firstName} ${data.contact.lastName}`}
                </a>
              ) : null}
              {opp.expectedCloseDate ? <span>Clôture prévue : {opp.expectedCloseDate}</span> : null}
            </div>
            {opp.description ? <p className="mt-3 max-w-2xl text-sm text-neutral-600">{opp.description}</p> : null}
          </div>

          <div className="flex shrink-0 gap-2">
            <OpportunityFormDialog
              opportunity={opp}
              lockedOrganizationId={data.organization?.id}
              lockedContactId={data.contact?.id}
              onSaved={refresh}
              trigger={<CrmButton variant="outline" size="sm">Modifier</CrmButton>}
            />
            <CrmButton variant="destructive" size="sm" loading={deleting} onClick={onDelete}>Supprimer</CrmButton>
          </div>
        </div>
        {deleteError ? (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Timeline opportunityId={opp.id} entityLabel={opp.title} />

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--crm-black)]">Historique des étapes</h3>
            {data.stageHistory.length === 0 ? (
              <p className="text-sm text-neutral-400">Aucun changement enregistré.</p>
            ) : (
              <ol className="space-y-2 border-s border-neutral-200 ps-4 text-sm">
                {data.stageHistory.map((h) => (
                  <li key={h.id} className="text-neutral-600">
                    {h.fromStage ? `${OPPORTUNITY_STAGE_LABELS[h.fromStage] ?? h.fromStage} → ` : 'Créée en '}
                    <span className="font-medium text-[var(--crm-black)]">{OPPORTUNITY_STAGE_LABELS[h.toStage] ?? h.toStage}</span>
                    <span className="ms-2 text-xs text-neutral-400">{new Date(h.changedAt).toLocaleString('fr-FR')}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--crm-black)]">
                Tâches <span className="font-normal text-neutral-400">({data.tasks.length})</span>
              </h3>
              <TaskFormDialog
                lockedOpportunityId={opp.id}
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
                  lockedOpportunityId={opp.id}
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

          <DocumentUpload entityType="OPPORTUNITY" entityId={opp.id} initial={data.documents} />
        </div>
      </div>
    </div>
  );
}
