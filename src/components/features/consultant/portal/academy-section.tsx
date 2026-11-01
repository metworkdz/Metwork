'use client';

/**
 * Academy Studio — the mentor's courses on Startup Academy.
 *
 * Two views: the list (stats, courses with their review status, "new course")
 * and the builder, which is the admin's CourseBuilder in Studio mode. What a
 * mentor may change is decided server-side per course (edit mode); sending a
 * course to review also needs the signed "Avenant Academy", which arrives
 * through the Contract tab like any consultant contract.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronRight, FileSignature, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { resolveText, localizedText, type LocalizedText } from '@/lib/localized-text';
import type { Locale } from '@/i18n/config';
import type { BuilderCourse, PublishProblem } from '@/server/academy/catalog';
import { CourseBuilder, type StudioEditMode } from '@/components/features/academy/admin/course-builder';
import { formatDzd } from '@/components/features/academy/format';
import { BrandButton, EmptyBlock, ErrorBanner, Field, GhostButton, SectionCard, SectionHeading, Spinner, StatTile } from './shared';

type AddendumState = 'NONE' | 'DRAFT' | 'PENDING_SIGNATURE' | 'SIGNED';

interface StudioCourse extends BuilderCourse {
  editMode: StudioEditMode;
  stats: { buyers: number; earnedDzd: number };
}

interface Overview {
  addendum: AddendumState;
  courses: StudioCourse[];
  totals: { buyers: number; passMinutesThisMonth: number; earnedDzd: number };
  fields: { id: string; label: LocalizedText | null }[];
  premiumDiscountRate: number;
}

interface OpenCourse { course: BuilderCourse; editMode: StudioEditMode; problems: PublishProblem[] }

export function AcademySection({ onOpenContract }: { onOpenContract: () => void }) {
  const t = useTranslations('consultantPortal.academy');
  const tb = useTranslations('academyAdmin.builder');
  const ta = useTranslations('academy');
  const tf = useTranslations('academy.fields');
  const locale = useLocale();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenCourse | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiClient.get<Overview>('/consultant/academy'));
      setError(null);
    } catch {
      setError(t('loadError'));
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const openCourse = useCallback(async (id: string) => {
    setBusy(true);
    try {
      setOpen(await apiClient.get<OpenCourse>(`/consultant/academy/courses/${id}`));
    } catch {
      setError(t('loadError'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  async function create() {
    if (!title.trim() || !fieldId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ id: string }>('/consultant/academy', { title: localizedText(locale as Locale, title.trim()), fieldId });
      setCreating(false);
      setTitle('');
      await openCourse(res.id);
    } catch (err) {
      setError(err instanceof ApiClientError && err.code === 'RATE_LIMITED' ? tb('errors.RATE_LIMITED') : t('createError'));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return error ? <ErrorBanner tone="light" message={error} /> : <div className="flex justify-center py-12"><Spinner tone="dark" /></div>;
  }

  const fieldLabel = (f: Overview['fields'][number]) => (f.label ? resolveText(f.label, locale) : tf(`${f.id}.name`));
  const money = (n: number) => ta('money', { price: formatDzd(n, locale) });

  if (open) {
    return (
      <CourseBuilder
        key={open.course.id}
        initial={open.course}
        initialProblems={open.problems}
        fields={data.fields.map((f) => ({ id: f.id, label: fieldLabel(f) }))}
        mentors={[]}
        premiumDiscountRate={data.premiumDiscountRate}
        locale={locale}
        studio={{ editMode: open.editMode, addendumSigned: data.addendum === 'SIGNED', onBack: () => { setOpen(null); void load(); } }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {data.addendum !== 'SIGNED' && (
        <SectionCard className="flex flex-col gap-3 border-amber-300 bg-amber-50 sm:flex-row sm:items-center dark:bg-amber-950/30">
          <FileSignature className="size-5 shrink-0 text-amber-700" aria-hidden />
          <p className="flex-1 text-sm text-amber-900 dark:text-amber-200">{t(`addendum.${data.addendum}`)}</p>
          {data.addendum === 'PENDING_SIGNATURE' && <GhostButton tone="light" onClick={onOpenContract}>{t('addendum.sign')}</GhostButton>}
        </SectionCard>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={t('stats.buyers')} value={String(data.totals.buyers)} />
        <StatTile label={t('stats.passMinutes')} value={String(data.totals.passMinutesThisMonth)} />
        <StatTile label={t('stats.earned')} value={money(data.totals.earnedDzd)} accent />
      </div>

      <SectionCard>
        <SectionHeading
          title={t('title')}
          subtitle={t('subtitle')}
          action={!creating && <BrandButton tone="light" onClick={() => setCreating(true)}><Plus className="size-4" />{t('new')}</BrandButton>}
        />
        {error && <div className="mb-3"><ErrorBanner tone="light" message={error} /></div>}

        {creating && (
          <div className="mb-4 space-y-3 rounded-lg border border-border p-4">
            <Field label={t('newTitle')} hint={t('newTitleHint')} htmlFor="studio-title">
              <Input id="studio-title" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={tb('fields.field')} htmlFor="studio-field">
              <select id="studio-field" value={fieldId} onChange={(e) => setFieldId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm">
                <option value="">{t('pickField')}</option>
                {data.fields.map((f) => <option key={f.id} value={f.id}>{fieldLabel(f)}</option>)}
              </select>
            </Field>
            <div className="flex gap-2">
              <BrandButton tone="light" loading={busy} disabled={!title.trim() || !fieldId} onClick={create}>{t('create')}</BrandButton>
              <GhostButton tone="light" onClick={() => setCreating(false)}>{tb('cancel')}</GhostButton>
            </div>
          </div>
        )}

        {data.courses.length === 0 ? (
          <EmptyBlock>{t('empty')}</EmptyBlock>
        ) : (
          <ul className="divide-y divide-border">
            {data.courses.map((c) => {
              const pendingModules = c.modules.filter((m) => m.pendingReview).length;
              return (
                <li key={c.id}>
                  <button type="button" disabled={busy} onClick={() => openCourse(c.id)}
                    className="flex w-full items-center gap-3 py-3 text-start hover:bg-muted/40 disabled:opacity-60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{resolveText(c.title, locale) || tb('untitled')}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="outline">{tb(`status.${c.status}`)}</Badge>
                        {pendingModules > 0 && <Badge variant="outline" className="border-amber-300 text-amber-800">{t('pendingModules', { count: pendingModules })}</Badge>}
                        {c.editMode === 'READ_ONLY' && <span>{t('readOnly')}</span>}
                        {c.status === 'PUBLISHED' && <span>{t('courseStats', { buyers: c.stats.buyers, earned: money(c.stats.earnedDzd) })}</span>}
                      </div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
