'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { EntityPicker } from '@/components/metworkcrm/shared/entity-picker';
import { Timeline } from '@/components/metworkcrm/interactions/timeline';
import { StagePipeline } from '@/components/metworkcrm/shared/stage-pipeline';
import { TaskFormDialog, type TaskRow } from '@/components/metworkcrm/tasks/task-form-dialog';
import { DocumentUpload, type DocumentRow } from '@/components/metworkcrm/shared/document-upload';
import {
  PARTICIPANT_STATUS_LABELS,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABELS,
  PROGRAM_STAGE_LABELS,
  PROGRAM_TYPE_LABELS,
  TASK_PRIORITY_BADGE,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from '@/components/metworkcrm/shared/labels';
import { PROGRAM_STAGES } from '@/server/metworkcrm/db/schema';
import { ProgramFormDialog, type ProgramRow } from './program-form-dialog';

interface Participant {
  id: string;
  displayName: string | null;
  contactId: string | null;
  status: string;
  attended: boolean;
}
interface Trainer {
  id: string;
  expertId: string | null;
  expertName: string | null;
  fee: number | null;
  confirmed: boolean;
}
interface Partner {
  id: string;
  displayName: string | null;
}
interface Payment {
  id: string;
  label: string;
  amount: number | null;
  status: string;
  dueDate: string | null;
}

export interface ProgramDetailData {
  program: ProgramRow;
  participants: Participant[];
  trainers: Trainer[];
  partners: Partner[];
  tasks: TaskRow[];
  payments: Payment[];
  documents: DocumentRow[];
}

const inlineSelectClass =
  'h-7 rounded-md border border-neutral-200 bg-white px-1.5 text-xs outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function ProgramDetail({ initial, isAdmin }: { initial: ProgramDetailData; isAdmin: boolean }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [addContact, setAddContact] = useState<{ id: string; label: string } | null>(null);
  const [walkInName, setWalkInName] = useState('');
  const [addExpert, setAddExpert] = useState<{ id: string; label: string } | null>(null);
  const [trainerFee, setTrainerFee] = useState('');
  const [addPartnership, setAddPartnership] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [payLabel, setPayLabel] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const res = await fetch(`/api/metworkcrm/programs/${initial.program.id}`);
    if (res.ok) setData(await res.json());
    refreshing.current = false;
  }, [initial.program.id]);

  const program = data.program;

  async function onDelete() {
    if (!confirm(`Supprimer « ${program.title} » ? Cette action est irréversible.`)) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/metworkcrm/programs/${program.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/metworkcrm/programs');
      return;
    }
    const body = await res.json().catch(() => null);
    setDeleteError(body?.error?.message ?? 'Suppression impossible.');
    setDeleting(false);
  }

  async function changeStage(next: string) {
    setData((d) => ({ ...d, program: { ...d.program, stage: next } }));
    const res = await fetch(`/api/metworkcrm/programs/${program.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: next }),
    });
    if (!res.ok) refresh();
  }

  async function registerParticipant() {
    if (!addContact && !walkInName.trim()) return;
    setBusy(true);
    await fetch(`/api/metworkcrm/programs/${program.id}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: addContact?.id, fullName: !addContact ? walkInName.trim() : undefined, status: 'INSCRIT' }),
    });
    setAddContact(null);
    setWalkInName('');
    setBusy(false);
    refresh();
  }

  async function changeParticipantStatus(id: string, status: string) {
    await fetch(`/api/metworkcrm/programs/${program.id}/participants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    refresh();
  }

  async function removeParticipant(id: string) {
    await fetch(`/api/metworkcrm/programs/${program.id}/participants/${id}`, { method: 'DELETE' });
    refresh();
  }

  async function addTrainer() {
    if (!addExpert) return;
    setBusy(true);
    await fetch(`/api/metworkcrm/programs/${program.id}/trainers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expertId: addExpert.id, fee: trainerFee ? Number(trainerFee) : undefined }),
    });
    setAddExpert(null);
    setTrainerFee('');
    setBusy(false);
    refresh();
  }

  async function toggleTrainerConfirmed(id: string, confirmed: boolean) {
    await fetch(`/api/metworkcrm/programs/${program.id}/trainers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed }),
    });
    refresh();
  }

  async function removeTrainer(id: string) {
    await fetch(`/api/metworkcrm/programs/${program.id}/trainers/${id}`, { method: 'DELETE' });
    refresh();
  }

  async function addPartner() {
    if (!addPartnership) return;
    setBusy(true);
    await fetch(`/api/metworkcrm/programs/${program.id}/partners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partnershipId: addPartnership.id }),
    });
    setAddPartnership(null);
    setBusy(false);
    refresh();
  }

  async function removePartner(id: string) {
    await fetch(`/api/metworkcrm/programs/${program.id}/partners/${id}`, { method: 'DELETE' });
    refresh();
  }

  async function addPayment() {
    if (!payLabel.trim() || !payAmount) return;
    setBusy(true);
    // Standalone ADMIN-only endpoint (product spec §4.14) — this mini-form is
    // only ever rendered for `isAdmin`, but the route re-enforces the gate
    // itself regardless (requireCrmApiAdmin), so this is safe either way.
    await fetch('/api/metworkcrm/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: payLabel.trim(), amount: Number(payAmount), programId: program.id }),
    });
    setPayLabel('');
    setPayAmount('');
    setBusy(false);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="mb-2 text-xl font-semibold text-[var(--crm-black)]">{program.title}</h1>
            <StagePipeline stages={PROGRAM_STAGES} labels={PROGRAM_STAGE_LABELS} current={program.stage} onChange={changeStage} />
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-neutral-600">
              <span>{PROGRAM_TYPE_LABELS[program.type] ?? program.type}</span>
              {program.city ? <span>{program.city}{program.venue ? ` · ${program.venue}` : ''}</span> : null}
              {program.startDate ? <span>{program.startDate}{program.endDate ? ` → ${program.endDate}` : ''}</span> : null}
              {program.capacity != null ? <span>Capacité : {program.capacity}</span> : null}
              {program.price != null ? <span>Prix : {program.price.toLocaleString('fr-FR')} DZD</span> : null}
            </div>
            {program.description ? <p className="mt-3 max-w-2xl text-sm text-neutral-600">{program.description}</p> : null}
          </div>

          <div className="flex shrink-0 gap-2">
            <ProgramFormDialog program={program} onSaved={refresh} trigger={<CrmButton variant="outline" size="sm">Modifier</CrmButton>} />
            <CrmButton variant="destructive" size="sm" loading={deleting} onClick={onDelete}>Supprimer</CrmButton>
          </div>
        </div>
        {deleteError ? <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Timeline programId={program.id} entityLabel={program.title} />

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--crm-black)]">
              Participants <span className="font-normal text-neutral-400">({data.participants.length})</span>
            </h3>
            <ul className="mb-3 space-y-2">
              {data.participants.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-md p-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-[var(--crm-black)]">{p.displayName}</span>
                  <select value={p.status} onChange={(e) => changeParticipantStatus(p.id, e.target.value)} className={inlineSelectClass}>
                    {Object.entries(PARTICIPANT_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeParticipant(p.id)} className="shrink-0 text-xs text-neutral-400 hover:text-red-600">
                    Retirer
                  </button>
                </li>
              ))}
              {data.participants.length === 0 ? <li className="text-sm text-neutral-400">Aucun participant.</li> : null}
            </ul>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="min-w-[10rem] flex-1"><EntityPicker kind="contact" value={addContact} onChange={setAddContact} disabled={!!walkInName} /></div>
              <span className="text-xs text-neutral-400">ou</span>
              <Input
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                placeholder="Nom (sans fiche contact)"
                className="h-9 w-48"
                disabled={!!addContact}
              />
              <CrmButton size="sm" variant="outline" disabled={!addContact && !walkInName.trim()} loading={busy} onClick={registerParticipant}>
                Inscrire
              </CrmButton>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--crm-black)]">
              Formateurs <span className="font-normal text-neutral-400">({data.trainers.length})</span>
            </h3>
            <ul className="mb-3 space-y-2">
              {data.trainers.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-md p-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-[var(--crm-black)]">{t.expertName}</span>
                  {t.fee != null ? <span className="shrink-0 text-xs text-neutral-400">{t.fee.toLocaleString('fr-FR')} DZD</span> : null}
                  <label className="flex shrink-0 items-center gap-1 text-xs text-neutral-500">
                    <input
                      type="checkbox"
                      checked={t.confirmed}
                      onChange={(e) => toggleTrainerConfirmed(t.id, e.target.checked)}
                      className="size-3.5 rounded border-neutral-300 text-[var(--crm-green)] focus:ring-[var(--crm-green)]"
                    />
                    Confirmé
                  </label>
                  <button type="button" onClick={() => removeTrainer(t.id)} className="shrink-0 text-xs text-neutral-400 hover:text-red-600">
                    Retirer
                  </button>
                </li>
              ))}
              {data.trainers.length === 0 ? <li className="text-sm text-neutral-400">Aucun formateur.</li> : null}
            </ul>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="min-w-[10rem] flex-1"><EntityPicker kind="expert" value={addExpert} onChange={setAddExpert} /></div>
              <Input value={trainerFee} onChange={(e) => setTrainerFee(e.target.value)} placeholder="Cachet (DZD)" type="number" min={0} className="h-9 w-32" />
              <CrmButton size="sm" variant="outline" disabled={!addExpert} loading={busy} onClick={addTrainer}>Ajouter</CrmButton>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--crm-black)]">
              Partenaires <span className="font-normal text-neutral-400">({data.partners.length})</span>
            </h3>
            <ul className="mb-3 space-y-2">
              {data.partners.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-md p-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-[var(--crm-black)]">{p.displayName}</span>
                  <button type="button" onClick={() => removePartner(p.id)} className="shrink-0 text-xs text-neutral-400 hover:text-red-600">
                    Retirer
                  </button>
                </li>
              ))}
              {data.partners.length === 0 ? <li className="text-sm text-neutral-400">Aucun partenaire.</li> : null}
            </ul>
            <div className="flex items-center gap-1.5">
              <div className="flex-1"><EntityPicker kind="partnership" value={addPartnership} onChange={setAddPartnership} /></div>
              <CrmButton size="sm" variant="outline" disabled={!addPartnership} loading={busy} onClick={addPartner}>Ajouter</CrmButton>
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
                lockedProgramId={program.id}
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
                  lockedProgramId={program.id}
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
            <h3 className="mb-3 text-sm font-semibold text-[var(--crm-black)]">
              Paiements <span className="font-normal text-neutral-400">({data.payments.length})</span>
            </h3>
            <ul className="mb-3 space-y-2">
              {data.payments.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-md p-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-[var(--crm-black)]">{p.label}</span>
                  <span className="shrink-0 text-xs text-neutral-500">{p.amount != null ? `${p.amount.toLocaleString('fr-FR')} DZD` : '—'}</span>
                  <Badge variant={PAYMENT_STATUS_BADGE[p.status] ?? 'default'}>{PAYMENT_STATUS_LABELS[p.status] ?? p.status}</Badge>
                </li>
              ))}
              {data.payments.length === 0 ? <li className="text-sm text-neutral-400">Aucun paiement.</li> : null}
            </ul>
            {isAdmin ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Input value={payLabel} onChange={(e) => setPayLabel(e.target.value)} placeholder="Libellé" className="h-9 flex-1" />
                <Input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Montant" type="number" min={0} className="h-9 w-28" />
                <CrmButton size="sm" variant="outline" disabled={!payLabel.trim() || !payAmount} loading={busy} onClick={addPayment}>
                  Ajouter
                </CrmButton>
              </div>
            ) : null}
          </div>

          <DocumentUpload entityType="PROGRAM" entityId={program.id} initial={data.documents} />
        </div>
      </div>
    </div>
  );
}
