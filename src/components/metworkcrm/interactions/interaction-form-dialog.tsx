'use client';

import { useEffect, useRef, useState } from 'react';
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
import { INTERACTION_DIRECTION_LABELS, INTERACTION_TYPE_LABELS } from '@/components/metworkcrm/shared/labels';

export interface InteractionRow {
  id: string;
  type: string;
  direction: string | null;
  subject: string;
  body: string | null;
  occurredAt: string;
  durationMinutes: number | null;
  outcome: string | null;
  contactId: string | null;
  organizationId: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  nextActionDone: boolean;
}

/** `2026-08-18T14:30` — the format a `datetime-local` input needs, in local time. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function InteractionFormDialog({
  trigger,
  interaction,
  lockedOrganizationId,
  lockedOrganizationLabel,
  lockedContactId,
  lockedContactLabel,
  lockedOpportunityId,
  lockedStartupId,
  lockedExpertId,
  lockedPartnershipId,
  lockedProgramId,
  lockedOiProjectId,
  onSaved,
}: {
  trigger: React.ReactNode;
  /** Present → edit mode. Absent → create mode. */
  interaction?: InteractionRow;
  /** Opened from an Organization's detail page: hide the org picker, always link here. */
  lockedOrganizationId?: string;
  lockedOrganizationLabel?: string;
  /** Opened from a Contact's detail page: hide the contact picker, always link here. */
  lockedContactId?: string;
  lockedContactLabel?: string;
  /**
   * Opportunity/Startup/Expert/Partnership never get a picker in this dialog
   * — unlike Organization/Contact they're only ever used in "locked" mode,
   * opened from that entity's own detail page timeline.
   */
  lockedOpportunityId?: string;
  lockedStartupId?: string;
  lockedExpertId?: string;
  lockedPartnershipId?: string;
  lockedProgramId?: string;
  lockedOiProjectId?: string;
  onSaved: () => void;
}) {
  const isEdit = !!interaction;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Product spec §4.17: "Interaction close sans next_action → Blocage UI :
   * demander la prochaine action." A client-side guard, not a server
   * automation — the other 4 automations are async/non-blocking (R-22); this
   * one is explicitly a UI block on save, so it lives entirely here.
   */
  const [showNextActionPrompt, setShowNextActionPrompt] = useState(false);
  const nextActionInputRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState(interaction?.type ?? 'APPEL');
  const [direction, setDirection] = useState(interaction?.direction ?? '');
  const [subject, setSubject] = useState(interaction?.subject ?? '');
  const [body, setBody] = useState(interaction?.body ?? '');
  const [occurredAt, setOccurredAt] = useState(
    interaction ? toDatetimeLocal(interaction.occurredAt) : toDatetimeLocal(new Date().toISOString()),
  );
  const [durationMinutes, setDurationMinutes] = useState(interaction?.durationMinutes?.toString() ?? '');
  const [outcome, setOutcome] = useState(interaction?.outcome ?? '');
  const [organization, setOrganization] = useState<{ id: string; label: string } | null>(
    lockedOrganizationId
      ? { id: lockedOrganizationId, label: lockedOrganizationLabel ?? '' }
      : interaction?.organizationId
        ? { id: interaction.organizationId, label: '' } // resolved lazily; picker keeps working via id
        : null,
  );
  const [contact, setContact] = useState<{ id: string; label: string } | null>(
    lockedContactId
      ? { id: lockedContactId, label: lockedContactLabel ?? '' }
      : interaction?.contactId
        ? { id: interaction.contactId, label: '' }
        : null,
  );
  const [nextAction, setNextAction] = useState(interaction?.nextAction ?? '');
  const [nextActionDate, setNextActionDate] = useState(interaction?.nextActionDate ?? '');
  const [nextActionDone, setNextActionDone] = useState(interaction?.nextActionDone ?? false);

  // Re-seed every field from the CURRENT `interaction` prop each time the
  // dialog opens — same staleness bug and fix as TaskFormDialog (see its
  // comment): this component is mounted once per row for the list's whole
  // lifetime, so `useState(interaction?.field)` initializers never re-run
  // after the first mount even if the row's data changes later.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setShowNextActionPrompt(false);
    setType(interaction?.type ?? 'APPEL');
    setDirection(interaction?.direction ?? '');
    setSubject(interaction?.subject ?? '');
    setBody(interaction?.body ?? '');
    setOccurredAt(interaction ? toDatetimeLocal(interaction.occurredAt) : toDatetimeLocal(new Date().toISOString()));
    setDurationMinutes(interaction?.durationMinutes?.toString() ?? '');
    setOutcome(interaction?.outcome ?? '');
    setOrganization(
      lockedOrganizationId
        ? { id: lockedOrganizationId, label: lockedOrganizationLabel ?? '' }
        : interaction?.organizationId
          ? { id: interaction.organizationId, label: '' }
          : null,
    );
    setContact(
      lockedContactId
        ? { id: lockedContactId, label: lockedContactLabel ?? '' }
        : interaction?.contactId
          ? { id: interaction.contactId, label: '' }
          : null,
    );
    setNextAction(interaction?.nextAction ?? '');
    setNextActionDate(interaction?.nextActionDate ?? '');
    setNextActionDone(interaction?.nextActionDone ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Edit mode, linked entity not locked by the parent page (i.e. opened from
  // the standalone /activities list): the row only carries an id, so resolve
  // its display name once so the picker doesn't show a blank chip.
  useEffect(() => {
    if (!open || !isEdit) return;
    if (!lockedOrganizationId && interaction?.organizationId) {
      fetch(`/api/metworkcrm/organizations/${interaction.organizationId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setOrganization({ id: interaction.organizationId!, label: data.organization?.name ?? '' }))
        .catch(() => {});
    }
    if (!lockedContactId && interaction?.contactId) {
      fetch(`/api/metworkcrm/contacts/${interaction.contactId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setContact({ id: interaction.contactId!, label: data.contact?.fullName ?? '' }))
        .catch(() => {});
    }
    // Only ever needs to run once per dialog open — deliberately not
    // depending on `interaction` identity beyond the initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Block on close without a next action (product spec §4.17) — one extra
    // click either fills it in or explicitly confirms none is needed; not
    // persisted anywhere, so re-saving with the fields still empty asks again.
    if (!nextAction.trim() && !nextActionDate && !showNextActionPrompt) {
      setShowNextActionPrompt(true);
      return;
    }

    setSaving(true);
    setError(null);

    const occurredAtIso = new Date(occurredAt).toISOString();
    const payload = {
      type,
      direction: direction || undefined,
      subject,
      body: body || undefined,
      occurredAt: occurredAtIso,
      durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
      outcome: outcome || undefined,
      organizationId: lockedOrganizationId ?? organization?.id ?? '',
      contactId: lockedContactId ?? contact?.id ?? '',
      opportunityId: lockedOpportunityId,
      startupId: lockedStartupId,
      expertId: lockedExpertId,
      partnershipId: lockedPartnershipId,
      programId: lockedProgramId,
      oiProjectId: lockedOiProjectId,
      nextAction: nextAction || undefined,
      nextActionDate: nextActionDate || undefined,
      nextActionDone,
    };

    let res: Response;
    try {
      res = await fetch(
        isEdit ? `/api/metworkcrm/interactions/${interaction!.id}` : '/api/metworkcrm/interactions',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
    } catch {
      setError('Impossible de contacter le serveur. Vérifiez votre connexion.');
      setSaving(false);
      return;
    }

    if (!res.ok) {
      let data: { error?: { message?: string } };
      try {
        data = await res.json();
      } catch {
        setError(`Réponse du serveur invalide (code ${res.status}). Réessayez ou contactez l'équipe technique.`);
        setSaving(false);
        return;
      }
      setError(data?.error?.message ?? 'Une erreur est survenue.');
      setSaving(false);
      return;
    }
    setSaving(false);
    setOpen(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifier l'interaction" : 'Nouvelle interaction'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type" htmlFor="int-type" required>
              <select
                id="int-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20"
              >
                {Object.entries(INTERACTION_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Sens" htmlFor="int-direction">
              <select
                id="int-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                className="h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20"
              >
                <option value="">—</option>
                {Object.entries(INTERACTION_DIRECTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Objet" htmlFor="int-subject" required>
            <Input id="int-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200} />
          </FormField>

          {/*
            grid-cols-1 not grid-cols-2: a native `datetime-local` widget needs
            ~180px to render its date+time segments without clipping (measured
            at 140px in a bare 2-col half at 375px — the value was intact, just
            visually truncated). Stacking below `sm` gives it the full row;
            side-by-side returns once there's room.
          */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Date et heure" htmlFor="int-occurred" required>
              <Input
                id="int-occurred"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Durée (min)" htmlFor="int-duration">
              <Input
                id="int-duration"
                type="number"
                min={0}
                max={1440}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
              />
            </FormField>
          </div>

          {!lockedOrganizationId ? (
            <FormField label="Organisation" htmlFor="int-org">
              <EntityPicker kind="organization" value={organization} onChange={setOrganization} />
            </FormField>
          ) : null}
          {!lockedContactId ? (
            <FormField label="Contact" htmlFor="int-contact">
              <EntityPicker kind="contact" value={contact} onChange={setContact} />
            </FormField>
          ) : null}

          <FormField label="Notes" htmlFor="int-body">
            <Textarea id="int-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          </FormField>

          <FormField label="Résultat" htmlFor="int-outcome">
            <Input id="int-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={200} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Prochaine action" htmlFor="int-next-action">
              <Input
                id="int-next-action"
                ref={nextActionInputRef}
                value={nextAction}
                onChange={(e) => {
                  setNextAction(e.target.value);
                  if (showNextActionPrompt) setShowNextActionPrompt(false);
                }}
                maxLength={200}
              />
            </FormField>
            <FormField label="Date de l'action" htmlFor="int-next-date">
              <Input
                id="int-next-date"
                type="date"
                value={nextActionDate}
                onChange={(e) => setNextActionDate(e.target.value)}
              />
            </FormField>
          </div>

          {nextAction || nextActionDate ? (
            <label className="flex items-center gap-2 text-sm text-neutral-600">
              <input
                type="checkbox"
                checked={nextActionDone}
                onChange={(e) => setNextActionDone(e.target.checked)}
                className="size-4 rounded border-neutral-300 text-[var(--crm-green)] focus:ring-[var(--crm-green)]"
              />
              Action déjà réalisée
            </label>
          ) : null}

          {showNextActionPrompt ? (
            <div role="alert" className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <p>Aucune prochaine action n'est renseignée pour cette interaction.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <CrmButton
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowNextActionPrompt(false);
                    nextActionInputRef.current?.focus();
                  }}
                >
                  Ajouter une action
                </CrmButton>
                <CrmButton type="submit" size="sm" loading={saving}>
                  Aucune action nécessaire, continuer
                </CrmButton>
              </div>
            </div>
          ) : null}

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
              {isEdit ? 'Enregistrer' : 'Ajouter'}
            </CrmButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
