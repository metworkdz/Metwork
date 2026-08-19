'use client';

/**
 * Programs — trainings, workshops and webinars a consultant runs.
 *
 * Backed by the SAME ProgramRecord + registration system incubators use; this
 * surface only supplies the consultant identity. Two views:
 *   • list   — the consultant's own programs, publish/unpublish, delete
 *   • detail — registrants (with CSV export) for one program
 *
 * Money model: none. Consultant programs are free for now — paid ones cannot
 * settle into the consultant ledger yet, so the create form has no price field
 * and enrolment goes through the no-payment registration flow.
 *
 * Mobile-first with Tailwind breakpoints only (no useMediaQuery), so server and
 * client render identically.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowLeft, Copy, Download, GraduationCap, Loader2, Plus, Trash2, Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  consultantService,
  type ConsultantProgram,
  type ConsultantProgramInput,
  type ConsultantRegistration,
} from '@/services/consultant.service';
import {
  BrandButton, CP_GREEN_TEXT, CP_LIGHT_BORDER, CP_LIGHT_FAINT, CP_LIGHT_MUTED, CP_LIGHT_TEXT,
  EmptyBlock, ErrorBanner, Field, FlowSheet, GhostButton, SectionCard, SectionHeading, Spinner,
  cpInputClassLight,
} from './shared';

const TYPES: ConsultantProgram['type'][] = [
  'TRAINING', 'WORKSHOP', 'WEBINAR', 'BOOTCAMP', 'INCUBATION', 'ACCELERATION',
];

/** "YYYY-MM-DD" for today, local time. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A date input's value → an ISO datetime the API accepts. */
function toIso(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toISOString();
}

function fmtDate(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
}

const emptyDraft: ConsultantProgramInput = {
  title: '', description: '', type: 'TRAINING', city: '',
  seatsTotal: 20, deadline: '', startDate: '', endDate: '',
};

export function ProgramsSection() {
  const t = useTranslations('consultantPortal.programs');
  const locale = useLocale();

  const [items, setItems] = useState<ConsultantProgram[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ConsultantProgramInput>(emptyDraft);
  const [selected, setSelected] = useState<ConsultantProgram | null>(null);

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

  function draftError(): string | null {
    if (draft.title.trim().length < 2) return t('errorTitle');
    if (draft.description.trim().length < 10) return t('errorDescription');
    if (!draft.city.trim()) return t('errorCity');
    if (!draft.deadline || !draft.startDate || !draft.endDate) return t('errorDates');
    if (!(draft.deadline <= draft.startDate && draft.startDate < draft.endDate)) return t('errorDateOrder');
    return null;
  }

  async function onCreate() {
    const invalid = draftError();
    if (invalid) { setError(invalid); return; }
    setSaving(true);
    setError(null);
    try {
      await consultantService.createProgram({
        ...draft,
        title: draft.title.trim(),
        description: draft.description.trim(),
        city: draft.city.trim(),
        deadline: toIso(draft.deadline),
        startDate: toIso(draft.startDate),
        endDate: toIso(draft.endDate),
      });
      setOpenForm(false);
      setDraft(emptyDraft);
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
    return <RegistrantsView program={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <SectionCard>
      <SectionHeading
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <BrandButton onClick={() => { setDraft(emptyDraft); setError(null); setOpenForm(true); }}>
            <Plus className="size-4" /> {t('create')}
          </BrandButton>
        }
      />

      {error && <div className="mb-3"><ErrorBanner message={error} tone="light" /></div>}

      {items === null ? (
        <div className="flex justify-center py-10"><Spinner tone="light" /></div>
      ) : items.length === 0 ? (
        <EmptyBlock>
          <GraduationCap className="mx-auto mb-2 size-7" style={{ color: CP_LIGHT_FAINT }} />
          <p className="text-sm font-medium" style={{ color: CP_LIGHT_TEXT }}>{t('emptyTitle')}</p>
          <p className="mt-1 text-xs" style={{ color: CP_LIGHT_MUTED }}>{t('emptyBody')}</p>
        </EmptyBlock>
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border p-3 sm:p-4"
              style={{ borderColor: CP_LIGHT_BORDER }}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold" style={{ color: CP_LIGHT_TEXT }}>
                      {p.title}
                    </h3>
                    <Badge variant="primary">{t(`type.${p.type}` as 'type.TRAINING')}</Badge>
                    <Badge variant={p.isActive ? 'success' : 'warning'}>
                      {p.isActive ? t('statusPublished') : t('statusDraft')}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs" style={{ color: CP_LIGHT_MUTED }}>
                    {p.city} · {fmtDate(p.startDate, locale)} → {fmtDate(p.endDate, locale)}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: CP_GREEN_TEXT }}>
                    {t('seats', { taken: p.seatsTaken, total: p.seatsTotal })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <GhostButton onClick={() => setSelected(p)}>
                    <Users className="size-3.5" /> {t('registrants')}
                  </GhostButton>
                  <GhostButton onClick={() => void onTogglePublish(p, !p.isActive)}>
                    {p.isActive ? t('unpublish') : t('publish')}
                  </GhostButton>
                  <button
                    type="button"
                    onClick={() => void onDelete(p)}
                    aria-label={t('delete')}
                    className="rounded-lg border p-1.5 transition-colors hover:bg-red-50"
                    style={{ borderColor: CP_LIGHT_BORDER }}
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

      <FlowSheet open={openForm} onOpenChange={setOpenForm} title={t('createTitle')}>
        <div className="space-y-3">
          <Field label={t('labelTitle')} htmlFor="p-title">
            <input
              id="p-title" className={cpInputClassLight} value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder={t('placeholderTitle')}
            />
          </Field>
          <Field label={t('labelType')} htmlFor="p-type">
            <select
              id="p-type" className={cpInputClassLight} value={draft.type}
              onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as ConsultantProgram['type'] }))}
            >
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>{t(`type.${ty}` as 'type.TRAINING')}</option>
              ))}
            </select>
          </Field>
          <Field label={t('labelDescription')} htmlFor="p-desc">
            <textarea
              id="p-desc" rows={4} className={cpInputClassLight} value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder={t('placeholderDescription')}
            />
          </Field>
          <Field label={t('labelCity')} htmlFor="p-city">
            <input
              id="p-city" className={cpInputClassLight} value={draft.city}
              onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
            />
          </Field>
          <Field label={t('labelSeats')} htmlFor="p-seats">
            <input
              id="p-seats" type="number" min={1} className={cpInputClassLight} value={draft.seatsTotal}
              onChange={(e) => setDraft((d) => ({ ...d, seatsTotal: Number(e.target.value) || 1 }))}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('labelDeadline')} htmlFor="p-deadline">
              <input
                id="p-deadline" type="date" min={todayISO()} className={cpInputClassLight}
                value={draft.deadline}
                onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))}
              />
            </Field>
            <Field label={t('labelStart')} htmlFor="p-start">
              <input
                id="p-start" type="date" min={todayISO()} className={cpInputClassLight}
                value={draft.startDate}
                onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
              />
            </Field>
            <Field label={t('labelEnd')} htmlFor="p-end">
              <input
                id="p-end" type="date" min={todayISO()} className={cpInputClassLight}
                value={draft.endDate}
                onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
              />
            </Field>
          </div>

          <p className="text-xs" style={{ color: CP_LIGHT_MUTED }}>{t('freeNotice')}</p>

          {error && <ErrorBanner message={error} tone="light" />}

          <BrandButton onClick={() => void onCreate()} disabled={saving} className="w-full">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t('create')}
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
      className="mt-2 inline-flex items-center gap-1.5 text-xs underline-offset-2 hover:underline"
      style={{ color: CP_LIGHT_MUTED }}
    >
      <Copy className="size-3" /> {done ? copied : label}
    </button>
  );
}

