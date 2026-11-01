'use client';

/**
 * Course builder — the admin's, and the mentor Studio's (`studio` prop): texts
 * in fr / en / ar, classification, price, cover, and the programme (modules →
 * lessons) with direct video upload per lesson.
 *
 * In the Studio, `editMode` decides what is editable: FULL (a draft), or
 * ADD_MODULES (a published course: only the mentor's new modules, which stay
 * hidden from learners until the admin approves them). The server enforces the
 * same rules; the locks here only spare the mentor a refused save.
 *
 * The page sends the whole builder state on save (PUT); the server keeps each
 * lesson's video from its stored record, so nothing here can point a lesson at
 * a video. Video ids never reach this component.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ExternalLink, Languages, Loader2,
  Plus, RefreshCw, Trash2, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { apiClient, ApiClientError } from '@/lib/api-client';
import {
  ACADEMY_AUDIO_LANGUAGES, ACADEMY_LEVELS, ACADEMY_MIN_COURSE_PRICE_DZD, discounted,
  type AcademyAudioLanguage, type AcademyLevel,
} from '@/lib/academy';
import { resolveText, type LocalizedText } from '@/lib/localized-text';
import { locales, type Locale } from '@/i18n/config';
import type { BuilderCourse, PublishProblem } from '@/server/academy/catalog';
import type { AcademyVideoStatus } from '@/server/db/store';
import { LocalizedField } from './localized-field';
import { CoverUpload } from './cover-upload';
import { QuizEditor, isQuestionComplete, type QuizQuestionState } from './quiz-editor';
import { cn } from '@/lib/utils';

type ServerLesson = BuilderCourse['modules'][number]['lessons'][number];

interface LessonState {
  key: string;
  /** Present once saved; uploads need it. */
  id?: string;
  title: LocalizedText | null;
  description: LocalizedText | null;
  isPreview: boolean;
  hasVideo: boolean;
  videoStatus: AcademyVideoStatus;
  durationSec: number;
}

interface ModuleState {
  key: string;
  id?: string;
  title: LocalizedText | null;
  comingSoon: boolean;
  /** A mentor's module awaiting admin approval. */
  pending: boolean;
  lessons: LessonState[];
  quiz: QuizQuestionState[];
}

interface FieldOption { id: string; label: string }
interface MentorOption { id: string; fullName: string; approved: boolean }

export type StudioEditMode = 'FULL' | 'ADD_MODULES' | 'LOCKED' | 'READ_ONLY';

interface CourseBuilderProps {
  initial: BuilderCourse;
  /** Present in the mentor Studio; absent for the admin. */
  studio?: { editMode: StudioEditMode; addendumSigned: boolean; onBack(): void };
  initialProblems: PublishProblem[];
  fields: FieldOption[];
  mentors: MentorOption[];
  premiumDiscountRate: number;
  locale: string;
}

let seq = 0;
const tmpKey = () => `tmp-${++seq}`;

function fromServer(c: BuilderCourse): ModuleState[] {
  return c.modules.map((m) => ({
    key: m.id, id: m.id, title: m.title, comingSoon: m.comingSoon, pending: Boolean(m.pendingReview),
    lessons: m.lessons.map((l: ServerLesson) => ({
      key: l.id, id: l.id, title: l.title, description: l.description, isPreview: l.isPreview,
      hasVideo: l.hasVideo, videoStatus: l.videoStatus, durationSec: l.durationSec,
    })),
    quiz: (m.quiz?.questions ?? []).map((q) => ({ key: q.id, id: q.id, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex })),
  }));
}

