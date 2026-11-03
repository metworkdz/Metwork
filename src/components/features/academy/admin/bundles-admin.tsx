'use client';

/**
 * Admin: learning paths sold as bundles. Pick published courses in order, set
 * one price (at least the mentors' total share and at most the sum of the
 * course prices — the server checks both), then publish.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { resolveText, type LocalizedText } from '@/lib/localized-text';
import { locales, type Locale } from '@/i18n/config';
import type { AcademyBundleRecord } from '@/server/db/store';
import { LocalizedField } from './localized-field';
import { formatDzd } from '../format';

interface CourseOption { id: string; title: string; priceDzd: number }
type Draft = { id?: string; title: LocalizedText | null; description: LocalizedText | null; courseIds: string[]; priceDzd: number; status: AcademyBundleRecord['status'] };

const empty = (): Draft => ({ title: null, description: null, courseIds: [], priceDzd: 0, status: 'DRAFT' });

export function BundlesAdmin({ initial, courses, locale }: { initial: AcademyBundleRecord[]; courses: CourseOption[]; locale: Locale }) {
  const t = useTranslations('academyAdmin.bundles');
  const tm = useTranslations('academy');
  const money = (n: number) => tm('money', { price: formatDzd(n, locale) });
  const [bundles, setBundles] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lang, setLang] = useState<Locale>(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listTotal = draft ? draft.courseIds.reduce((s, id) => s + (courses.find((c) => c.id === id)?.priceDzd ?? 0), 0) : 0;

  async function save() {
    if (!draft?.title) return;
    setBusy(true);
    setError(null);
    try {
      const body = { title: draft.title, description: draft.description, courseIds: draft.courseIds, priceDzd: draft.priceDzd };
      const res = draft.id
        ? await apiClient.put<{ bundle: AcademyBundleRecord }>(`/admin/academy/bundles/${draft.id}`, { ...body, status: draft.status })
        : await apiClient.post<{ bundle: AcademyBundleRecord }>('/admin/academy/bundles', body);
      setBundles((bs) => [res.bundle, ...bs.filter((b) => b.id !== res.bundle.id)]);
      setDraft(null);
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      setError(['COURSE_NOT_PUBLISHED', 'PRICE_INVALID', 'PRICE_BELOW_SHARES', 'DUPLICATE_COURSE', 'VALIDATION_ERROR'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));
    } finally { setBusy(false); }
  }

  if (draft) {
    const available = courses.filter((c) => !draft.courseIds.includes(c.id));
    return (
      <section className="space-y-5 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-extrabold">{draft.id ? t('edit') : t('new')}</h2>
          <div className="flex gap-1" role="group" aria-label={t('language')}>
            {locales.map((l) => (
              <Button key={l} type="button" size="sm" variant={lang === l ? 'default' : 'outline'} onClick={() => setLang(l)}>{l.toUpperCase()}</Button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-title">{t('fieldTitle')}</Label>
          <LocalizedField id="b-title" value={draft.title} lang={lang} maxLength={120} onChange={(v) => setDraft({ ...draft, title: v })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-desc">{t('fieldDescription')}</Label>
          <LocalizedField id="b-desc" value={draft.description} lang={lang} maxLength={3000} multiline onChange={(v) => setDraft({ ...draft, description: v })} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t('fieldCourses')}</p>
          <ol className="space-y-1.5">
            {draft.courseIds.map((id, i) => {
              const c = courses.find((x) => x.id === id);
              const move = (by: number) => {
                const next = [...draft.courseIds];
                const j = i + by;
                if (j < 0 || j >= next.length) return;
                [next[i], next[j]] = [next[j]!, next[i]!];
                setDraft({ ...draft, courseIds: next });
              };
              return (
                <li key={id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="w-5 text-xs font-bold text-muted-foreground">{i + 1}.</span>
                  {/* On a phone the buttons wrap under the title instead of squeezing it. */}
                  <span className="line-clamp-2 min-w-[10rem] flex-1">{c?.title ?? id}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{c ? money(c.priceDzd) : ''}</span>
                  <Button type="button" size="icon" variant="ghost" aria-label={t('moveUp')} onClick={() => move(-1)}><ArrowUp className="size-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label={t('moveDown')} onClick={() => move(1)}><ArrowDown className="size-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label={t('remove')} onClick={() => setDraft({ ...draft, courseIds: draft.courseIds.filter((x) => x !== id) })}><X className="size-4" /></Button>
                </li>
              );
            })}
          </ol>
          {available.length > 0 && (
            <select aria-label={t('addCourse')} value="" onChange={(e) => e.target.value && setDraft({ ...draft, courseIds: [...draft.courseIds, e.target.value] })}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm">
              <option value="">{t('addCourse')}</option>
              {available.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="b-price">{t('fieldPrice')}</Label>
            <Input id="b-price" type="number" inputMode="numeric" min={0} value={draft.priceDzd || ''} onChange={(e) => setDraft({ ...draft, priceDzd: Math.floor(Number(e.target.value) || 0) })} className="text-base sm:text-sm" />
            <p className="text-xs text-muted-foreground">{t('priceHint', { list: money(listTotal) })}</p>
          </div>
          {draft.id && (
            <div className="space-y-1.5">
              <Label htmlFor="b-status">{t('fieldStatus')}</Label>
              <select id="b-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft['status'] })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm">
                {(['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const).map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
              </select>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('sharesNote')}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button disabled={busy || !draft.title || draft.courseIds.length < 2 || draft.priceDzd <= 0} onClick={save}>{busy && <Loader2 className="me-1 size-4 animate-spin" />}{t('save')}</Button>
          <Button variant="ghost" onClick={() => { setDraft(null); setError(null); }}>{t('cancel')}</Button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <Button onClick={() => setDraft(empty())} disabled={courses.length < 2}><Plus className="me-1 size-4" />{t('new')}</Button>
      {courses.length < 2 && <p className="text-sm text-muted-foreground">{t('needCourses')}</p>}
      {bundles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {bundles.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => setDraft({ id: b.id, title: b.title, description: b.description, courseIds: b.courseIds, priceDzd: b.priceDzd, status: b.status })}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start text-sm hover:bg-muted/40">
                <span className="min-w-0 flex-1 truncate font-semibold">{resolveText(b.title, locale)}</span>
                <span className="text-xs text-muted-foreground">{t('courses', { count: b.courseIds.length })}</span>
                <span className="tabular-nums">{money(b.priceDzd)}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{t(`status.${b.status}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
