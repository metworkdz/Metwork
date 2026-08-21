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
import { STARTUP_STAGE_LABELS } from '@/components/metworkcrm/shared/labels';

export interface StartupRow {
  id: string;
  platformListingId: string | null;
  name: string | null;
  displayNameCache: string | null;
  sector: string | null;
  city: string | null;
  website: string | null;
  description: string | null;
  founderName: string | null;
  founderEmail: string | null;
  founderPhone: string | null;
  organizationId: string | null;
  primaryContactId: string | null;
  pipelineStage: string;
  assignedExpertId: string | null;
  notes: string | null;
}

const selectClass =
  'h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function StartupFormDialog({
  trigger,
  startup,
  onSaved,
}: {
  trigger: React.ReactNode;
  startup?: StartupRow;
  onSaved: (id: string) => void;
}) {
  const isEdit = !!startup;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(startup?.name ?? '');
  const [sector, setSector] = useState(startup?.sector ?? '');
  const [city, setCity] = useState(startup?.city ?? '');
  const [website, setWebsite] = useState(startup?.website ?? '');
  const [description, setDescription] = useState(startup?.description ?? '');
  const [founderName, setFounderName] = useState(startup?.founderName ?? '');
  const [founderEmail, setFounderEmail] = useState(startup?.founderEmail ?? '');
  const [founderPhone, setFounderPhone] = useState(startup?.founderPhone ?? '');
  const [pipelineStage, setPipelineStage] = useState(startup?.pipelineStage ?? 'LEAD');
  const [notes, setNotes] = useState(startup?.notes ?? '');
  const [organization, setOrganization] = useState<{ id: string; label: string } | null>(
    startup?.organizationId ? { id: startup.organizationId, label: '' } : null,
  );
  const [expert, setExpert] = useState<{ id: string; label: string } | null>(
    startup?.assignedExpertId ? { id: startup.assignedExpertId, label: '' } : null,
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(startup?.name ?? '');
    setSector(startup?.sector ?? '');
    setCity(startup?.city ?? '');
    setWebsite(startup?.website ?? '');
    setDescription(startup?.description ?? '');
    setFounderName(startup?.founderName ?? '');
    setFounderEmail(startup?.founderEmail ?? '');
    setFounderPhone(startup?.founderPhone ?? '');
    setPipelineStage(startup?.pipelineStage ?? 'LEAD');
    setNotes(startup?.notes ?? '');
    setOrganization(startup?.organizationId ? { id: startup.organizationId, label: '' } : null);
    setExpert(startup?.assignedExpertId ? { id: startup.assignedExpertId, label: '' } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Resolve linked-entity display names — the row only carries ids.
  useEffect(() => {
    if (!open || !isEdit) return;
    if (startup?.organizationId) {
      fetch(`/api/metworkcrm/organizations/${startup.organizationId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setOrganization({ id: startup.organizationId!, label: data.organization?.name ?? '' }))
        .catch(() => {});
    }
    if (startup?.assignedExpertId) {
      fetch(`/api/metworkcrm/experts/${startup.assignedExpertId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setExpert({ id: startup.assignedExpertId!, label: data.expert?.displayNameCache ?? data.expert?.name ?? '' }))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name,
      sector: sector || undefined,
      city: city || undefined,
      website: website || undefined,
      description: description || undefined,
      founderName: founderName || undefined,
      founderEmail: founderEmail || undefined,
      founderPhone: founderPhone || undefined,
      pipelineStage,
      notes: notes || undefined,
      organizationId: organization?.id || undefined,
      assignedExpertId: expert?.id || undefined,
    };

    try {
      const res = await fetch(isEdit ? `/api/metworkcrm/startups/${startup!.id}` : '/api/metworkcrm/startups', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? 'Une erreur est survenue.');
        setSaving(false);
        return;
      }
      setSaving(false);
      setOpen(false);
      onSaved(data.id);
    } catch {
      setError('Erreur réseau. Réessayez.');
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifier la startup' : 'Nouvelle startup'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <FormField label="Nom" htmlFor="startup-name" required>
            <Input id="startup-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Secteur" htmlFor="startup-sector">
              <Input id="startup-sector" value={sector} onChange={(e) => setSector(e.target.value)} />
            </FormField>
            <FormField label="Étape" htmlFor="startup-stage" required>
              <select id="startup-stage" value={pipelineStage} onChange={(e) => setPipelineStage(e.target.value)} className={selectClass}>
                {Object.entries(STARTUP_STAGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Ville" htmlFor="startup-city">
              <Input id="startup-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </FormField>
            <FormField label="Site web" htmlFor="startup-website">
              <Input id="startup-website" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
            </FormField>
          </div>

          <FormField label="Organisation" htmlFor="startup-org">
            <EntityPicker kind="organization" value={organization} onChange={setOrganization} />
          </FormField>
          <FormField label="Expert référent" htmlFor="startup-expert">
            <EntityPicker kind="expert" value={expert} onChange={setExpert} />
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Fondateur" htmlFor="startup-founder">
              <Input id="startup-founder" value={founderName} onChange={(e) => setFounderName(e.target.value)} />
            </FormField>
            <FormField label="E-mail fondateur" htmlFor="startup-founder-email">
              <Input id="startup-founder-email" type="email" value={founderEmail} onChange={(e) => setFounderEmail(e.target.value)} />
            </FormField>
            <FormField label="Téléphone fondateur" htmlFor="startup-founder-phone">
              <Input id="startup-founder-phone" value={founderPhone} onChange={(e) => setFounderPhone(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Description" htmlFor="startup-description">
            <Textarea id="startup-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </FormField>

          <FormField label="Notes internes" htmlFor="startup-notes">
            <Textarea id="startup-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </FormField>

          {error ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <CrmButton type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</CrmButton>
            <CrmButton type="submit" loading={saving}>{isEdit ? 'Enregistrer' : 'Créer'}</CrmButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
