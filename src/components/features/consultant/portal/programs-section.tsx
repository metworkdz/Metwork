'use client';

/**
 * Programs — trainings, workshops and webinars a consultant runs.
 *
 * Backed by the SAME ProgramRecord + registration system incubators use; this
 * surface only supplies the consultant identity. Two views:
 *   • list   — the consultant's own programs, publish/unpublish, delete
 *   • detail — registrants (with CSV export) for one program
 *
 * Money model: programs may be free or paid. A paid program settles through
 * the SAME card-payment path incubator programs use, crediting the
 * consultant's own mentorId-keyed ledger instead of an incubator wallet — see
 * `@/server/bookings/card-payment.ts` and `@/server/mentors/ledger.ts`. Free
 * enrolment still goes through the no-payment registration flow.
 *
 * Mobile-first with Tailwind breakpoints only (no useMediaQuery), so server and
 * client render identically.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowLeft, Copy, GraduationCap, Loader2, Pencil, Plus, Settings2, Trash2, Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { GalleryUploadField } from '@/components/shared/gallery-upload-field';
import { resolveListingPricing } from '@/lib/listing-price';
import { RegistrationsTable } from '@/components/features/registrations/registrations-table';
import { RegistrationFormBuilder } from '@/components/features/registrations/form-builder';
import type { RegistrationFormField } from '@/types/domain';
import { buildDefaultApplicationFields } from '@/server/programs/default-application-questions';
import { AlgerianCitySelect } from '@/components/shared/algerian-city-select';
import {
  consultantService,
  type ConsultantProgram,
} from '@/services/consultant.service';
import {
  BrandButton, EmptyBlock, ErrorBanner, Field, FlowSheet, GhostButton, SectionCard, SectionHeading, Spinner,
  cpInputClassLight,
} from './shared';

import {
  PROGRAM_TYPES,
  emptyProgramForm,
  programFormFromRecord,
  programFormToPayload,
  togglePaymentMethod,
  validateProgramForm,
  type PaymentMethod,
  type ProgramFormValues,
} from '@/lib/program-form';

/** "YYYY-MM-DD" for today, local time. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
}

export function ProgramsSection() {
  const t = useTranslations('consultantPortal.programs');
  const tQuestions = useTranslations('defaultQuestions');
  // Shared with the incubator dashboard — one rule set, one set of messages.
  const tError = useTranslations('programFormErrors');
  const locale = useLocale();

  const [items, setItems] = useState<ConsultantProgram[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ProgramFormValues>(emptyProgramForm);
  /** Set while editing an existing program; null while creating a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConsultantProgram | null>(null);

  const set = <K extends keyof ProgramFormValues>(k: K, v: ProgramFormValues[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  function openCreate() {
    setDraft(emptyProgramForm());
    setEditingId(null);
    setError(null);
    setOpenForm(true);
  }

  function openEdit(p: ConsultantProgram) {
    setDraft(programFormFromRecord(p));
    setEditingId(p.id);
    setError(null);
    setOpenForm(true);
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await consultantService.programs();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('errorGeneric'));
      setItems([]);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Pre-populate a NEW program's application form with the default question
   * set, carrying the i18n keys so each question renders in the VISITOR's
   * locale rather than the consultant's. Best-effort: seeding must never block
   * program creation.
   */
  async function seedDefaultQuestions(programId: string) {
    try {
      const fields = buildDefaultApplicationFields((k) => tQuestions(k));
      await fetch('/api/consultant/registration-form', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: 'PROGRAM', entityId: programId, fields }),
      });
    } catch {
      // swallow — seeding is non-critical
    }
  }

  async function onSave() {
    const invalid = validateProgramForm(draft);
    if (invalid) { setError(tError(invalid)); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = programFormToPayload(draft);
      if (editingId) {
        await consultantService.updateProgram(editingId, payload);
      } else {
        const created = await consultantService.createProgram(payload);
        // Seed the application form, exactly as the incubator dialog does.
        // Without this a consultant's public page asked for a name and a card
        // and nothing else, while an incubator's asked the full question set —
        // the two populations share one registration system.
        if (created?.id) await seedDefaultQuestions(created.id);
      }
      setOpenForm(false);
      setEditingId(null);
      setDraft(emptyProgramForm());
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  async function onTogglePublish(p: ConsultantProgram, publish: boolean) {
    try {
      await consultantService.updateProgram(p.id, { status: publish ? 'PUBLISHED' : 'DRAFT' });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('errorGeneric'));
    }
  }

  async function onDelete(p: ConsultantProgram) {
    if (!window.confirm(t('confirmDelete', { title: p.title }))) return;
    try {
      await consultantService.deleteProgram(p.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('errorGeneric'));
    }
  }

  if (selected) {
    return <ProgramDetailView program={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <SectionCard>
      <SectionHeading
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <BrandButton tone="light" onClick={openCreate}>
            <Plus className="size-4" /> {t('create')}
          </BrandButton>
        }
      />

      {error && <div className="mb-3"><ErrorBanner message={error} tone="light" /></div>}

      {items === null ? (
        <div className="flex justify-center py-10"><Spinner tone="light" /></div>
      ) : items.length === 0 ? (
        <EmptyBlock>
          <GraduationCap className="mx-auto mb-2 size-7 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{t('emptyTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('emptyBody')}</p>
        </EmptyBlock>
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li
              key={p.id}
              className="rounded-md border p-3 sm:p-4 border-border"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {p.title}
                    </h3>
                    <Badge variant="primary">{t(`type.${p.type}` as 'type.TRAINING')}</Badge>
                    <Badge variant={p.isActive ? 'success' : 'warning'}>
                      {p.isActive ? t('statusPublished') : t('statusDraft')}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {p.city} · {fmtDate(p.startDate, locale)} → {fmtDate(p.endDate, locale)}
                  </p>
                  <p className="mt-1 text-xs text-primary">
                    {t('seats', { taken: p.seatsTaken, total: p.seatsTotal })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <GhostButton tone="light" onClick={() => setSelected(p)}>
                    <Users className="size-3.5" /> {t('registrants')}
                  </GhostButton>
                  <GhostButton tone="light" onClick={() => openEdit(p)}>
                    <Pencil className="size-3.5" /> {t('edit')}
                  </GhostButton>
                  <GhostButton tone="light" onClick={() => void onTogglePublish(p, !p.isActive)}>
                    {p.isActive ? t('unpublish') : t('publish')}
                  </GhostButton>
                  <button
                    type="button"
                    onClick={() => void onDelete(p)}
                    aria-label={t('delete')}
                    className="rounded-lg border p-1.5 transition-colors hover:bg-red-50 border-border"
                  >
                    <Trash2 className="size-3.5 text-red-600" />
                  </button>
                </div>
              </div>
              {p.slug && p.isActive && <ShareLink slug={p.slug} label={t('copyLink')} copied={t('copied')} />}
            </li>
          ))}
        </ul>
      )}

      <FlowSheet
        open={openForm}
        onOpenChange={(v) => { setOpenForm(v); if (!v) setEditingId(null); }}
        title={editingId ? t('editTitle') : t('createTitle')}
      >
        <div className="space-y-3">
          <Field label={t('labelTitle')} htmlFor="p-title">
            <input
              id="p-title" className={cpInputClassLight} value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder={t('placeholderTitle')}
            />
          </Field>
          <Field label={t('labelType')} htmlFor="p-type">
            <select
              id="p-type" className={cpInputClassLight} value={draft.type}
              onChange={(e) => set('type', e.target.value as ConsultantProgram['type'])}
            >
              {PROGRAM_TYPES.map((ty) => (
                <option key={ty} value={ty}>{t(`type.${ty}` as 'type.TRAINING')}</option>
              ))}
            </select>
          </Field>
          <Field label={t('labelDescription')} htmlFor="p-desc">
            <textarea
              id="p-desc" rows={4} className={cpInputClassLight} value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder={t('placeholderDescription')}
            />
          </Field>
          <Field label={t('labelCity')} htmlFor="p-city">
            <AlgerianCitySelect
              id="p-city" value={draft.city}
              onChange={(city) => set('city', city)}
            />
          </Field>
          <Field label={t('labelCoverImage')}>
            <GalleryUploadField
              value={draft.imageUrls}
              onChange={(imageUrls) => set('imageUrls', imageUrls)}
              endpoint="/api/consultant/upload"
              uploadFields={{ kind: 'program' }}
            />
          </Field>
          <Field label={t('labelSeats')} htmlFor="p-seats">
            <input
              id="p-seats" type="number" min={1} className={cpInputClassLight} value={draft.seatsTotal}
              onChange={(e) => set('seatsTotal', e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('labelDeadline')} htmlFor="p-deadline">
              <input
                id="p-deadline" type="date" min={todayISO()} className={cpInputClassLight}
                value={draft.deadline}
                onChange={(e) => set('deadline', e.target.value)}
              />
            </Field>
            <Field label={t('labelStart')} htmlFor="p-start">
              <input
                id="p-start" type="date" min={todayISO()} className={cpInputClassLight}
                value={draft.startDate}
                onChange={(e) => set('startDate', e.target.value)}
              />
            </Field>
            <Field label={t('labelStartTime')} htmlFor="p-start-time">
              <input
                id="p-start-time" type="time" className={cpInputClassLight}
                value={draft.startTime}
                onChange={(e) => set('startTime', e.target.value)}
              />
            </Field>
            <Field label={t('labelEndTime')} htmlFor="p-end-time">
              <input
                id="p-end-time" type="time" className={cpInputClassLight}
                value={draft.endTime}
                onChange={(e) => set('endTime', e.target.value)}
              />
            </Field>
            <Field label={t('labelEnd')} htmlFor="p-end">
              <input
                id="p-end" type="date" min={todayISO()} className={cpInputClassLight}
                value={draft.endDate}
                onChange={(e) => set('endDate', e.target.value)}
              />
            </Field>
          </div>

          <Field label={t('labelPrice')} htmlFor="p-price">
            <input
              id="p-price" type="number" min={0} className={cpInputClassLight} value={draft.price}
              onChange={(e) => set('price', e.target.value)}
            />
          </Field>

          {/* Split pricing. The API has always accepted these two; the portal
              simply never had the fields, so a consultant could not charge a
              premium for cash the way an incubator can. */}
          <div className="rounded-md border p-3 border-border bg-muted">
            <p className="text-xs font-medium text-foreground">{t('labelSplitPricing')}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('splitPricingHint')}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label={t('labelOnlinePrice')} htmlFor="p-online-price">
                <input
                  id="p-online-price" type="number" min={0} className={cpInputClassLight}
                  placeholder={draft.price}
                  value={draft.onlinePrice}
                  onChange={(e) => set('onlinePrice', e.target.value)}
                />
              </Field>
              <Field label={t('labelCashPrice')} htmlFor="p-cash-price">
                <input
                  id="p-cash-price" type="number" min={0} className={cpInputClassLight}
                  placeholder={draft.price}
                  value={draft.cashPrice}
                  onChange={(e) => set('cashPrice', e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground">{t('labelPaymentMethods')}</p>
            <div className="mt-1.5 flex gap-2">
              {(['ONLINE', 'CASH'] as PaymentMethod[]).map((m) => {
                const active = draft.acceptedPaymentMethods.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => set('acceptedPaymentMethods', togglePaymentMethod(draft.acceptedPaymentMethods, m))}
                    className={cn(
                      'flex-1 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors',
                      active ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:border-primary/40',
                    )}
                  >
                    {m === 'ONLINE' ? t('methodOnline') : t('methodCash')}
                  </button>
                );
              })}
            </div>
          </div>

          {draft.acceptedPaymentMethods.includes('CASH') && (
            <div className="rounded-md border p-3 border-border bg-muted">
              <p className="text-xs font-medium text-foreground">{t('labelDeposit')}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t('depositHint')}</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex gap-1.5">
                  {(['PERCENT', 'FIXED'] as const).map((dt) => (
                    <button
                      key={dt}
                      type="button"
                      onClick={() => set('cashDepositType', dt)}
                      className={cn(
                        'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                        draft.cashDepositType === dt ? 'border-primary bg-primary/5 font-medium text-primary' : 'border-border text-muted-foreground hover:border-primary/40',
                      )}
                    >
                      {dt === 'PERCENT' ? t('depositPercent') : t('depositFixed')}
                    </button>
                  ))}
                </div>
                {/* min 0: 0 means "no deposit, paid in full on site". */}
                <input
                  type="number" min={0} max={draft.cashDepositType === 'PERCENT' ? 100 : undefined}
                  className={cn(cpInputClassLight, 'h-10')}
                  value={draft.cashDepositValue}
                  onChange={(e) => set('cashDepositValue', e.target.value)}
                  aria-label={t('labelDeposit')}
                />
              </div>
            </div>
          )}

          {error && <ErrorBanner message={error} tone="light" />}

          <BrandButton tone="light" onClick={() => void onSave()} disabled={saving} className="w-full">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {editingId ? t('saveChanges') : t('create')}
          </BrandButton>
        </div>
      </FlowSheet>
    </SectionCard>
  );
}

