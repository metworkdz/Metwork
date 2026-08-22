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
import { BOOKING_STATUS_LABELS, SPACE_TYPE_LABELS } from '@/components/metworkcrm/shared/labels';

export interface SpaceBookingRow {
  id: string;
  reference: string;
  spaceLabel: string;
  spaceType: string;
  organizationId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  startAt: string | null;
  endAt: string | null;
  attendees: number | null;
  quotedAmount: number | null;
  finalAmount: number | null;
  status: string;
  notes: string | null;
}

const selectClass =
  'h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

/** `2026-08-18T14:30` — the format a `datetime-local` input needs, in local time. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SpaceBookingFormDialog({
  trigger,
  booking,
  lockedOrganizationId,
  lockedOrganizationLabel,
  onSaved,
}: {
  trigger: React.ReactNode;
  booking?: SpaceBookingRow;
  lockedOrganizationId?: string;
  lockedOrganizationLabel?: string;
  onSaved: (id: string) => void;
}) {
  const isEdit = !!booking;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [spaceLabel, setSpaceLabel] = useState(booking?.spaceLabel ?? '');
  const [spaceType, setSpaceType] = useState(booking?.spaceType ?? 'COWORKING');
  const [status, setStatus] = useState(booking?.status ?? 'DEMANDE');
  const [startAt, setStartAt] = useState(booking?.startAt ? toDatetimeLocal(booking.startAt) : '');
  const [endAt, setEndAt] = useState(booking?.endAt ? toDatetimeLocal(booking.endAt) : '');
  const [attendees, setAttendees] = useState(booking?.attendees != null ? String(booking.attendees) : '');
  const [quotedAmount, setQuotedAmount] = useState(booking?.quotedAmount != null ? String(booking.quotedAmount) : '');
  const [finalAmount, setFinalAmount] = useState(booking?.finalAmount != null ? String(booking.finalAmount) : '');
  const [notes, setNotes] = useState(booking?.notes ?? '');
  const [organization, setOrganization] = useState<{ id: string; label: string } | null>(
    lockedOrganizationId
      ? { id: lockedOrganizationId, label: lockedOrganizationLabel ?? '' }
      : booking?.organizationId
        ? { id: booking.organizationId, label: '' }
        : null,
  );
  const [contact, setContact] = useState<{ id: string; label: string } | null>(
    booking?.contactId ? { id: booking.contactId, label: '' } : null,
  );
  const [opportunity, setOpportunity] = useState<{ id: string; label: string } | null>(
    booking?.opportunityId ? { id: booking.opportunityId, label: '' } : null,
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSpaceLabel(booking?.spaceLabel ?? '');
    setSpaceType(booking?.spaceType ?? 'COWORKING');
    setStatus(booking?.status ?? 'DEMANDE');
    setStartAt(booking?.startAt ? toDatetimeLocal(booking.startAt) : '');
    setEndAt(booking?.endAt ? toDatetimeLocal(booking.endAt) : '');
    setAttendees(booking?.attendees != null ? String(booking.attendees) : '');
    setQuotedAmount(booking?.quotedAmount != null ? String(booking.quotedAmount) : '');
    setFinalAmount(booking?.finalAmount != null ? String(booking.finalAmount) : '');
    setNotes(booking?.notes ?? '');
    setOrganization(
      lockedOrganizationId
        ? { id: lockedOrganizationId, label: lockedOrganizationLabel ?? '' }
        : booking?.organizationId
          ? { id: booking.organizationId, label: '' }
          : null,
    );
    setContact(booking?.contactId ? { id: booking.contactId, label: '' } : null);
    setOpportunity(booking?.opportunityId ? { id: booking.opportunityId, label: '' } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !isEdit) return;
    if (!lockedOrganizationId && booking?.organizationId) {
      fetch(`/api/metworkcrm/organizations/${booking.organizationId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setOrganization({ id: booking.organizationId!, label: data.organization?.name ?? '' }))
        .catch(() => {});
    }
    if (booking?.contactId) {
      fetch(`/api/metworkcrm/contacts/${booking.contactId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setContact({ id: booking.contactId!, label: data.contact?.fullName ?? '' }))
        .catch(() => {});
    }
    if (booking?.opportunityId) {
      fetch(`/api/metworkcrm/opportunities/${booking.opportunityId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setOpportunity({ id: booking.opportunityId!, label: data.opportunity?.title ?? '' }))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      spaceLabel,
      spaceType,
      status,
      startAt: startAt ? new Date(startAt).toISOString() : undefined,
      endAt: endAt ? new Date(endAt).toISOString() : undefined,
      attendees: attendees ? Number(attendees) : undefined,
      quotedAmount: quotedAmount ? Number(quotedAmount) : undefined,
      finalAmount: finalAmount ? Number(finalAmount) : undefined,
      notes: notes || undefined,
      organizationId: lockedOrganizationId ?? organization?.id ?? '',
      contactId: contact?.id || undefined,
      opportunityId: opportunity?.id || undefined,
    };

    try {
      const res = await fetch(isEdit ? `/api/metworkcrm/space-bookings/${booking!.id}` : '/api/metworkcrm/space-bookings', {
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
          <DialogTitle>{isEdit ? 'Modifier la réservation' : 'Nouvelle réservation'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <FormField label="Espace" htmlFor="book-label" required>
            <Input id="book-label" value={spaceLabel} onChange={(e) => setSpaceLabel(e.target.value)} required maxLength={200} placeholder="Salle Atlas, Bureau 12…" />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type" htmlFor="book-type" required>
              <select id="book-type" value={spaceType} onChange={(e) => setSpaceType(e.target.value)} className={selectClass}>
                {Object.entries(SPACE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Statut" htmlFor="book-status" required>
              <select id="book-status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
                {Object.entries(BOOKING_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
          </div>

          {/*
            grid-cols-1 not grid-cols-2: TWO native `datetime-local` widgets
            side by side leaves ~140px each at 375px, clipping the rendered
            date+time (the underlying value is unaffected, but the user can't
            read what they set). Stacked below `sm`, side-by-side above.
          */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Début" htmlFor="book-start">
              <Input id="book-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </FormField>
            <FormField label="Fin" htmlFor="book-end">
              <Input id="book-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </FormField>
          </div>

          {!lockedOrganizationId ? (
            <FormField label="Organisation" htmlFor="book-org">
              <EntityPicker kind="organization" value={organization} onChange={setOrganization} />
            </FormField>
          ) : null}
          <FormField label="Contact" htmlFor="book-contact">
            <EntityPicker kind="contact" value={contact} onChange={setContact} />
          </FormField>
          <FormField label="Opportunité liée" htmlFor="book-opp">
            <EntityPicker kind="opportunity" value={opportunity} onChange={setOpportunity} />
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Participants" htmlFor="book-attendees">
              <Input id="book-attendees" type="number" min={0} value={attendees} onChange={(e) => setAttendees(e.target.value)} />
            </FormField>
            <FormField label="Devis (DZD)" htmlFor="book-quoted">
              <Input id="book-quoted" type="number" min={0} value={quotedAmount} onChange={(e) => setQuotedAmount(e.target.value)} />
            </FormField>
            <FormField label="Montant final (DZD)" htmlFor="book-final">
              <Input id="book-final" type="number" min={0} value={finalAmount} onChange={(e) => setFinalAmount(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Notes internes" htmlFor="book-notes">
            <Textarea id="book-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
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
