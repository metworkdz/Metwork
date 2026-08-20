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
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/components/metworkcrm/shared/labels';

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueDate: string | null;
  assigneeId: string | null;
  contactId: string | null;
  organizationId: string | null;
}

interface TeamMember {
  id: string;
  name: string;
}

const selectClass =
  'h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function TaskFormDialog({
  trigger,
  task,
  lockedOrganizationId,
  lockedOrganizationLabel,
  lockedContactId,
  lockedContactLabel,
  onSaved,
}: {
  trigger: React.ReactNode;
  /** Present → edit mode. Absent → create mode. */
  task?: TaskRow;
  lockedOrganizationId?: string;
  lockedOrganizationLabel?: string;
  lockedContactId?: string;
  lockedContactLabel?: string;
  onSaved: () => void;
}) {
  const isEdit = !!task;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [priority, setPriority] = useState(task?.priority ?? 'MOYENNE');
  const [status, setStatus] = useState(task?.status ?? 'INBOX');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? '');
  const [organization, setOrganization] = useState<{ id: string; label: string } | null>(
    lockedOrganizationId ? { id: lockedOrganizationId, label: lockedOrganizationLabel ?? '' } : null,
  );
  const [contact, setContact] = useState<{ id: string; label: string } | null>(
    lockedContactId ? { id: lockedContactId, label: lockedContactLabel ?? '' } : null,
  );

  // Re-seed every field from the CURRENT `task` prop each time the dialog
  // opens. Without this, a dialog left mounted in a list (one per row, as in
  // TasksList) keeps whatever state it had on its FIRST open forever — a
  // quick inline edit elsewhere (e.g. the status <select> in the table row)
  // updates the row's data, but this component's `useState(task?.status)`
  // initializer never re-runs on a prop change, so reopening the dialog shows
  // stale values. Caught in browser verification, not by tests.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setPriority(task?.priority ?? 'MOYENNE');
    setStatus(task?.status ?? 'INBOX');
    setDueDate(task?.dueDate ?? '');
    setAssigneeId(task?.assigneeId ?? '');
    setOrganization(lockedOrganizationId ? { id: lockedOrganizationId, label: lockedOrganizationLabel ?? '' } : null);
    setContact(lockedContactId ? { id: lockedContactId, label: lockedContactLabel ?? '' } : null);
    fetch('/api/metworkcrm/team')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((data) => setTeam(data.rows))
      .catch(() => setTeam([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Resolve unlocked linked-entity names when editing from the standalone
  // /tasks list — see the identical note in interaction-form-dialog.tsx.
  useEffect(() => {
    if (!open || !isEdit) return;
    if (!lockedOrganizationId && task?.organizationId) {
      fetch(`/api/metworkcrm/organizations/${task.organizationId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setOrganization({ id: task.organizationId!, label: data.organization?.name ?? '' }))
        .catch(() => {});
    }
    if (!lockedContactId && task?.contactId) {
      fetch(`/api/metworkcrm/contacts/${task.contactId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setContact({ id: task.contactId!, label: data.contact?.fullName ?? '' }))
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
      description: description || undefined,
      priority,
      status,
      dueDate: dueDate || undefined,
      assigneeId: assigneeId || undefined,
      organizationId: lockedOrganizationId ?? organization?.id ?? '',
      contactId: lockedContactId ?? contact?.id ?? '',
    };

    try {
      const res = await fetch(isEdit ? `/api/metworkcrm/tasks/${task!.id}` : '/api/metworkcrm/tasks', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(data?.error?.message ?? 'Une erreur est survenue.');
        setSaving(false);
        return;
      }
      setSaving(false);
      setOpen(false);
      onSaved();
    } catch {
      setError('Erreur réseau. Réessayez.');
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifier la tâche' : 'Nouvelle tâche'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <FormField label="Titre" htmlFor="task-title" required>
            <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          </FormField>

          <FormField label="Description" htmlFor="task-description">
            <Textarea id="task-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Priorité" htmlFor="task-priority" required>
              <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={selectClass}>
                {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Statut" htmlFor="task-status" required>
              <select id="task-status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
                {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Échéance" htmlFor="task-due">
              <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </FormField>
            <FormField label="Assigné à" htmlFor="task-assignee">
              <select id="task-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={selectClass}>
                <option value="">—</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          {!lockedOrganizationId ? (
            <FormField label="Organisation" htmlFor="task-org">
              <EntityPicker kind="organization" value={organization} onChange={setOrganization} />
            </FormField>
          ) : null}
          {!lockedContactId ? (
            <FormField label="Contact" htmlFor="task-contact">
              <EntityPicker kind="contact" value={contact} onChange={setContact} />
            </FormField>
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
              {isEdit ? 'Enregistrer' : 'Créer'}
            </CrmButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
