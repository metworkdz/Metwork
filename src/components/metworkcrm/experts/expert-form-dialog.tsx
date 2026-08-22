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
import { EXPERT_STAGE_LABELS } from '@/components/metworkcrm/shared/labels';

export interface ExpertRow {
  id: string;
  platformMentorId: string | null;
  name: string | null;
  displayNameCache: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  specialties: string[];
  pipelineStage: string;
  dailyRate: number | null;
  organizationId: string | null;
  contactId: string | null;
  internalNotes: string | null;
}

const selectClass =
  'h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function ExpertFormDialog({
  trigger,
  expert,
  onSaved,
}: {
  trigger: React.ReactNode;
  expert?: ExpertRow;
  onSaved: (id: string) => void;
}) {
  const isEdit = !!expert;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(expert?.name ?? '');
  const [email, setEmail] = useState(expert?.email ?? '');
  const [phone, setPhone] = useState(expert?.phone ?? '');
  const [city, setCity] = useState(expert?.city ?? '');
  const [specialties, setSpecialties] = useState((expert?.specialties ?? []).join(', '));
  const [pipelineStage, setPipelineStage] = useState(expert?.pipelineStage ?? 'PROSPECT');
  const [dailyRate, setDailyRate] = useState(expert?.dailyRate != null ? String(expert.dailyRate) : '');
  const [internalNotes, setInternalNotes] = useState(expert?.internalNotes ?? '');
  const [organization, setOrganization] = useState<{ id: string; label: string } | null>(
    expert?.organizationId ? { id: expert.organizationId, label: '' } : null,
  );
  const [contact, setContact] = useState<{ id: string; label: string } | null>(
    expert?.contactId ? { id: expert.contactId, label: '' } : null,
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(expert?.name ?? '');
    setEmail(expert?.email ?? '');
    setPhone(expert?.phone ?? '');
    setCity(expert?.city ?? '');
    setSpecialties((expert?.specialties ?? []).join(', '));
    setPipelineStage(expert?.pipelineStage ?? 'PROSPECT');
    setDailyRate(expert?.dailyRate != null ? String(expert.dailyRate) : '');
    setInternalNotes(expert?.internalNotes ?? '');
    setOrganization(expert?.organizationId ? { id: expert.organizationId, label: '' } : null);
    setContact(expert?.contactId ? { id: expert.contactId, label: '' } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !isEdit) return;
    if (expert?.organizationId) {
      fetch(`/api/metworkcrm/organizations/${expert.organizationId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setOrganization({ id: expert.organizationId!, label: data.organization?.name ?? '' }))
        .catch(() => {});
    }
    if (expert?.contactId) {
      fetch(`/api/metworkcrm/contacts/${expert.contactId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setContact({ id: expert.contactId!, label: data.contact?.fullName ?? '' }))
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
      email: email || undefined,
      phone: phone || undefined,
      city: city || undefined,
      specialties: specialties.trim() ? specialties.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      pipelineStage,
      dailyRate: dailyRate ? Number(dailyRate) : undefined,
      internalNotes: internalNotes || undefined,
      organizationId: organization?.id || undefined,
      contactId: contact?.id || undefined,
    };

    let res: Response;
    try {
      res = await fetch(isEdit ? `/api/metworkcrm/experts/${expert!.id}` : '/api/metworkcrm/experts', {
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
          <DialogTitle>{isEdit ? "Modifier l'expert" : 'Nouvel expert'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <FormField label="Nom" htmlFor="expert-name" required>
            <Input id="expert-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="E-mail" htmlFor="expert-email">
              <Input id="expert-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label="Téléphone" htmlFor="expert-phone">
              <Input id="expert-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Ville" htmlFor="expert-city">
              <Input id="expert-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </FormField>
            <FormField label="Étape" htmlFor="expert-stage" required>
              <select id="expert-stage" value={pipelineStage} onChange={(e) => setPipelineStage(e.target.value)} className={selectClass}>
                {Object.entries(EXPERT_STAGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Spécialités (séparées par une virgule)" htmlFor="expert-specialties">
            <Input id="expert-specialties" value={specialties} onChange={(e) => setSpecialties(e.target.value)} placeholder="Marketing, Levée de fonds…" />
          </FormField>

          <FormField label="Taux journalier (DZD)" htmlFor="expert-rate">
            <Input id="expert-rate" type="number" min={0} value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} />
          </FormField>

          <FormField label="Organisation" htmlFor="expert-org">
            <EntityPicker kind="organization" value={organization} onChange={setOrganization} />
          </FormField>
          <FormField label="Contact" htmlFor="expert-contact">
            <EntityPicker kind="contact" value={contact} onChange={setContact} />
          </FormField>

          <FormField label="Notes internes" htmlFor="expert-notes">
            <Textarea id="expert-notes" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} />
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
