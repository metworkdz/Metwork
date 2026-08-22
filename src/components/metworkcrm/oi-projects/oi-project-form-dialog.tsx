'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { EntityPicker } from '@/components/metworkcrm/shared/entity-picker';
import { OI_STAGE_LABELS } from '@/components/metworkcrm/shared/labels';

export interface OiProjectRow {
  id: string;
  title: string;
  organizationId: string | null;
  contactId: string | null;
  partnershipId: string | null;
  stage: string;
  problemStatement: string | null;
  challengeStatement: string | null;
  budget: number | null;
  startDate: string | null;
  targetEndDate: string | null;
  notes: string | null;
}

const selectClass =
  'h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function OiProjectFormDialog({
  trigger,
  project,
  onSaved,
}: {
  trigger: React.ReactNode;
  project?: OiProjectRow;
  onSaved: (id: string) => void;
}) {
  const isEdit = !!project;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(project?.title ?? '');
  const [stage, setStage] = useState(project?.stage ?? 'ENTREPRISE_IDENTIFIEE');
  const [problemStatement, setProblemStatement] = useState(project?.problemStatement ?? '');
  const [challengeStatement, setChallengeStatement] = useState(project?.challengeStatement ?? '');
  const [budget, setBudget] = useState(project?.budget != null ? String(project.budget) : '');
  const [startDate, setStartDate] = useState(project?.startDate ?? '');
  const [targetEndDate, setTargetEndDate] = useState(project?.targetEndDate ?? '');
  const [notes, setNotes] = useState(project?.notes ?? '');
  const [organization, setOrganization] = useState<{ id: string; label: string } | null>(
    project?.organizationId ? { id: project.organizationId, label: '' } : null,
  );
  const [contact, setContact] = useState<{ id: string; label: string } | null>(
    project?.contactId ? { id: project.contactId, label: '' } : null,
  );
  const [partnership, setPartnership] = useState<{ id: string; label: string } | null>(
    project?.partnershipId ? { id: project.partnershipId, label: '' } : null,
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle(project?.title ?? '');
    setStage(project?.stage ?? 'ENTREPRISE_IDENTIFIEE');
    setProblemStatement(project?.problemStatement ?? '');
    setChallengeStatement(project?.challengeStatement ?? '');
    setBudget(project?.budget != null ? String(project.budget) : '');
    setStartDate(project?.startDate ?? '');
    setTargetEndDate(project?.targetEndDate ?? '');
    setNotes(project?.notes ?? '');
    setOrganization(project?.organizationId ? { id: project.organizationId, label: '' } : null);
    setContact(project?.contactId ? { id: project.contactId, label: '' } : null);
    setPartnership(project?.partnershipId ? { id: project.partnershipId, label: '' } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !isEdit) return;
    if (project?.organizationId) {
      fetch(`/api/metworkcrm/organizations/${project.organizationId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setOrganization({ id: project.organizationId!, label: data.organization?.name ?? '' }))
        .catch(() => {});
    }
    if (project?.contactId) {
      fetch(`/api/metworkcrm/contacts/${project.contactId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setContact({ id: project.contactId!, label: data.contact?.fullName ?? '' }))
        .catch(() => {});
    }
    if (project?.partnershipId) {
      fetch(`/api/metworkcrm/partnerships/${project.partnershipId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setPartnership({ id: project.partnershipId!, label: data.partnership?.name ?? '' }))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      title,
      stage,
      problemStatement: problemStatement || undefined,
      challengeStatement: challengeStatement || undefined,
      budget: budget ? Number(budget) : undefined,
      startDate: startDate || undefined,
      targetEndDate: targetEndDate || undefined,
      notes: notes || undefined,
      organizationId: organization?.id || undefined,
      contactId: contact?.id || undefined,
      partnershipId: partnership?.id || undefined,
    };

    let res: Response;
    try {
      res = await fetch(isEdit ? `/api/metworkcrm/oi-projects/${project!.id}` : '/api/metworkcrm/oi-projects', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setError('Impossible de contacter le serveur. Vérifiez votre connexion.');
      setSaving(false);
      return;
    }

    let data: { id?: string; error?: { message?: string } };
    try {
      data = await res.json();
    } catch {
      setError(`Réponse du serveur invalide (code ${res.status}). Réessayez ou contactez l'équipe technique.`);
      setSaving(false);
      return;
    }

    if (!res.ok) {
      setError(data?.error?.message ?? 'Une erreur est survenue.');
      setSaving(false);
      return;
    }
    setSaving(false);
    setOpen(false);
    onSaved(data.id!);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifier le projet' : 'Nouveau projet Open Innovation'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <FormField label="Titre" htmlFor="oi-title" required>
            <Input id="oi-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          </FormField>

          <FormField label="Étape" htmlFor="oi-stage" required>
            <select id="oi-stage" value={stage} onChange={(e) => setStage(e.target.value)} className={selectClass}>
              {Object.entries(OI_STAGE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Organisation" htmlFor="oi-org">
            <EntityPicker kind="organization" value={organization} onChange={setOrganization} />
          </FormField>
          <FormField label="Contact" htmlFor="oi-contact">
            <EntityPicker kind="contact" value={contact} onChange={setContact} />
          </FormField>
          <FormField label="Partenariat lié" htmlFor="oi-partnership">
            <EntityPicker kind="partnership" value={partnership} onChange={setPartnership} />
          </FormField>

          <FormField label="Problème identifié" htmlFor="oi-problem">
            <Textarea id="oi-problem" value={problemStatement} onChange={(e) => setProblemStatement(e.target.value)} rows={2} />
          </FormField>
          <FormField label="Défi défini" htmlFor="oi-challenge">
            <Textarea id="oi-challenge" value={challengeStatement} onChange={(e) => setChallengeStatement(e.target.value)} rows={2} />
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Budget (DZD)" htmlFor="oi-budget">
              <Input id="oi-budget" type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
            </FormField>
            <FormField label="Début" htmlFor="oi-start">
              <Input id="oi-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </FormField>
            <FormField label="Fin visée" htmlFor="oi-end">
              <Input id="oi-end" type="date" value={targetEndDate} onChange={(e) => setTargetEndDate(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Notes internes" htmlFor="oi-notes">
            <Textarea id="oi-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </FormField>

          {error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <CrmButton type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</CrmButton>
            <CrmButton type="submit" loading={saving}>{isEdit ? 'Enregistrer' : 'Créer'}</CrmButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
