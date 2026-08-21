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
import { PROGRAM_STAGE_LABELS, PROGRAM_TYPE_LABELS } from '@/components/metworkcrm/shared/labels';

export interface ProgramRow {
  id: string;
  title: string;
  type: string;
  stage: string;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  venue: string | null;
  capacity: number | null;
  price: number | null;
  description: string | null;
}

const selectClass =
  'h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function ProgramFormDialog({
  trigger,
  program,
  onSaved,
}: {
  trigger: React.ReactNode;
  program?: ProgramRow;
  onSaved: (id: string) => void;
}) {
  const isEdit = !!program;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(program?.title ?? '');
  const [type, setType] = useState(program?.type ?? 'FORMATION');
  const [stage, setStage] = useState(program?.stage ?? 'IDEE');
  const [startDate, setStartDate] = useState(program?.startDate ?? '');
  const [endDate, setEndDate] = useState(program?.endDate ?? '');
  const [city, setCity] = useState(program?.city ?? '');
  const [venue, setVenue] = useState(program?.venue ?? '');
  const [capacity, setCapacity] = useState(program?.capacity != null ? String(program.capacity) : '');
  const [price, setPrice] = useState(program?.price != null ? String(program.price) : '');
  const [description, setDescription] = useState(program?.description ?? '');

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle(program?.title ?? '');
    setType(program?.type ?? 'FORMATION');
    setStage(program?.stage ?? 'IDEE');
    setStartDate(program?.startDate ?? '');
    setEndDate(program?.endDate ?? '');
    setCity(program?.city ?? '');
    setVenue(program?.venue ?? '');
    setCapacity(program?.capacity != null ? String(program.capacity) : '');
    setPrice(program?.price != null ? String(program.price) : '');
    setDescription(program?.description ?? '');
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
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      city: city || undefined,
      venue: venue || undefined,
      capacity: capacity ? Number(capacity) : undefined,
      price: price ? Number(price) : undefined,
      description: description || undefined,
    };

    try {
      const res = await fetch(isEdit ? `/api/metworkcrm/programs/${program!.id}` : '/api/metworkcrm/programs', {
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
          <DialogTitle>{isEdit ? 'Modifier le programme' : 'Nouveau programme'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <FormField label="Titre" htmlFor="prog-title" required>
            <Input id="prog-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type" htmlFor="prog-type" required>
              <select id="prog-type" value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
                {Object.entries(PROGRAM_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Étape" htmlFor="prog-stage" required>
              <select id="prog-stage" value={stage} onChange={(e) => setStage(e.target.value)} className={selectClass}>
                {Object.entries(PROGRAM_STAGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Début" htmlFor="prog-start">
              <Input id="prog-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </FormField>
            <FormField label="Fin" htmlFor="prog-end">
              <Input id="prog-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Ville" htmlFor="prog-city">
              <Input id="prog-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </FormField>
            <FormField label="Lieu" htmlFor="prog-venue">
              <Input id="prog-venue" value={venue} onChange={(e) => setVenue(e.target.value)} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Capacité" htmlFor="prog-capacity">
              <Input id="prog-capacity" type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </FormField>
            <FormField label="Prix (DZD)" htmlFor="prog-price">
              <Input id="prog-price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
            </FormField>
          </div>

          <FormField label="Description" htmlFor="prog-description">
            <Textarea id="prog-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
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
