'use client';

/**
 * « Réorganiser l'ordre » — the order of the mentors on the public site
 * (mentors page, home carousel, entrepreneur dashboard, directory).
 *
 * Only the mentors on the site are listed: theirs is the only order anyone
 * sees. Drag a row on a computer, or use ↑ ↓ — on a phone, and from the
 * keyboard. Nothing reaches the site until « Enregistrer l'ordre ».
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, GripVertical, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Mentor } from '@/types/mentor';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The mentors on the site, in their current public order. */
  mentors: Mentor[];
  /** Persists the order; throws with a readable message on failure. */
  onSave: (ids: string[]) => Promise<void>;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export function MentorOrderDialog({ open, onOpenChange, mentors, onSave }: Props) {
  const t = useTranslations('admin.mentorsManager');
  const [order, setOrder] = useState<Mentor[]>(mentors);
  const [dragging, setDragging] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh copy each time the panel opens — closing without saving discards.
  useEffect(() => {
    if (open) { setOrder(mentors); setError(null); }
  }, [open, mentors]);

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((list) => {
      const next = list.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  }

  const changed = order.some((m, i) => m.id !== mentors[i]?.id);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(order.map((m) => m.id));
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('orderSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('orderTitle')}</DialogTitle>
          <DialogDescription>{t('orderHint')}</DialogDescription>
        </DialogHeader>

        {order.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('orderEmpty')}</p>
        ) : (
          <ol className="divide-y divide-border rounded-lg border border-border" aria-label={t('orderTitle')}>
            {order.map((m, i) => (
              <li
                key={m.id}
                draggable
                onDragStart={(e) => { setDragging(m.id); e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragging || dragging === m.id) return;
                  const from = order.findIndex((x) => x.id === dragging);
                  if (from !== -1) move(from, i);
                }}
                className={cn(
                  'grid grid-cols-[1.25rem_1.75rem_2.25rem_minmax(0,1fr)_auto] items-center gap-2.5 bg-card px-3 py-2',
                  dragging === m.id && 'bg-primary/5 ring-1 ring-primary',
                )}
              >
                <GripVertical className="size-4 cursor-grab text-muted-foreground max-sm:invisible" aria-hidden />
                <span className="text-center text-sm font-bold tabular-nums text-primary">{i + 1}</span>
                {m.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- mentor photo, as on the cards
                  <img src={m.imageUrl} alt="" className="size-9 rounded-full object-cover" />
                ) : (
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {initials(m.fullName)}
                  </span>
                )}
                <span className="min-w-0">
                  {/* dir="auto": a Latin name in the Arabic interface still
                      reads — and is cut — from its own start. */}
                  <span dir="auto" className="block truncate text-start text-sm font-medium">{m.fullName}</span>
                  <span dir="auto" className="block truncate text-start text-xs text-muted-foreground">{m.position}</span>
                </span>
                <span className="flex gap-1">
                  <Button
                    type="button" size="icon" variant="outline" className="size-8"
                    disabled={i === 0 || saving}
                    onClick={() => move(i, i - 1)}
                    aria-label={t('moveUp', { name: m.fullName })}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button" size="icon" variant="outline" className="size-8"
                    disabled={i === order.length - 1 || saving}
                    onClick={() => move(i, i + 1)}
                    aria-label={t('moveDown', { name: m.fullName })}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('orderCancel')}</Button>
          <Button onClick={() => void save()} disabled={!changed || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('orderSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