function fmtDuration(sec: number): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function move<T>(arr: T[], i: number, by: number): T[] {
  const j = i + by;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function CourseBuilder({ initial, initialProblems, fields, mentors, premiumDiscountRate, locale, studio }: CourseBuilderProps) {
  const t = useTranslations('academyAdmin.builder');
  const tc = useTranslations('academy');
  const router = useRouter();
  const apiBase = studio ? '/consultant/academy' : '/admin/academy';
  const [editMode, setEditMode] = useState<StudioEditMode>(studio?.editMode ?? 'FULL');
  // What can be touched: everything for the admin; per edit mode in the Studio.
  const canEditCourse = !studio || editMode === 'FULL';
  const canEditModule = (m: Pick<ModuleState, 'pending'>) => canEditCourse || (editMode === 'ADD_MODULES' && m.pending);
  const canAddModule = canEditCourse || editMode === 'ADD_MODULES';
  const readOnly = Boolean(studio) && (editMode === 'LOCKED' || editMode === 'READ_ONLY');
  const [reviewNote, setReviewNote] = useState('');

  const [course, setCourse] = useState(initial);
  const [modules, setModules] = useState<ModuleState[]>(() => fromServer(initial));
  const [problems, setProblems] = useState(initialProblems);
  const [lang, setLang] = useState<Locale>(initial.title.source);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'translate' | 'status' | 'delete'>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const edit = <K extends keyof BuilderCourse>(key: K, value: BuilderCourse[K]) => {
    setCourse((c) => ({ ...c, [key]: value }));
    setDirty(true);
  };
  const editModules = (fn: (m: ModuleState[]) => ModuleState[]) => {
    setModules(fn);
    setDirty(true);
  };

  const errorText = useCallback((err: unknown) => {
    if (err instanceof ApiClientError) {
      const known = ['PRICE_BELOW_MINIMUM', 'PRICE_INVALID', 'SLUG_TAKEN', 'FIELD_NOT_FOUND', 'MENTOR_NOT_FOUND', 'VALIDATION_ERROR', 'HAS_ENROLLMENTS', 'UNAVAILABLE', 'FAILED', 'RATE_LIMITED', 'NOT_READY', 'ADDENDUM_REQUIRED', 'LOCKED', 'READ_ONLY', 'NOTHING_TO_SUBMIT'];
      return known.includes(err.code) ? t(`errors.${err.code}`) : err.message;
    }
    return t('errors.generic');
  }, [t]);

  const applyServer = (c: BuilderCourse, p: PublishProblem[], mode?: StudioEditMode) => {
    if (mode) setEditMode(mode);
    setCourse(c);
    setModules(fromServer(c));
    setProblems(p);
    setDirty(false);
  };

  const payload = () => ({
    slug: course.slug,
    fieldId: course.fieldId,
    mentorIds: course.mentorIds,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    outcomes: course.outcomes,
    level: course.level,
    audioLanguage: course.audioLanguage,
    priceDzd: course.priceDzd,
    includedInPass: course.includedInPass,
    thumbnailUrl: course.thumbnailUrl,
    modules: modules.map((m) => ({
      ...(m.id ? { id: m.id } : {}),
      title: m.title,
      comingSoon: m.comingSoon,
      lessons: m.lessons.map((l) => ({
        ...(l.id ? { id: l.id } : {}),
        title: l.title,
        description: l.description,
        isPreview: l.isPreview,
      })),
      quiz: m.quiz.length ? {
        questions: m.quiz.map((q) => ({ ...(q.id ? { id: q.id } : {}), prompt: q.prompt, options: q.options, correctIndex: q.correctIndex })),
      } : null,
    })),
  });

  const missingTitle = modules.some((m) => !m.title || m.lessons.some((l) => !l.title));
  const incompleteQuiz = modules.some((m) => m.quiz.some((q) => !isQuestionComplete(q)));

  async function save(): Promise<boolean> {
    if (missingTitle) { setMessage({ kind: 'error', text: t('errors.MISSING_TITLE') }); return false; }
    if (incompleteQuiz) { setMessage({ kind: 'error', text: t('errors.QUIZ_INCOMPLETE') }); return false; }
    setBusy('save');
    setMessage(null);
    try {
      const res = await apiClient.put<{ course: BuilderCourse; problems: PublishProblem[]; editMode?: StudioEditMode }>(`${apiBase}/courses/${course.id}`, payload());
      applyServer(res.course, res.problems, res.editMode);
      setMessage({ kind: 'ok', text: t('saved') });
      return true;
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function translate() {
    if (dirty && !(await save())) return;
    setBusy('translate');
    setMessage(null);
    try {
      const res = await apiClient.post<{ filled: number; course: BuilderCourse; problems: PublishProblem[]; editMode?: StudioEditMode }>(`${apiBase}/courses/${course.id}/translate`);
      applyServer(res.course, res.problems, res.editMode);
      setMessage({ kind: 'ok', text: t('translated', { count: res.filled }) });
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(change: 'PUBLISH' | 'UNPUBLISH' | 'ARCHIVE') {
    if (dirty && !(await save())) return;
    setBusy('status');
    setMessage(null);
    try {
      const res = await apiClient.post<{ course: BuilderCourse }>(`/admin/academy/courses/${course.id}/status`, { change });
      setCourse((c) => ({ ...c, status: res.course.status, publishedAt: res.course.publishedAt }));
      setMessage({ kind: 'ok', text: t(`statusDone.${change}`) });
    } catch (err) {
      if (err instanceof ApiClientError && Array.isArray(err.details?.problems)) setProblems(err.details.problems as PublishProblem[]);
      setMessage({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  /** Mentor: send the draft, or the new modules, to Metwork for review. */
  async function submitForReview() {
    if (dirty && !(await save())) return;
    setBusy('status');
    setMessage(null);
    try {
      const res = await apiClient.post<{ course: BuilderCourse; editMode: StudioEditMode }>(`${apiBase}/courses/${course.id}/submit`);
      applyServer(res.course, problems, res.editMode);
      setMessage({ kind: 'ok', text: t('studio.submitted') });
    } catch (err) {
      if (err instanceof ApiClientError && Array.isArray(err.details?.problems)) setProblems(err.details.problems as PublishProblem[]);
      setMessage({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  /** Admin: answer a mentor's submission. */
  async function review(action: 'REQUEST_CHANGES' | 'APPROVE_MODULES' | 'REJECT_MODULES') {
    setBusy('status');
    setMessage(null);
    try {
      const res = await apiClient.post<{ course: BuilderCourse; problems: PublishProblem[] }>(`/admin/academy/courses/${course.id}/review`,
        action === 'APPROVE_MODULES' ? { action } : { action, note: reviewNote });
      applyServer(res.course, res.problems);
      setReviewNote('');
      setMessage({ kind: 'ok', text: t(`adminReview.done.${action}`) });
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      await apiClient.delete(`${apiBase}/courses/${course.id}`);
      setDirty(false);
      if (studio) studio.onBack();
      else router.push('/dashboard/admin/academy');
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
      setBusy(null);
    }
  }

  const setLesson = (mi: number, li: number, patch: Partial<LessonState>) =>
    setModules((ms) => ms.map((m, i) => i !== mi ? m : { ...m, lessons: m.lessons.map((l, j) => j !== li ? l : { ...l, ...patch }) }));

  const pollers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => () => { Object.values(pollers.current).forEach(clearTimeout); }, []);

  const refresh = useCallback(async (lessonId: string, attempt = 0) => {
    try {
      const res = await apiClient.post<{ status: AcademyVideoStatus; durationSec: number }>(`${apiBase}/courses/${course.id}/lessons/${lessonId}/refresh`);
      setModules((ms) => ms.map((m) => ({ ...m, lessons: m.lessons.map((l) => l.id === lessonId ? { ...l, videoStatus: res.status, durationSec: res.durationSec, hasVideo: true } : l) })));
      // Processing takes minutes on the host: keep asking for a while.
      if ((res.status === 'PROCESSING' || res.status === 'UPLOADING') && attempt < 60) {
        pollers.current[lessonId] = setTimeout(() => void refresh(lessonId, attempt + 1), 15_000);
      }
    } catch { /* the refresh button stays available */ }
  }, [course.id, apiBase]);

  async function uploadVideo(mi: number, li: number, file: File) {
    const lesson = modules[mi]?.lessons[li];
    if (!lesson?.id) return;
    const lessonId = lesson.id;
    setMessage(null);
    try {
      const ticket = await apiClient.post<{ url: string; fields: Record<string, string>; fileField: string }>(`${apiBase}/courses/${course.id}/lessons/${lessonId}/upload`);
      setLesson(mi, li, { videoStatus: 'UPLOADING', hasVideo: true });
      const form = new FormData();
      for (const [k, v] of Object.entries(ticket.fields)) form.append(k, v);
      form.append(ticket.fileField, file);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', ticket.url);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploads((u) => ({ ...u, [lessonId]: Math.round((e.loaded / e.total) * 100) })); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(String(xhr.status))));
        xhr.onerror = () => reject(new Error('network'));
        xhr.send(form);
      });
      setUploads((u) => { const { [lessonId]: _, ...rest } = u; return rest; });
      void refresh(lessonId);
    } catch (err) {
      setUploads((u) => { const { [lessonId]: _, ...rest } = u; return rest; });
      setLesson(mi, li, { videoStatus: 'FAILED' });
      setMessage({ kind: 'error', text: err instanceof ApiClientError ? errorText(err) : t('errors.UPLOAD_FAILED') });
    }
  }

  const premiumPrice = discounted(course.priceDzd || 0, premiumDiscountRate);
  const statusTone: Record<string, string> = {
    PUBLISHED: 'bg-primary/10 text-primary', DRAFT: 'bg-muted text-muted-foreground', ARCHIVED: 'bg-muted text-muted-foreground',
    IN_REVIEW: 'bg-amber-100 text-amber-800', CHANGES_REQUESTED: 'bg-amber-100 text-amber-800',
  };
  const totalDuration = useMemo(() => modules.filter((m) => !m.comingSoon).flatMap((m) => m.lessons).reduce((s, l) => s + l.durationSec, 0), [modules]);

  return (
    <div className="space-y-6 pb-44 lg:pb-24">
      {/* ── Top bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        {studio
          ? <Button type="button" variant="ghost" size="sm" onClick={studio.onBack}><ArrowLeft className="me-1 size-4 rtl:rotate-180" />{t('studio.back')}</Button>
          : <Button asChild variant="ghost" size="sm"><Link href="/dashboard/admin/academy"><ArrowLeft className="me-1 size-4 rtl:rotate-180" />{t('back')}</Link></Button>}
        <h1 className="min-w-0 flex-1 truncate font-display text-xl font-extrabold">{resolveText(course.title, locale) || t('untitled')}</h1>
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', statusTone[course.status])}>{t(`status.${course.status}`)}</span>
        {course.status === 'PUBLISHED' && (
          <Button asChild variant="outline" size="sm"><Link href={`/academy/courses/${course.slug}`} target="_blank"><ExternalLink className="me-1 size-4" />{t('view')}</Link></Button>
        )}
      </div>

      {/* ── Language being edited ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
        <Languages className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-semibold">{t('editingLanguage')}</span>
        <div role="tablist" className="inline-flex rounded-lg border border-border p-0.5">
          {locales.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={lang === l} onClick={() => setLang(l)}
              className={cn('rounded-md px-3 py-1 text-sm font-semibold', lang === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {t(`lang.${l}`)}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{t('sourceIs', { lang: t(`lang.${course.title.source}`) })}</span>
        <Button type="button" variant="outline" size="sm" className={cn('ms-auto', !canEditCourse && 'hidden')} onClick={translate} disabled={busy !== null}>
          {busy === 'translate' ? <Loader2 className="me-1 size-4 animate-spin" /> : <Languages className="me-1 size-4" />}{t('translate')}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {studio && editMode !== 'FULL' && (
            <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{t(`studio.mode.${editMode}`)}</p>
          )}
          {/* ── Texts ── */}
          <fieldset disabled={!canEditCourse} className="m-0 min-w-0 border-0 p-0">
          <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
            <h2 className="font-display text-base font-extrabold">{t('sections.texts')}</h2>
            <div className="space-y-1.5">
              <Label htmlFor="c-title">{t('fields.title')}</Label>
              <LocalizedField id="c-title" value={course.title} lang={lang} maxLength={120} onChange={(v) => v && edit('title', v)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-subtitle">{t('fields.subtitle')}</Label>
              <LocalizedField id="c-subtitle" value={course.subtitle} lang={lang} maxLength={200} onChange={(v) => edit('subtitle', v)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-desc">{t('fields.description')}</Label>
              <LocalizedField id="c-desc" value={course.description} lang={lang} maxLength={5000} multiline onChange={(v) => edit('description', v)} />
            </div>
            <div className="space-y-2">
              <Label>{t('fields.outcomes')}</Label>
              {course.outcomes.map((o, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <LocalizedField id={`c-out-${i}`} value={o} lang={lang} maxLength={160} aria-label={t('fields.outcome', { n: i + 1 })}
                      onChange={(v) => edit('outcomes', v ? course.outcomes.map((x, j) => (j === i ? v : x)) : course.outcomes.filter((_, j) => j !== i))} />
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('remove')} onClick={() => edit('outcomes', course.outcomes.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              {course.outcomes.length < 12 && (
                <Button type="button" variant="outline" size="sm" onClick={() => edit('outcomes', [...course.outcomes, { source: lang, [lang]: t('newOutcome') }])}>
                  <Plus className="me-1 size-4" />{t('addOutcome')}
                </Button>
              )}
            </div>
          </section>
          </fieldset>

          {/* ── Programme ── */}
          <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-base font-extrabold">{t('sections.programme')}</h2>
              <span className="text-xs text-muted-foreground">{t('programmeSummary', { modules: modules.length, duration: fmtDuration(totalDuration) || '0:00' })}</span>
            </div>
            {modules.map((m, mi) => (
              <fieldset key={m.key} disabled={!canEditModule(m)} className={cn('m-0 min-w-0 rounded-xl border p-0', m.pending ? 'border-amber-300 dark:border-amber-600' : 'border-border')}>
                <div className="flex flex-wrap items-start gap-2 border-b border-border bg-muted/40 p-3">
                  <span className="mt-2 text-xs font-bold text-muted-foreground">{t('moduleN', { n: mi + 1 })}</span>
                  {m.pending && <span className="mt-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{t('pendingBadge')}</span>}
                  <div className="min-w-[200px] flex-1">
                    <LocalizedField id={`m-${m.key}`} value={m.title} lang={lang} maxLength={120} aria-label={t('fields.moduleTitle')}
                      onChange={(v) => editModules((ms) => ms.map((x, i) => (i === mi ? { ...x, title: v } : x)))} />
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
                    <input type="checkbox" checked={m.comingSoon} onChange={(e) => editModules((ms) => ms.map((x, i) => (i === mi ? { ...x, comingSoon: e.target.checked } : x)))} />
                    {t('comingSoon')}
                  </label>
                  <div className="flex">
                    {canEditCourse && <Button type="button" variant="ghost" size="icon" aria-label={t('moveUp')} onClick={() => editModules((ms) => move(ms, mi, -1))}><ArrowUp className="size-4" /></Button>}
                    {canEditCourse && <Button type="button" variant="ghost" size="icon" aria-label={t('moveDown')} onClick={() => editModules((ms) => move(ms, mi, 1))}><ArrowDown className="size-4" /></Button>}
                    <Button type="button" variant="ghost" size="icon" aria-label={t('remove')} onClick={() => editModules((ms) => ms.filter((_, i) => i !== mi))}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
                <ol className="space-y-2 p-3">
                  {m.lessons.map((l, li) => {
                    const progress = l.id ? uploads[l.id] : undefined;
                    return (
                      <li key={l.key} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-start gap-2">
                          <span className="mt-2 w-6 text-xs font-bold text-muted-foreground">{li + 1}.</span>
                          <div className="min-w-[200px] flex-1">
                            <LocalizedField id={`l-${l.key}`} value={l.title} lang={lang} maxLength={120} aria-label={t('fields.lessonTitle')}
                              onChange={(v) => { setLesson(mi, li, { title: v }); setDirty(true); }} />
                          </div>
                          <div className="flex">
                            <Button type="button" variant="ghost" size="icon" aria-label={t('moveUp')} onClick={() => editModules((ms) => ms.map((x, i) => (i === mi ? { ...x, lessons: move(x.lessons, li, -1) } : x)))}><ArrowUp className="size-4" /></Button>
                            <Button type="button" variant="ghost" size="icon" aria-label={t('moveDown')} onClick={() => editModules((ms) => ms.map((x, i) => (i === mi ? { ...x, lessons: move(x.lessons, li, 1) } : x)))}><ArrowDown className="size-4" /></Button>
                            <Button type="button" variant="ghost" size="icon" aria-label={t('remove')} onClick={() => editModules((ms) => ms.map((x, i) => (i === mi ? { ...x, lessons: x.lessons.filter((_, j) => j !== li) } : x)))}><Trash2 className="size-4" /></Button>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3 ps-8 text-xs">
                          <VideoBadge status={l.videoStatus} progress={progress} t={t} />
                          {l.durationSec > 0 && <span className="text-muted-foreground">{fmtDuration(l.durationSec)}</span>}
                          {l.id ? (
                            <label className={cn('inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 font-semibold hover:bg-accent', progress !== undefined && 'pointer-events-none opacity-50')}>
                              <Upload className="size-3.5" />{l.hasVideo ? t('replaceVideo') : t('uploadVideo')}
                              <input type="file" accept="video/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadVideo(mi, li, f); }} />
                            </label>
                          ) : (
                            <span className="text-muted-foreground">{t('saveBeforeUpload')}</span>
                          )}
                          {l.id && l.hasVideo && l.videoStatus !== 'READY' && progress === undefined && (
                            <button type="button" onClick={() => void refresh(l.id!)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><RefreshCw className="size-3.5" />{t('checkVideo')}</button>
                          )}
                          <label className="ms-auto inline-flex items-center gap-1.5 font-semibold">
                            <input type="checkbox" checked={l.isPreview} disabled={m.comingSoon} onChange={(e) => { setLesson(mi, li, { isPreview: e.target.checked }); setDirty(true); }} />
                            {t('freePreview')}
                          </label>
                        </div>
                      </li>
                    );
                  })}
                  {m.lessons.length < 60 && (
                    <li>
                      <Button type="button" variant="outline" size="sm" onClick={() => editModules((ms) => ms.map((x, i) => (i === mi ? {
                        ...x, lessons: [...x.lessons, { key: tmpKey(), title: { source: lang, [lang]: t('newLesson', { n: x.lessons.length + 1 }) }, description: null, isPreview: false, hasVideo: false, videoStatus: 'NONE' as const, durationSec: 0 }],
                      } : x)))}><Plus className="me-1 size-4" />{t('addLesson')}</Button>
                    </li>
                  )}
                </ol>
                <QuizEditor
                  key={`quiz-${m.key}`}
                  questions={m.quiz}
                  lang={lang}
                  moduleId={m.id}
                  draftUrl={m.id && m.lessons.some((l) => l.id) ? `${apiBase}/courses/${course.id}/quiz-draft` : null}
                  onChange={(next) => editModules((ms) => ms.map((x, i) => (i === mi ? { ...x, quiz: next } : x)))}
                />
              </fieldset>
            ))}
            {modules.length < 30 && canAddModule && !readOnly && (
              <Button type="button" variant="outline" onClick={() => editModules((ms) => [...ms, { key: tmpKey(), title: { source: lang, [lang]: t('newModule', { n: ms.length + 1 }) }, comingSoon: false, pending: Boolean(studio) && editMode === 'ADD_MODULES', lessons: [], quiz: [] }])}>
                <Plus className="me-1 size-4" />{t('addModule')}
              </Button>
            )}
          </section>
        </div>

        {/* ── Side column ── */}
        <div className="min-w-0 space-y-6">
          <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <h2 className="font-display text-base font-extrabold">{studio ? t('studio.reviewTitle') : t('sections.publish')}</h2>
            {course.reviewNote && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="font-semibold">{t('studio.noteFromMetwork')}</p>
                <p className="mt-1 whitespace-pre-line">{course.reviewNote}</p>
              </div>
            )}
            {problems.length ? (
              <ul className="space-y-1.5 text-sm">
                {problems.filter((p) => !studio || p !== 'MENTOR_NOT_APPROVED').map((p) => (
                  <li key={p} className="flex items-start gap-2 text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{t(`problems.${p}`)}</li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-primary"><CheckCircle2 className="size-4" />{t('readyToPublish')}</p>
            )}
            {studio ? (
              <div className="space-y-2">
                {!studio.addendumSigned && <p className="text-sm text-muted-foreground">{t('studio.addendumNeeded')}</p>}
                {editMode === 'FULL' && (
                  <Button type="button" size="sm" disabled={busy !== null || !studio.addendumSigned} onClick={submitForReview}>{t('studio.submit')}</Button>
                )}
                {editMode === 'ADD_MODULES' && modules.some((m) => m.pending) && (
                  course.modulesSubmittedAt
                    ? <p className="text-sm text-muted-foreground">{t('studio.modulesInReview')}</p>
                    : <Button type="button" size="sm" disabled={busy !== null || !studio.addendumSigned} onClick={submitForReview}>{t('studio.submitModules')}</Button>
                )}
                {editMode === 'LOCKED' && <p className="text-sm text-muted-foreground">{t(`studio.locked.${course.status}`)}</p>}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {course.status !== 'PUBLISHED' && <Button type="button" size="sm" disabled={busy !== null} onClick={() => changeStatus('PUBLISH')}>{t('publish')}</Button>}
                  {course.status === 'PUBLISHED' && <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => changeStatus('UNPUBLISH')}>{t('unpublish')}</Button>}
                  {course.status !== 'ARCHIVED' && <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => changeStatus('ARCHIVE')}>{t('archive')}</Button>}
                </div>
                {(course.status === 'IN_REVIEW' || course.modulesSubmittedAt) && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-sm font-semibold">{course.status === 'IN_REVIEW' ? t('adminReview.courseSubmitted') : t('adminReview.modulesSubmitted')}</p>
                    <textarea aria-label={t('adminReview.note')} placeholder={t('adminReview.note')} value={reviewNote} maxLength={2000}
                      onChange={(e) => setReviewNote(e.target.value)} className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm" />
                    <div className="flex flex-wrap gap-2">
                      {course.status === 'IN_REVIEW'
                        ? <Button type="button" size="sm" variant="outline" disabled={busy !== null || reviewNote.trim().length < 3} onClick={() => review('REQUEST_CHANGES')}>{t('adminReview.requestChanges')}</Button>
                        : <>
                            <Button type="button" size="sm" disabled={busy !== null} onClick={() => review('APPROVE_MODULES')}>{t('adminReview.approveModules')}</Button>
                            <Button type="button" size="sm" variant="outline" disabled={busy !== null || reviewNote.trim().length < 3} onClick={() => review('REJECT_MODULES')}>{t('adminReview.rejectModules')}</Button>
                          </>}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <fieldset disabled={!canEditCourse} className="m-0 min-w-0 space-y-6 border-0 p-0">
          <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <h2 className="font-display text-base font-extrabold">{t('sections.cover')}</h2>
            <CoverUpload url={course.thumbnailUrl} endpoint={studio ? 'consultant' : 'admin'} onUpload={(url) => edit('thumbnailUrl', url)} onError={(msg) => setMessage({ kind: 'error', text: msg })} />
            <p className="text-xs text-muted-foreground">{t('coverHint')}</p>
          </section>

          <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
            <h2 className="font-display text-base font-extrabold">{t('sections.classification')}</h2>
            <div className="space-y-1.5">
              <Label htmlFor="c-field">{t('fields.field')}</Label>
              <select id="c-field" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={course.fieldId} onChange={(e) => edit('fieldId', e.target.value)}>
                {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-level">{t('fields.level')}</Label>
              <select id="c-level" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={course.level} onChange={(e) => edit('level', e.target.value as AcademyLevel)}>
                {ACADEMY_LEVELS.map((l) => <option key={l} value={l}>{tc(`levels.${l}`)}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-audio">{t('fields.audio')}</Label>
              <select id="c-audio" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={course.audioLanguage} onChange={(e) => edit('audioLanguage', e.target.value as AcademyAudioLanguage)}>
                {ACADEMY_AUDIO_LANGUAGES.map((a) => <option key={a} value={a}>{tc(`audio.${a}`)}</option>)}
              </select>
            </div>
{!studio && (<>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t('fields.mentors')}</legend>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-input p-2">
                {mentors.map((m) => {
                  const checked = course.mentorIds.includes(m.id);
                  return (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={checked} disabled={!checked && course.mentorIds.length >= 3}
                        onChange={(e) => edit('mentorIds', e.target.checked ? [...course.mentorIds, m.id] : course.mentorIds.filter((x) => x !== m.id))} />
                      <span className="truncate">{m.fullName}</span>
                      {!m.approved && <Badge variant="outline" className="ms-auto text-[10px]">{t('notApproved')}</Badge>}
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">{t('mentorsHint')}</p>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="c-slug">{t('fields.slug')}</Label>
              <Input id="c-slug" dir="ltr" value={course.slug} maxLength={80} onChange={(e) => edit('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
            </div>
            </>)}
          </section>

          <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
            <h2 className="font-display text-base font-extrabold">{t('sections.price')}</h2>
            <div className="space-y-1.5">
              <Label htmlFor="c-price">{t('fields.price')}</Label>
              <Input id="c-price" type="number" inputMode="numeric" min={ACADEMY_MIN_COURSE_PRICE_DZD} step={100} value={course.priceDzd || ''}
                onChange={(e) => edit('priceDzd', Math.round(Number(e.target.value) || 0))} />
              <p className={cn('text-xs', course.priceDzd < ACADEMY_MIN_COURSE_PRICE_DZD ? 'text-destructive' : 'text-muted-foreground')}>
                {course.priceDzd < ACADEMY_MIN_COURSE_PRICE_DZD
                  ? t('priceMin', { min: ACADEMY_MIN_COURSE_PRICE_DZD })
                  : t('premiumPrice', { price: premiumPrice })}
              </p>
            </div>
{studio
              ? <p className="text-sm text-muted-foreground">{course.includedInPass ? t('studio.inPass') : t('studio.notInPass')}</p>
              : (
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={course.includedInPass} onChange={(e) => edit('includedInPass', e.target.checked)} />
              {t('fields.inPass')}
            </label>
              )}
          </section>

          </fieldset>

          {(!studio || (editMode === 'FULL' && course.status === 'DRAFT' && !course.submittedAt)) && (
          <section className="rounded-2xl border border-destructive/30 p-5">
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-sm">{t('deleteConfirm')}</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="destructive" disabled={busy !== null} onClick={remove}>{t('deleteYes')}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>{t('cancel')}</Button>
                </div>
              </div>
            ) : (
              <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="me-1 size-4" />{t('delete')}</Button>
            )}
          </section>
          )}
        </div>
      </div>

      {/* ── Save bar ── On phones it sits above the mobile tab bar (the portal's in the Studio, the
          dashboard's for the admin), and beside the sidebar on desktop. */}
      {!readOnly && (
      <div className={cn('fixed inset-x-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:bottom-0',
        studio ? 'bottom-[calc(4.25rem+env(safe-area-inset-bottom))] lg:ps-64' : 'bottom-[calc(3.25rem+1px+env(safe-area-inset-bottom))] lg:ps-72')}>
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <p role="status" className={cn('min-w-0 flex-1 truncate text-sm', message?.kind === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            {message?.text ?? (dirty ? t('unsaved') : t('allSaved'))}
          </p>
          <Button type="button" onClick={save} disabled={busy !== null || !dirty}>
            {busy === 'save' && <Loader2 className="me-1 size-4 animate-spin" />}{t('save')}
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}

function VideoBadge({ status, progress, t }: { status: AcademyVideoStatus; progress?: number; t: ReturnType<typeof useTranslations> }) {
  if (progress !== undefined) {
    return (
      <span className="inline-flex items-center gap-2 font-semibold text-primary">
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${progress}%` }} /></span>
        {progress}%
      </span>
    );
  }
  const tone: Record<AcademyVideoStatus, string> = {
    NONE: 'bg-muted text-muted-foreground',
    UPLOADING: 'bg-amber-100 text-amber-800',
    PROCESSING: 'bg-amber-100 text-amber-800',
    READY: 'bg-primary/10 text-primary',
    FAILED: 'bg-destructive/10 text-destructive',
  };
  return <span className={cn('rounded-full px-2 py-0.5 font-bold', tone[status])}>{t(`video.${status}`)}</span>;
}
