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
import { EntityPicker, type EntityPickerKind } from '@/components/metworkcrm/shared/entity-picker';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from '@/components/metworkcrm/shared/labels';

export interface PaymentRow {
  id: string;
  label: string;
  amount: number | null;
  currency: string;
  direction: string;
  status: string;
  dueDate: string | null;
  method: string | null;
  opportunityId: string | null;
  spaceBookingId: string | null;
  programId: string | null;
  organizationId: string | null;
  contactId: string | null;
  partnershipId: string | null;
  oiProjectId: string | null;
  externalRef: string | null;
  notes: string | null;
}

const selectClass =
  'h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

/** The 7 fields a payment can link to — one at a time in this form, matching how every payment is created in practice (from one specific context). */
const LINK_KINDS: { value: string; label: string; pickerKind: EntityPickerKind; field: keyof PaymentRow }[] = [
  { value: 'opportunity', label: 'Opportunité', pickerKind: 'opportunity', field: 'opportunityId' },
  { value: 'booking', label: 'Réservation espace', pickerKind: 'space-booking', field: 'spaceBookingId' },
  { value: 'program', label: 'Programme', pickerKind: 'program', field: 'programId' },
  { value: 'organization', label: 'Organisation', pickerKind: 'organization', field: 'organizationId' },
  { value: 'contact', label: 'Contact', pickerKind: 'contact', field: 'contactId' },
  { value: 'partnership', label: 'Partenariat', pickerKind: 'partnership', field: 'partnershipId' },
  { value: 'oiProject', label: 'Projet Open Innovation', pickerKind: 'oi-project', field: 'oiProjectId' },
];

function detectLinkKind(payment?: PaymentRow): string {
  if (!payment) return 'organization';
  return LINK_KINDS.find((k) => payment[k.field])?.value ?? 'organization';
}

export function PaymentFormDialog({
  trigger,
  payment,
  onSaved,
}: {
  trigger: React.ReactNode;
  payment?: PaymentRow;
  onSaved: (id: string) => void;
}) {
  const isEdit = !!payment;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState(payment?.label ?? '');
  const [amount, setAmount] = useState(payment?.amount != null ? String(payment.amount) : '');
  const [direction, setDirection] = useState(payment?.direction ?? 'IN');
  const [status, setStatus] = useState(payment?.status ?? 'EN_ATTENTE');
  const [dueDate, setDueDate] = useState(payment?.dueDate ?? '');
  const [method, setMethod] = useState(payment?.method ?? '');
  const [externalRef, setExternalRef] = useState(payment?.externalRef ?? '');
  const [notes, setNotes] = useState(payment?.notes ?? '');
  const [linkKind, setLinkKind] = useState(detectLinkKind(payment));
  const [linkValue, setLinkValue] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLabel(payment?.label ?? '');
    setAmount(payment?.amount != null ? String(payment.amount) : '');
    setDirection(payment?.direction ?? 'IN');
    setStatus(payment?.status ?? 'EN_ATTENTE');
    setDueDate(payment?.dueDate ?? '');
    setMethod(payment?.method ?? '');
    setExternalRef(payment?.externalRef ?? '');
    setNotes(payment?.notes ?? '');
    const kind = detectLinkKind(payment);
    setLinkKind(kind);
    setLinkValue(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Resolve the linked entity's display name for edit mode — the row only carries an id.
  useEffect(() => {
    if (!open || !isEdit) return;
    const entry = LINK_KINDS.find((k) => k.value === linkKind);
    const id = entry ? (payment?.[entry.field] as string | null) : null;
    if (!entry || !id) return;

    function endpointFor(kind: EntityPickerKind, entityId: string): string | null {
      switch (kind) {
        case 'opportunity': return `/api/metworkcrm/opportunities/${entityId}`;
        case 'space-booking': return `/api/metworkcrm/space-bookings/${entityId}`;
        case 'program': return `/api/metworkcrm/programs/${entityId}`;
        case 'organization': return `/api/metworkcrm/organizations/${entityId}`;
        case 'contact': return `/api/metworkcrm/contacts/${entityId}`;
        case 'partnership': return `/api/metworkcrm/partnerships/${entityId}`;
        case 'oi-project': return `/api/metworkcrm/oi-projects/${entityId}`;
        default: return null;
      }
    }
    const endpoint = endpointFor(entry.pickerKind, id);
    if (!endpoint) return;

    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const label =
          data.organization?.name ?? data.contact?.fullName ?? data.opportunity?.title ?? data.booking?.reference ??
          data.program?.title ?? data.partnership?.name ?? data.project?.title ?? '';
        setLinkValue({ id, label });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!linkValue) {
      setError('Choisissez un élément à rattacher.');
      return;
    }
    setSaving(true);
    setError(null);

    const entry = LINK_KINDS.find((k) => k.value === linkKind)!;
    const payload: Record<string, unknown> = {
      label,
      amount: amount ? Number(amount) : undefined,
      direction,
      status,
      dueDate: dueDate || undefined,
      method: method || undefined,
      externalRef: externalRef || undefined,
      notes: notes || undefined,
      [entry.field]: linkValue.id,
    };

    try {
      const res = await fetch(isEdit ? `/api/metworkcrm/payments/${payment!.id}` : '/api/metworkcrm/payments', {
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

  const activeKind = LINK_KINDS.find((k) => k.value === linkKind)!;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifier le paiement' : 'Nouveau paiement'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <FormField label="Libellé" htmlFor="pay-label" required>
            <Input id="pay-label" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={200} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Montant (DZD)" htmlFor="pay-amount" required>
              <Input id="pay-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </FormField>
            <FormField label="Sens" htmlFor="pay-direction" required>
              <select id="pay-direction" value={direction} onChange={(e) => setDirection(e.target.value)} className={selectClass}>
                <option value="IN">Entrant</option>
                <option value="OUT">Sortant</option>
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Statut" htmlFor="pay-status" required>
              <select id="pay-status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
                {Object.entries(PAYMENT_STATUS_LABELS).map(([value, l]) => (
                  <option key={value} value={value}>{l}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Échéance" htmlFor="pay-due">
              <Input id="pay-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Méthode" htmlFor="pay-method">
            <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} className={selectClass}>
              <option value="">—</option>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, l]) => (
                <option key={value} value={value}>{l}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Rattaché à" htmlFor="pay-link-kind" required>
            <div className="space-y-2">
              <select
                id="pay-link-kind"
                value={linkKind}
                onChange={(e) => {
                  setLinkKind(e.target.value);
                  setLinkValue(null);
                }}
                className={selectClass}
              >
                {LINK_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
              <EntityPicker kind={activeKind.pickerKind} value={linkValue} onChange={setLinkValue} />
            </div>
          </FormField>

          <FormField label="Référence externe" htmlFor="pay-ref">
            <Input id="pay-ref" value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder="N° facture plateforme…" maxLength={100} />
          </FormField>

          <FormField label="Notes internes" htmlFor="pay-notes">
            <Textarea id="pay-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
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
