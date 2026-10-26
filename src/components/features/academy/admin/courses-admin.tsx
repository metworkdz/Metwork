'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Settings } from 'lucide-react';
import { useRouter, Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { localizedText } from '@/lib/localized-text';
import type { Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

export interface AdminCourseRow {
  id: string;
  title: string;
  status: string;
  priceDzd: number;
  fieldLabel: string;
  mentorNames: string;
  thumbnailUrl: string | null;
  lessonCount: number;
  updatedAt: string;
}

interface Props {
  rows: AdminCourseRow[];
  fields: { id: string; label: string }[];
  mentors: { id: string; fullName: string }[];
  locale: Locale;
}

const TONE: Record<string, string> = {
  PUBLISHED: 'bg-primary/10 text-primary',
  DRAFT: 'bg-muted text-muted-foreground',
  ARCHIVED: 'bg-muted text-muted-foreground',
  IN_REVIEW: 'bg-amber-100 text-amber-800',
  CHANGES_REQUESTED: 'bg-amber-100 text-amber-800',
};

export function CoursesAdmin({ rows, fields, mentors, locale }: Props) {
  const t = useTranslations('academyAdmin');
  const tm = useTranslations('academy');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [fieldId, setFieldId] = useState(fields[0]?.id ?? '');
  const [mentorId, setMentorId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const course = await apiClient.post<{ id: string }>('/admin/academy/courses', {
        title: localizedText(locale, title), fieldId, mentorIds: [mentorId],
      });
      router.push(`/dashboard/admin/academy/courses/${course.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('builder.errors.generic'));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setOpen(true)}><Plus className="me-1 size-4" />{t('list.new')}</Button>
        <Button asChild variant="outline"><Link href="/dashboard/admin/academy/settings"><Settings className="me-1 size-4" />{t('list.settings')}</Link></Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{t('list.empty')}</div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/dashboard/admin/academy/courses/${r.id}`} className="flex items-center gap-4 p-4 hover:bg-accent/50">
                <div className="aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.thumbnailUrl && <img src={r.thumbnailUrl} alt="" className="size-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.mentorNames} · {r.fieldLabel} · {t('list.lessons', { count: r.lessonCount })}</p>
                </div>
                <span className="hidden text-sm tabular-nums sm:block">{tm('money', { price: r.priceDzd.toLocaleString(locale) })}</span>
                <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold', TONE[r.status])}>{t(`builder.status.${r.status}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('list.new')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="n-title">{t('builder.fields.title')}</Label>
              <Input id="n-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t('list.titleHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="n-field">{t('builder.fields.field')}</Label>
              <select id="n-field" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
                {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="n-mentor">{t('list.mentor')}</Label>
              <select id="n-mentor" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={mentorId} onChange={(e) => setMentorId(e.target.value)}>
                <option value="">{t('list.pickMentor')}</option>
                {mentors.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
              </select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('builder.cancel')}</Button>
            <Button onClick={create} disabled={busy || !title.trim() || !fieldId || !mentorId}>{t('list.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