/** Registrants for one program, with CSV export. */
function RegistrantsView({ program, onBack }: { program: ConsultantProgram; onBack: () => void }) {
  const t = useTranslations('consultantPortal.programs');
  const locale = useLocale();
  const [rows, setRows] = useState<ConsultantRegistration[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await consultantService.programRegistrations(program.id);
      setRows(res.registrations);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('errorGeneric'));
      setRows([]);
    }
  }, [program.id, t]);

  useEffect(() => { void load(); }, [load]);

  async function onCancel(r: ConsultantRegistration) {
    if (!window.confirm(t('confirmCancelReg', { name: r.fullName }))) return;
    try {
      await consultantService.cancelProgramRegistration(r.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('errorGeneric'));
    }
  }

  return (
    <SectionCard>
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button" onClick={onBack} aria-label={t('back')}
          className="rounded-lg border p-1.5" style={{ borderColor: CP_LIGHT_BORDER }}
        >
          <ArrowLeft className="size-4 rtl:rotate-180" style={{ color: CP_LIGHT_MUTED }} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold" style={{ color: CP_LIGHT_TEXT }}>{program.title}</h2>
          <p className="text-xs" style={{ color: CP_LIGHT_MUTED }}>
            {t('seats', { taken: program.seatsTaken, total: program.seatsTotal })}
          </p>
        </div>
        <a
          href={`/api/consultant/registrations/export?entityId=${encodeURIComponent(program.id)}`}
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
          style={{ borderColor: CP_LIGHT_BORDER, color: CP_LIGHT_TEXT }}
        >
          <Download className="size-3.5" /> {t('exportCsv')}
        </a>
      </div>

      {error && <div className="mb-3"><ErrorBanner message={error} tone="light" /></div>}

      {rows === null ? (
        <div className="flex justify-center py-10"><Spinner tone="light" /></div>
      ) : rows.length === 0 ? (
        <EmptyBlock>
          <Users className="mx-auto mb-2 size-7" style={{ color: CP_LIGHT_FAINT }} />
          <p className="text-sm font-medium" style={{ color: CP_LIGHT_TEXT }}>{t('noRegistrants')}</p>
        </EmptyBlock>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className={cn('rounded-xl border p-3', r.status === 'CANCELLED' && 'opacity-60')}
              style={{ borderColor: CP_LIGHT_BORDER }}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: CP_LIGHT_TEXT }}>{r.fullName}</p>
                  <p className="truncate text-xs" style={{ color: CP_LIGHT_MUTED }}>{r.email} · {r.phone}</p>
                  <p className="mt-0.5 text-xs" style={{ color: CP_LIGHT_FAINT }}>{fmtDate(r.createdAt, locale)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={r.status === 'CONFIRMED' ? 'success' : r.status === 'WAITLISTED' ? 'warning' : 'danger'}>
                    {t(`regStatus.${r.status}` as 'regStatus.CONFIRMED')}
                  </Badge>
                  {r.status !== 'CANCELLED' && (
                    <GhostButton onClick={() => void onCancel(r)}>{t('cancelReg')}</GhostButton>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
