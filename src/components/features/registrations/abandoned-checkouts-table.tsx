'use client';

/**
 * People who filled in the form and never finished paying.
 *
 * These are leads, not records — the host's job here is to pick up the phone.
 * So the phone number is not tucked into a detail row: it is a tap-to-call
 * link, sitting next to the name, because that is the single thing this view
 * exists to deliver.
 *
 * Everything shown was captured when they started checkout and has been in the
 * database all along — see `@/server/registrations/abandoned-checkouts`.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Phone, Mail, Loader2, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { questionLabel } from '@/lib/registration-question';
import type { RegistrationFormField } from '@/types/domain';

interface AbandonedCheckout {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  amount: number;
  answers: Array<{ fieldId: string; value: string | string[] }>;
  lastAttemptAt: string;
  attempts: number;
}

interface Props {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  endpoint?: '/api/incubator/registrations' | '/api/consultant/registrations';
}

export function AbandonedCheckoutsTable({
  entityType,
  entityId,
  endpoint = '/api/incubator/registrations',
}: Props) {
  const t = useTranslations('abandonedCheckouts');
  const [items, setItems] = useState<AbandonedCheckout[] | null>(null);
  const [fields, setFields] = useState<RegistrationFormField[]>([]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ entityType, entityId, view: 'abandoned' });
      const res = await fetch(`${endpoint}?${params}`, { credentials: 'include' });
      const body = await res.json().catch(() => null);
      setItems(res.ok ? (body?.items ?? []) : []);
      setFields(body?.formFields ?? []);
    } catch {
      setItems([]);
    }
  }, [entityType, entityId, endpoint]);

  useEffect(() => { void load(); }, [load]);

  if (items === null) {
    return (
      <div className="flex justify-center py-10 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{t('title')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle', { count: items.length })}</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()}>
          <RotateCcw className="size-4" /> {t('refresh')}
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm font-medium">{t('emptyTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('emptyBody')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <AbandonedRow key={item.id} item={item} fields={fields} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AbandonedRow({
  item,
  fields,
}: {
  item: AbandonedCheckout;
  fields: RegistrationFormField[];
}) {
  const t = useTranslations('abandonedCheckouts');
  const tq = useTranslations();
  const [open, setOpen] = useState(false);

  const answered = item.answers.filter((a) =>
    Array.isArray(a.value) ? a.value.length > 0 : String(a.value).trim() !== '',
  );

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{item.fullName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {new Date(item.lastAttemptAt).toLocaleString()} ·{' '}
            {item.amount.toLocaleString('fr-DZ')} DZD
          </p>
        </div>
        {/* A second attempt usually means the payment FAILED rather than that
            they changed their mind — say so, it changes how you open the call. */}
        {item.attempts > 1 && (
          <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
            {t('attempts', { count: item.attempts })}
          </span>
        )}
      </div>

      {/* The reason this page exists. Tap-to-call on a phone, one tap to mail. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {item.phone && (
          <a
            href={`tel:${item.phone.replace(/\s/g, '')}`}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-700"
          >
            <Phone className="size-3.5" />
            <span dir="ltr">{item.phone}</span>
          </a>
        )}
        {item.email && (
          <a
            href={`mailto:${item.email}`}
            className="inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm transition-colors hover:bg-accent"
          >
            <Mail className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{item.email}</span>
          </a>
        )}
      </div>

      {answered.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {open ? t('hideAnswers') : t('viewAnswers', { count: answered.length })}
            {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>

          {open && (
            <dl className="mt-3 space-y-2 border-t border-border pt-3">
              {answered.map((answer) => {
                const field = fields.find((f) => f.id === answer.fieldId);
                return (
                  <div key={answer.fieldId}>
                    <dt className="text-xs font-medium text-muted-foreground">
                      {/* Falls back to the id so an answer to a DELETED question
                          is still shown — losing the label is not a reason to
                          lose what the person wrote. */}
                      {field ? questionLabel(field, tq) : answer.fieldId}
                    </dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm">
                      {Array.isArray(answer.value) ? answer.value.join(', ') : answer.value}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </>
      )}
    </li>
  );
}
