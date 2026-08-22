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
import { PARTNERSHIP_STAGE_LABELS, PARTNERSHIP_TYPE_LABELS } from '@/components/metworkcrm/shared/labels';

export interface PartnershipRow {
  id: string;
  name: string;
  organizationId: string;
  type: string;
  stage: string;
  description: string | null;
  valueAmount: number | null;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
}

const selectClass =
  'h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function PartnershipFormDialog({
  trigger,
  partnership,
  lockedOrganizationId,
  lockedOrganizationLabel,
  onSaved,
}: {
  trigger: React.ReactNode;
  partnership?: PartnershipRow;
  lockedOrganizationId?: string;
  lockedOrganizationLabel?: string;
  onSaved: (id: string) => void;
}) {
  const isEdit = !!partnership;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(partnership?.name ?? '');
  const [type, setType] = useState(partnership?.type ?? 'AUTRE');
  const [stage, setStage] = useState(partnership?.stage ?? 'PROSPECT');
  const [description, setDescription] = useState(partnership?.description ?? '');
  const [valueAmount, setValueAmount] = useState(partnership?.valueAmount != null ? String(partnership.valueAmount) : '');
  const [startDate, setStartDate] = useState(partnership?.startDate ?? '');
  const [endDate, setEndDate] = useState(partnership?.endDate ?? '');
  const [renewalDate, setRenewalDate] = useState(partnership?.renewalDate ?? '');
  const [organization, setOrganization] = useState<{ id: string; label: string } | null>(
    lockedOrganizationId
      ? { id: lockedOrganizationId, label: lockedOrganizationLabel ?? '' }
      : partnership?.organizationId
        ? { id: partnership.organizationId, label: '' }
        : null,
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(partnership?.name ?? '');
    setType(partnership?.type ?? 'AUTRE');
    setStage(partnership?.stage ?? 'PROSPECT');
    setDescription(partnership?.description ?? '');
    setValueAmount(partnership?.valueAmount != null ? String(partnership.valueAmount) : '');
    setStartDate(partnership?.startDate ?? '');
    setEndDate(partnership?.endDate ?? '');
    setRenewalDate(partnership?.renewalDate ?? '');
    setOrganization(
      lockedOrganizationId
        ? { id: lockedOrganizationId, label: lockedOrganizationLabel ?? '' }
        : partnership?.organizationId
          ? { id: partnership.organizationId, label: '' }
          : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !isEdit || lockedOrganizationId || !partnership?.organizationId) return;
    fetch(`/api/metworkcrm/organizations/${partnership.organizationId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setOrganization({ id: partnership.organizationId, label: data.organization?.name ?? '' }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!organization) {
      setError("L'organisation est requise.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      name,
      organizationId: organization.id,
      type,
      stage,
      description: description || undefined,
      valueAmount: valueAmount ? Number(valueAmount) : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      renewalDate: renewalDate || undefined,
    };

    let res: Response;
    try {
      res = await fetch(isEdit ? `/api/metworkcrm/partnerships/${partnership!.id}` : '/api/metworkcrm/partnerships', {
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
          <DialogTitle>{isEdit ? 'Modifier le partenariat' : 'Nouveau partenariat'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <FormField label="Nom" htmlFor="partner-name" required>
            <Input id="partner-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
          </FormField>

          {!lockedOrganizationId ? (
            <FormField label="Organisation" htmlFor="partner-org" required>
              <EntityPicker kind="organization" value={organization} onChange={setOrganization} />
            </FormField>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type" htmlFor="partner-type" required>
              <select id="partner-type" value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
                {Object.entries(PARTNERSHIP_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Étape" htmlFor="partner-stage" required>
              <select id="partner-stage" value={stage} onChange={(e) => setStage(e.target.value)} className={selectClass}>
                {Object.entries(PARTNERSHIP_STAGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Valeur estimée (DZD)" htmlFor="partner-value">
            <Input id="partner-value" type="number" min={0} value={valueAmount} onChange={(e) => setValueAmount(e.target.value)} />
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Début" htmlFor="partner-start">
              <Input id="partner-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </FormField>
            <FormField label="Fin" htmlFor="partner-end">
              <Input id="partner-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </FormField>
            <FormField label="Renouvellement" htmlFor="partner-renewal">
              <Input id="partner-renewal" type="date" value={renewalDate} onChange={(e) => setRenewalDate(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Description" htmlFor="partner-description">
            <Textarea id="partner-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
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
