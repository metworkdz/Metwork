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
import { ORG_SIZE_LABELS, ORG_TYPE_LABELS, RECORD_STATUS_LABELS } from '@/components/metworkcrm/shared/labels';
import { extractApiErrorMessage } from '@/components/metworkcrm/shared/api-error';

export interface OrganizationRow {
  id: string;
  name: string;
  legalName: string | null;
  type: string;
  sector: string | null;
  size: string | null;
  city: string | null;
  wilaya: string | null;
  website: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  description: string | null;
  status: string;
  notes: string | null;
}

const selectClass =
  'h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function OrganizationFormDialog({
  trigger,
  organization,
  onSaved,
}: {
  trigger: React.ReactNode;
  /** Present → edit mode. Absent → create mode. */
  organization?: OrganizationRow;
  onSaved: (id: string) => void;
}) {
  const isEdit = !!organization;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(organization?.name ?? '');
  const [legalName, setLegalName] = useState(organization?.legalName ?? '');
  const [type, setType] = useState(organization?.type ?? 'ENTREPRISE');
  const [sector, setSector] = useState(organization?.sector ?? '');
  const [size, setSize] = useState(organization?.size ?? '');
  const [city, setCity] = useState(organization?.city ?? '');
  const [wilaya, setWilaya] = useState(organization?.wilaya ?? '');
  const [website, setWebsite] = useState(organization?.website ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(organization?.linkedinUrl ?? '');
  const [email, setEmail] = useState(organization?.email ?? '');
  const [phone, setPhone] = useState(organization?.phone ?? '');
  const [address, setAddress] = useState(organization?.address ?? '');
  const [description, setDescription] = useState(organization?.description ?? '');
  const [status, setStatus] = useState(organization?.status ?? 'PROSPECT');
  const [notes, setNotes] = useState(organization?.notes ?? '');

  // Re-seed every field from the CURRENT `organization` prop each time the
  // dialog opens. This dialog stays mounted on the detail page for its whole
  // lifetime, so `useState(organization?.field)` initializers never re-run
  // after the first mount — a quick action elsewhere (e.g. "Archiver") that
  // updates the org would otherwise leave a previously-opened edit dialog
  // showing stale values. Caught in browser verification, not by tests.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(organization?.name ?? '');
    setLegalName(organization?.legalName ?? '');
    setType(organization?.type ?? 'ENTREPRISE');
    setSector(organization?.sector ?? '');
    setSize(organization?.size ?? '');
    setCity(organization?.city ?? '');
    setWilaya(organization?.wilaya ?? '');
    setWebsite(organization?.website ?? '');
    setLinkedinUrl(organization?.linkedinUrl ?? '');
    setEmail(organization?.email ?? '');
    setPhone(organization?.phone ?? '');
    setAddress(organization?.address ?? '');
    setDescription(organization?.description ?? '');
    setStatus(organization?.status ?? 'PROSPECT');
    setNotes(organization?.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name,
      legalName: legalName || undefined,
      type,
      sector: sector || undefined,
      size: size || undefined,
      city: city || undefined,
      wilaya: wilaya || undefined,
      website: website || undefined,
      linkedinUrl: linkedinUrl || undefined,
      email: email || undefined,
      phone: phone || undefined,
      address: address || undefined,
      description: description || undefined,
      status,
      notes: notes || undefined,
    };

    let res: Response;
    try {
      res = await fetch(
        isEdit ? `/api/metworkcrm/organizations/${organization!.id}` : '/api/metworkcrm/organizations',
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
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifier l'organisation" : 'Nouvelle organisation'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <FormField label="Nom" htmlFor="org-name" required>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
          </FormField>

          <FormField label="Raison sociale" htmlFor="org-legal">
            <Input id="org-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type" htmlFor="org-type" required>
              <select id="org-type" value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
                {Object.entries(ORG_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Statut" htmlFor="org-status" required>
              <select id="org-status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
                {Object.entries(RECORD_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Secteur" htmlFor="org-sector">
              <Input id="org-sector" value={sector} onChange={(e) => setSector(e.target.value)} />
            </FormField>
            <FormField label="Taille" htmlFor="org-size">
              <select id="org-size" value={size} onChange={(e) => setSize(e.target.value)} className={selectClass}>
                <option value="">—</option>
                {Object.entries(ORG_SIZE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Ville" htmlFor="org-city">
              <Input id="org-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </FormField>
            <FormField label="Wilaya" htmlFor="org-wilaya">
              <Input id="org-wilaya" value={wilaya} onChange={(e) => setWilaya(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Adresse" htmlFor="org-address">
            <Input id="org-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="E-mail" htmlFor="org-email">
              <Input id="org-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label="Téléphone" htmlFor="org-phone">
              <Input id="org-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Site web" htmlFor="org-website">
              <Input id="org-website" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
            </FormField>
            <FormField label="LinkedIn" htmlFor="org-linkedin">
              <Input id="org-linkedin" type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://…" />
            </FormField>
          </div>

          <FormField label="Description" htmlFor="org-description">
            <Textarea id="org-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </FormField>

          <FormField label="Notes internes" htmlFor="org-notes">
            <Textarea id="org-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
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
