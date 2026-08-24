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
import { OPPORTUNITY_STAGE_LABELS, OPPORTUNITY_TYPE_LABELS } from '@/components/metworkcrm/shared/labels';
import { extractApiErrorMessage } from '@/components/metworkcrm/shared/api-error';

export interface OpportunityRow {
  id: string;
  title: string;
  organizationId: string | null;
  contactId: string | null;
  type: string;
  stage: string;
  amount: number | null;
  probability: number | null;
  expectedCloseDate: string | null;
  source: string | null;
  description: string | null;
}

const selectClass =
  'h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function OpportunityFormDialog({
  trigger,
  opportunity,
  lockedOrganizationId,
  lockedOrganizationLabel,
  lockedContactId,
  lockedContactLabel,
  onSaved,
}: {
  trigger: React.ReactNode;
  opportunity?: OpportunityRow;
  lockedOrganizationId?: string;
  lockedOrganizationLabel?: string;
  lockedContactId?: string;
  lockedContactLabel?: string;
  onSaved: (id: string) => void;
}) {
  const isEdit = !!opportunity;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(opportunity?.title ?? '');
  const [type, setType] = useState(opportunity?.type ?? 'AUTRE');
  const [stage, setStage] = useState(opportunity?.stage ?? 'NOUVEAU_LEAD');
  const [amount, setAmount] = useState(opportunity?.amount != null ? String(opportunity.amount) : '');
  const [probability, setProbability] = useState(opportunity?.probability != null ? String(opportunity.probability) : '');
  const [expectedCloseDate, setExpectedCloseDate] = useState(opportunity?.expectedCloseDate ?? '');
  const [description, setDescription] = useState(opportunity?.description ?? '');
  const [organization, setOrganization] = useState<{ id: string; label: string } | null>(
    lockedOrganizationId ? { id: lockedOrganizationId, label: lockedOrganizationLabel ?? '' } : null,
  );
  const [contact, setContact] = useState<{ id: string; label: string } | null>(
    lockedContactId ? { id: lockedContactId, label: lockedContactLabel ?? '' } : null,
  );

  // Re-seed on every open — see the note in organization-form-dialog.tsx for why
  // this is required (a dialog kept mounted in a list never re-runs useState()).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle(opportunity?.title ?? '');
    setType(opportunity?.type ?? 'AUTRE');
    setStage(opportunity?.stage ?? 'NOUVEAU_LEAD');
    setAmount(opportunity?.amount != null ? String(opportunity.amount) : '');
    setProbability(opportunity?.probability != null ? String(opportunity.probability) : '');
    setExpectedCloseDate(opportunity?.expectedCloseDate ?? '');
    setDescription(opportunity?.description ?? '');
    setOrganization(lockedOrganizationId ? { id: lockedOrganizationId, label: lockedOrganizationLabel ?? '' } : null);
    setContact(lockedContactId ? { id: lockedContactId, label: lockedContactLabel ?? '' } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Resolve unlocked linked-entity names when editing from the standalone /sales list.
  useEffect(() => {
    if (!open || !isEdit) return;
    if (!lockedOrganizationId && opportunity?.organizationId) {
      fetch(`/api/metworkcrm/organizations/${opportunity.organizationId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setOrganization({ id: opportunity.organizationId!, label: data.organization?.name ?? '' }))
        .catch(() => {});
    }
    if (!lockedContactId && opportunity?.contactId) {
      fetch(`/api/metworkcrm/contacts/${opportunity.contactId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setContact({ id: opportunity.contactId!, label: data.contact?.fullName ?? '' }))
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
      type,
      stage,
      amount: amount ? Number(amount) : undefined,
      probability: probability ? Number(probability) : undefined,
      expectedCloseDate: expectedCloseDate || undefined,
      description: description || undefined,
      organizationId: lockedOrganizationId ?? organization?.id ?? '',
      contactId: lockedContactId ?? contact?.id ?? '',
    };

    let res: Response;
    try {
      res = await fetch(isEdit ? `/api/metworkcrm/opportunities/${opportunity!.id}` : '/api/metworkcrm/opportunities', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setError('Impossible de contacter le serveur. Vérifiez votre connexion.');
      setSaving(false);
      return;
    }

    let data: { id?: string; error?: { message?: string; details?: { fieldErrors?: Record<string, string[]> } } };
    try {
      data = await res.json();
    } catch {
      setError(`Réponse du serveur invalide (code ${res.status}). Réessayez ou contactez l'équipe technique.`);
      setSaving(false);
      return;
    }

    if (!res.ok) {
      setError(extractApiErrorMessage(data));
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
          <DialogTitle>{isEdit ? "Modifier l'opportunité" : 'Nouvelle opportunité'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <FormField label="Titre" htmlFor="opp-title" required>
            <Input id="opp-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type" htmlFor="opp-type" required>
              <select id="opp-type" value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
                {Object.entries(OPPORTUNITY_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Étape" htmlFor="opp-stage" required>
              <select id="opp-stage" value={stage} onChange={(e) => setStage(e.target.value)} className={selectClass}>
                {Object.entries(OPPORTUNITY_STAGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Montant (DZD)" htmlFor="opp-amount">
              <Input id="opp-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </FormField>
            <FormField label="Probabilité (%)" htmlFor="opp-probability">
              <Input id="opp-probability" type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Clôture prévue" htmlFor="opp-close">
            <Input id="opp-close" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} />
          </FormField>

          {!lockedOrganizationId ? (
            <FormField label="Organisation" htmlFor="opp-org">
              <EntityPicker kind="organization" value={organization} onChange={setOrganization} />
            </FormField>
          ) : null}
          {!lockedContactId ? (
            <FormField label="Contact" htmlFor="opp-contact">
              <EntityPicker kind="contact" value={contact} onChange={setContact} />
            </FormField>
          ) : null}

          <FormField label="Description" htmlFor="opp-description">
            <Textarea id="opp-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </FormField>

          {error ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <CrmButton type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </CrmButton>
            <CrmButton type="submit" loading={saving}>
              {isEdit ? 'Enregistrer' : 'Créer'}
            </CrmButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
