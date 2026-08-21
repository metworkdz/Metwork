'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { TaskFormDialog, type TaskRow } from '@/components/metworkcrm/tasks/task-form-dialog';
import { DocumentUpload, type DocumentRow } from '@/components/metworkcrm/shared/document-upload';
import {
  BOOKING_STATUS_BADGE,
  BOOKING_STATUS_LABELS,
  SPACE_TYPE_LABELS,
  TASK_PRIORITY_BADGE,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from '@/components/metworkcrm/shared/labels';
import { SpaceBookingFormDialog, type SpaceBookingRow } from './space-booking-form-dialog';

export interface SpaceBookingDetailData {
  booking: SpaceBookingRow;
  organization: { id: string; name: string } | null;
  contact: { id: string; fullName: string | null; firstName: string; lastName: string } | null;
  opportunity: { id: string; title: string } | null;
  tasks: TaskRow[];
  documents: DocumentRow[];
}

export function SpaceBookingDetail({ initial }: { initial: SpaceBookingDetailData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const res = await fetch(`/api/metworkcrm/space-bookings/${initial.booking.id}`);
    if (res.ok) setData(await res.json());
    refreshing.current = false;
  }, [initial.booking.id]);

  const booking = data.booking;

  async function onDelete() {
    if (!confirm(`Supprimer la réservation « ${booking.reference} » ? Cette action est irréversible.`)) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/metworkcrm/space-bookings/${booking.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/metworkcrm/spaces');
      return;
    }
    const body = await res.json().catch(() => null);
    setDeleteError(body?.error?.message ?? 'Suppression impossible.');
    setDeleting(false);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-[var(--crm-black)]">{booking.spaceLabel}</h1>
              <Badge variant={BOOKING_STATUS_BADGE[booking.status] ?? 'default'}>{BOOKING_STATUS_LABELS[booking.status] ?? booking.status}</Badge>
            </div>
            <p className="text-sm text-neutral-500">
              {booking.reference} · {SPACE_TYPE_LABELS[booking.spaceType] ?? booking.spaceType}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-neutral-600">
              {booking.startAt ? <span>Début : {new Date(booking.startAt).toLocaleString('fr-FR')}</span> : null}
              {booking.endAt ? <span>Fin : {new Date(booking.endAt).toLocaleString('fr-FR')}</span> : null}
              {booking.attendees != null ? (
                <span className="inline-flex items-center gap-1.5"><Users className="size-3.5 text-neutral-400" aria-hidden /> {booking.attendees}</span>
              ) : null}
              {data.organization ? (
                <a href={`/metworkcrm/organizations/${data.organization.id}`} className="hover:text-[var(--crm-green)]">{data.organization.name}</a>
              ) : null}
              {data.contact ? (
                <a href={`/metworkcrm/contacts/${data.contact.id}`} className="hover:text-[var(--crm-green)]">
                  {data.contact.fullName ?? `${data.contact.firstName} ${data.contact.lastName}`}
                </a>
              ) : null}
              {data.opportunity ? (
                <a href={`/metworkcrm/sales/${data.opportunity.id}`} className="hover:text-[var(--crm-green)]">{data.opportunity.title}</a>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-neutral-600">
              {booking.quotedAmount != null ? `Devis : ${booking.quotedAmount.toLocaleString('fr-FR')} DZD` : ''}
              {booking.finalAmount != null ? `${booking.quotedAmount != null ? ' · ' : ''}Montant final : ${booking.finalAmount.toLocaleString('fr-FR')} DZD` : ''}
            </p>
            {booking.notes ? <p className="mt-2 max-w-2xl rounded-md bg-neutral-50 p-2 text-xs text-neutral-500">{booking.notes}</p> : null}
          </div>

          <div className="flex shrink-0 gap-2">
            <SpaceBookingFormDialog booking={booking} onSaved={refresh} trigger={<CrmButton variant="outline" size="sm">Modifier</CrmButton>} />
            <CrmButton variant="destructive" size="sm" loading={deleting} onClick={onDelete}>Supprimer</CrmButton>
          </div>
        </div>
        {deleteError ? <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--crm-black)]">
                Tâches <span className="font-normal text-neutral-400">({data.tasks.length})</span>
              </h3>
              <TaskFormDialog
                lockedBookingId={booking.id}
                onSaved={refresh}
                trigger={
                  <button type="button" className="inline-flex size-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600">
                    <Plus className="size-4" aria-hidden />
                  </button>
                }
              />
            </div>
            <ul className="space-y-2">
              {data.tasks.map((t) => (
                <TaskFormDialog
                  key={t.id}
                  task={t}
                  lockedBookingId={booking.id}
                  onSaved={refresh}
                  trigger={
                    <li className="cursor-pointer rounded-md p-1.5 text-sm hover:bg-neutral-50">
                      <div className="flex items-center gap-2">
                        <Badge variant={TASK_PRIORITY_BADGE[t.priority] ?? 'default'}>{TASK_PRIORITY_LABELS[t.priority] ?? t.priority}</Badge>
                        <span className="min-w-0 flex-1 truncate text-[var(--crm-black)]">{t.title}</span>
                      </div>
                      <p className="ms-0.5 mt-0.5 text-xs text-neutral-400">
                        {TASK_STATUS_LABELS[t.status] ?? t.status}
                        {t.dueDate ? ` · ${t.dueDate}` : ''}
                      </p>
                    </li>
                  }
                />
              ))}
              {data.tasks.length === 0 ? <li className="text-sm text-neutral-400">Aucune tâche.</li> : null}
            </ul>
          </div>
        </div>

        <div className="space-y-6">
          <DocumentUpload entityType="SPACE_BOOKING" entityId={booking.id} initial={data.documents} />
        </div>
      </div>
    </div>
  );
}
