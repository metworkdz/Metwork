'use client';

/**
 * Replaces a contact's FULL organization-link set in one call — matches the
 * PUT /api/metworkcrm/contacts/:id/organizations contract (replace-the-set,
 * not incremental link/unlink).
 */
import { useState } from 'react';
import { Star } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { EntityPicker } from '@/components/metworkcrm/shared/entity-picker';
import { extractApiErrorMessage } from '@/components/metworkcrm/shared/api-error';
import { cn } from '@/lib/utils';

export interface LinkedOrganization {
  id: string;
  name: string;
  role: string | null;
  isPrimary: boolean;
}

interface DraftLink {
  organizationId: string;
  label: string;
  role: string;
  isPrimary: boolean;
}

export function ContactOrganizationsEditor({
  contactId,
  organizations,
  trigger,
  onSaved,
}: {
  contactId: string;
  organizations: LinkedOrganization[];
  trigger: React.ReactNode;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<DraftLink[]>(() =>
    organizations.map((o) => ({ organizationId: o.id, label: o.name, role: o.role ?? '', isPrimary: o.isPrimary })),
  );
  const [addValue, setAddValue] = useState<{ id: string; label: string } | null>(null);

  function addOrg() {
    if (!addValue || links.some((l) => l.organizationId === addValue.id)) return;
    setLinks((prev) => [
      ...prev,
      { organizationId: addValue.id, label: addValue.label, role: '', isPrimary: prev.length === 0 },
    ]);
    setAddValue(null);
  }

  function removeOrg(id: string) {
    setLinks((prev) => prev.filter((l) => l.organizationId !== id));
  }

  function setPrimary(id: string) {
    setLinks((prev) => prev.map((l) => ({ ...l, isPrimary: l.organizationId === id })));
  }

  function setRole(id: string, role: string) {
    setLinks((prev) => prev.map((l) => (l.organizationId === id ? { ...l, role } : l)));
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/metworkcrm/contacts/${contactId}/organizations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizations: links.map((l) => ({
            organizationId: l.organizationId,
            role: l.role || undefined,
            isPrimary: l.isPrimary,
          })),
        }),
      });
    } catch {
      setError('Impossible de contacter le serveur. Vérifiez votre connexion.');
      setSaving(false);
      return;
    }

    let data: { error?: { message?: string; details?: { fieldErrors?: Record<string, string[]> } } };
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
    onSaved();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          // Re-sync the draft to the latest server state every time it opens.
          setLinks(organizations.map((o) => ({ organizationId: o.id, label: o.name, role: o.role ?? '', isPrimary: o.isPrimary })));
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Organisations liées</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {links.length === 0 ? (
            <p className="text-sm text-neutral-400">Aucune organisation liée.</p>
          ) : (
            <ul className="space-y-2">
              {links.map((link) => (
                <li key={link.organizationId} className="flex items-center gap-2 rounded-md border border-neutral-200 p-2">
                  <button
                    type="button"
                    onClick={() => setPrimary(link.organizationId)}
                    aria-label={link.isPrimary ? 'Organisation principale' : 'Définir comme principale'}
                    className="shrink-0"
                  >
                    <Star
                      className={cn(
                        'size-4',
                        link.isPrimary ? 'fill-amber-400 text-amber-400' : 'text-neutral-300 hover:text-neutral-400',
                      )}
                    />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--crm-black)]">{link.label}</span>
                  <Input
                    value={link.role}
                    onChange={(e) => setRole(link.organizationId, e.target.value)}
                    placeholder="Rôle (ex. CEO)"
                    className="h-8 w-32 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => removeOrg(link.organizationId)}
                    className="shrink-0 text-xs text-red-600 hover:underline"
                  >
                    Retirer
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <EntityPicker kind="organization" value={addValue} onChange={setAddValue} />
            </div>
            <CrmButton type="button" size="sm" variant="outline" onClick={addOrg} disabled={!addValue}>
              Ajouter
            </CrmButton>
          </div>

          {error ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <CrmButton type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </CrmButton>
            <CrmButton type="button" loading={saving} onClick={onSave}>
              Enregistrer
            </CrmButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
