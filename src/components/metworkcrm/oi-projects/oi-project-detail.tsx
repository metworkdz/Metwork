'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { EntityPicker } from '@/components/metworkcrm/shared/entity-picker';
import { Timeline } from '@/components/metworkcrm/interactions/timeline';
import { StagePipeline } from '@/components/metworkcrm/shared/stage-pipeline';
import { DocumentUpload, type DocumentRow } from '@/components/metworkcrm/shared/document-upload';
import { TaskFormDialog, type TaskRow } from '@/components/metworkcrm/tasks/task-form-dialog';
import {
  OI_PARTICIPANT_STATUS_LABELS,
  OI_STAGE_LABELS,
  TASK_PRIORITY_BADGE,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from '@/components/metworkcrm/shared/labels';
import { OI_STAGES } from '@/server/metworkcrm/db/schema';
import { OiProjectFormDialog, type OiProjectRow } from './oi-project-form-dialog';

interface Mobilized {
  id: string;
  mobilizationId: string;
  name: string | null;
  displayNameCache: string | null;
  role: string | null;
  status: string;
}

export interface OiProjectDetailData {
  project: OiProjectRow;
  organization: { id: string; name: string } | null;
  contact: { id: string; fullName: string | null; firstName: string; lastName: string } | null;
  partnership: { id: string; name: string } | null;
  startups: Mobilized[];
  experts: Mobilized[];
  tasks: TaskRow[];
  documents: DocumentRow[];
}

const inlineSelectClass =
  'h-7 rounded-md border border-neutral-200 bg-white px-1.5 text-xs outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function OiProjectDetail({ initial }: { initial: OiProjectDetailData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [addStartup, setAddStartup] = useState<{ id: string; label: string } | null>(null);
  const [addExpert, setAddExpert] = useState<{ id: string; label: string } | null>(null);
  const [mobilizing, setMobilizing] = useState(false);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const res = await fetch(`/api/metworkcrm/oi-projects/${initial.project.id}`);
    if (res.ok) setData(await res.json());
    refreshing.current = false;
  }, [initial.project.id]);

  const project = data.project;

  async function onDelete() {
    if (!confirm(`Supprimer « ${project.title} » ? Cette action est irréversible.`)) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/metworkcrm/oi-projects/${project.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/metworkcrm/open-innovation');
      return;
    }
    const body = await res.json().catch(() => null);
    setDeleteError(body?.error?.message ?? 'Suppression impossible.');
    setDeleting(false);
  }

  async function changeStage(next: string) {
    setData((d) => ({ ...d, project: { ...d.project, stage: next } }));
    const res = await fetch(`/api/metworkcrm/oi-projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: next }),
    });
    if (!res.ok) refresh();
  }

  async function mobilizeStartup() {
    if (!addStartup) return;
    setMobilizing(true);
    await fetch(`/api/metworkcrm/oi-projects/${project.id}/startups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startupId: addStartup.id, status: 'PRESSENTIE' }),
    });
    setAddStartup(null);
    setMobilizing(false);
    refresh();
  }

  async function mobilizeExpert() {
    if (!addExpert) return;
    setMobilizing(true);
    await fetch(`/api/metworkcrm/oi-projects/${project.id}/experts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expertId: addExpert.id, status: 'PRESSENTIE' }),
    });
    setAddExpert(null);
    setMobilizing(false);
    refresh();
  }

  async function changeStartupStatus(mobilizationId: string, status: string) {
    await fetch(`/api/metworkcrm/oi-projects/${project.id}/startups/${mobilizationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    refresh();
  }

  async function changeExpertStatus(mobilizationId: string, status: string) {
    await fetch(`/api/metworkcrm/oi-projects/${project.id}/experts/${mobilizationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    refresh();
  }

  async function removeStartup(mobilizationId: string) {
    await fetch(`/api/metworkcrm/oi-projects/${project.id}/startups/${mobilizationId}`, { method: 'DELETE' });
    refresh();
  }

  async function removeExpert(mobilizationId: string) {
    await fetch(`/api/metworkcrm/oi-projects/${project.id}/experts/${mobilizationId}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="mb-2 text-xl font-semibold text-[var(--crm-black)]">{project.title}</h1>
            <StagePipeline stages={OI_STAGES} labels={OI_STAGE_LABELS} current={project.stage} onChange={changeStage} />
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-neutral-600">
              {data.organization ? (
                <a href={`/metworkcrm/organizations/${data.organization.id}`} className="hover:text-[var(--crm-green)]">{data.organization.name}</a>
              ) : null}
              {data.contact ? (
                <a href={`/metworkcrm/contacts/${data.contact.id}`} className="hover:text-[var(--crm-green)]">
                  {data.contact.fullName ?? `${data.contact.firstName} ${data.contact.lastName}`}
                </a>
              ) : null}
              {data.partnership ? (
                <a href={`/metworkcrm/partnerships/${data.partnership.id}`} className="hover:text-[var(--crm-green)]">{data.partnership.name}</a>
              ) : null}
              {project.budget != null ? <span>Budget : {project.budget.toLocaleString('fr-FR')} DZD</span> : null}
            </div>
            {project.problemStatement ? (
              <p className="mt-3 max-w-2xl text-sm text-neutral-600"><strong>Problème :</strong> {project.problemStatement}</p>
            ) : null}
            {project.challengeStatement ? (
              <p className="mt-1 max-w-2xl text-sm text-neutral-600"><strong>Défi :</strong> {project.challengeStatement}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 gap-2">
            <OiProjectFormDialog project={project} onSaved={refresh} trigger={<CrmButton variant="outline" size="sm">Modifier</CrmButton>} />
            <CrmButton variant="destructive" size="sm" loading={deleting} onClick={onDelete}>Supprimer</CrmButton>
          </div>
        </div>
        {deleteError ? <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Timeline oiProjectId={project.id} entityLabel={project.title} />

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--crm-black)]">
              Startups mobilisées <span className="font-normal text-neutral-400">({data.startups.length})</span>
            </h3>
            <ul className="mb-3 space-y-2">
              {data.startups.map((s) => (
                <li key={s.mobilizationId} className="flex items-center gap-2 rounded-md p-1.5 text-sm">
                  <a href={`/metworkcrm/startups/${s.id}`} className="min-w-0 flex-1 truncate text-[var(--crm-black)] hover:text-[var(--crm-green)]">
                    {s.displayNameCache ?? s.name}
                  </a>
                  {s.role ? <span className="shrink-0 text-xs text-neutral-400">{s.role}</span> : null}
                  <select
                    value={s.status}
                    onChange={(e) => changeStartupStatus(s.mobilizationId, e.target.value)}
                    className={inlineSelectClass}
                  >
                    {Object.entries(OI_PARTICIPANT_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeStartup(s.mobilizationId)} className="shrink-0 text-xs text-neutral-400 hover:text-red-600">
                    Retirer
                  </button>
                </li>
              ))}
              {data.startups.length === 0 ? <li className="text-sm text-neutral-400">Aucune startup mobilisée.</li> : null}
            </ul>
            <div className="flex items-center gap-1.5">
              <div className="flex-1"><EntityPicker kind="startup" value={addStartup} onChange={setAddStartup} /></div>
              <CrmButton size="sm" variant="outline" disabled={!addStartup} loading={mobilizing} onClick={mobilizeStartup}>Mobiliser</CrmButton>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--crm-black)]">
              Experts mobilisés <span className="font-normal text-neutral-400">({data.experts.length})</span>
            </h3>
            <ul className="mb-3 space-y-2">
              {data.experts.map((x) => (
                <li key={x.mobilizationId} className="flex items-center gap-2 rounded-md p-1.5 text-sm">
                  <a href={`/metworkcrm/experts/${x.id}`} className="min-w-0 flex-1 truncate text-[var(--crm-black)] hover:text-[var(--crm-green)]">
                    {x.displayNameCache ?? x.name}
                  </a>
                  {x.role ? <span className="shrink-0 text-xs text-neutral-400">{x.role}</span> : null}
                  <select
                    value={x.status}
                    onChange={(e) => changeExpertStatus(x.mobilizationId, e.target.value)}
                    className={inlineSelectClass}
                  >
                    {Object.entries(OI_PARTICIPANT_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeExpert(x.mobilizationId)} className="shrink-0 text-xs text-neutral-400 hover:text-red-600">
                    Retirer
                  </button>
                </li>
              ))}
              {data.experts.length === 0 ? <li className="text-sm text-neutral-400">Aucun expert mobilisé.</li> : null}
            </ul>
            <div className="flex items-center gap-1.5">
              <div className="flex-1"><EntityPicker kind="expert" value={addExpert} onChange={setAddExpert} /></div>
              <CrmButton size="sm" variant="outline" disabled={!addExpert} loading={mobilizing} onClick={mobilizeExpert}>Mobiliser</CrmButton>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--crm-black)]">
                Tâches <span className="font-normal text-neutral-400">({data.tasks.length})</span>
              </h3>
              <TaskFormDialog
                lockedOiProjectId={project.id}
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
                  lockedOiProjectId={project.id}
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

          <DocumentUpload entityType="OI_PROJECT" entityId={project.id} initial={data.documents} />
        </div>
      </div>
    </div>
  );
}