/** Copy-able public link for a published program. */
function ShareLink({ slug, label, copied }: { slug: string; label: string; copied: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    const url = `${window.location.origin}/programs/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (http / older WebView) — legacy fallback.
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="mt-2 inline-flex items-center gap-1.5 text-xs underline-offset-2 hover:underline text-muted-foreground"
    >
      <Copy className="size-3" /> {done ? copied : label}
    </button>
  );
}

/**
 * One program, managed — the portal's counterpart to
 * `/dashboard/incubator/programs/[id]`.
 *
 * The two tabs render the SAME components the incubator dashboard uses:
 * `RegistrationsTable` (participants, answers, CSV, add-at-the-desk) and
 * `RegistrationFormBuilder` (the application questions). Only the endpoint
 * differs, so a consultant and an incubator manage a program identically and
 * neither can quietly gain a feature the other lacks.
 */
function ProgramDetailView({ program, onBack }: { program: ConsultantProgram; onBack: () => void }) {
  const t = useTranslations('consultantPortal.programs');
  const tDash = useTranslations('registrationDashboard');
  const [tab, setTab] = useState<'registrants' | 'form'>('registrants');
  const [fields, setFields] = useState<RegistrationFormField[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The builder needs the current questions before it can render. Loaded here
  // rather than server-side because the portal is a single client page.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/consultant/registration-form?entityType=PROGRAM&entityId=${encodeURIComponent(program.id)}`,
          { credentials: 'include' },
        );
        const body = await res.json().catch(() => null);
        if (!cancelled) setFields(res.ok ? (body?.fields ?? []) : []);
      } catch {
        if (!cancelled) { setFields([]); setError(t('errorGeneric')); }
      }
    })();
    return () => { cancelled = true; };
  }, [program.id, t]);

  const tabs = [
    { key: 'registrants' as const, label: tDash('tabRegistrations'), Icon: Users },
    { key: 'form' as const, label: tDash('tabFormBuilder'), Icon: Settings2 },
  ];

  return (
    <SectionCard>
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button" onClick={onBack} aria-label={t('back')}
          className="rounded-lg border p-1.5 border-border"
        >
          <ArrowLeft className="size-4 rtl:rotate-180 text-muted-foreground" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{program.title}</h2>
          <p className="text-xs text-muted-foreground">
            {t('seats', { taken: program.seatsTaken, total: program.seatsTotal })}
          </p>
        </div>
      </div>

      {/* Portal-styled tab bar; the panels below are the shared components. */}
      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex min-h-11 shrink-0 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors',
              tab === key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-3"><ErrorBanner message={error} tone="light" /></div>}

      {tab === 'registrants' ? (
        <RegistrationsTable
          entityType="PROGRAM"
          entityId={program.id}
          entityTitle={program.title}
          defaultAmount={resolveListingPricing(program.price, program).cash}
          endpoint="/api/consultant/registrations"
        />
      ) : fields === null ? (
        <div className="flex justify-center py-10"><Spinner tone="light" /></div>
      ) : (
        <RegistrationFormBuilder
          entityType="PROGRAM"
          entityId={program.id}
          initialFields={fields}
          endpoint="/api/consultant/registration-form"
        />
      )}
    </SectionCard>
  );
}
