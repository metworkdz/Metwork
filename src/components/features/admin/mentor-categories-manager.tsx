'use client';

/**
 * Admin mentor-categories manager — card list + create/edit dialog.
 *
 * Reads come from the RSC parent (direct service read); every mutation goes
 * through the /api/admin/mentor-categories routes then router.refresh(),
 * following the PerksManager convention.
 *
 * No delete affordance exists anywhere in this component — deactivating
 * (active: false) is the only removal path, so a category already assigned
 * to a mentor is never orphaned.
 */
import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Plus, Pencil, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { getMentorCategoryLabel } from '@/lib/mentor-categories';
import type { MentorCategoryRecord } from '@/server/db/store';

interface FormState {
  labelFr: string;
  labelEn: string;
  labelAr: string;
  sortOrder: string;
}

const EMPTY_FORM: FormState = { labelFr: '', labelEn: '', labelAr: '', sortOrder: '' };

function formFromCategory(c: MentorCategoryRecord): FormState {
  return {
    labelFr: c.label.fr,
    labelEn: c.label.en,
    labelAr: c.label.ar,
    sortOrder: String(c.sortOrder),
  };
}

export function MentorCategoriesManager({ categories }: { categories: MentorCategoryRecord[] }) {
  const t = useTranslations('admin.mentorCategoriesManager');
  const rawLocale = useLocale();
  const locale: 'en' | 'fr' | 'ar' = rawLocale === 'en' || rawLocale === 'ar' ? rawLocale : 'fr';
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  /** null = create mode, otherwise the category being edited. */
  const [editing, setEditing] = useState<MentorCategoryRecord | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  }

  function openCreate() {
    setEditing(null);
    const nextSortOrder = categories.length > 0 ? Math.max(...categories.map((c) => c.sortOrder)) + 1 : 0;
    setForm({ ...EMPTY_FORM, sortOrder: String(nextSortOrder) });
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(category: MentorCategoryRecord) {
    setEditing(category);
    setForm(formFromCategory(category));
    setError(null);
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.labelFr.trim() || !form.labelEn.trim() || !form.labelAr.trim()) {
      setError(t('allLabelsRequired'));
      return;
    }
    const sortOrder = form.sortOrder.trim() ? parseInt(form.sortOrder, 10) : 0;
    if (isNaN(sortOrder) || sortOrder < 0) {
      setError(t('sortOrderInvalid'));
      return;
    }

    const payload = {
      label: { fr: form.labelFr.trim(), en: form.labelEn.trim(), ar: form.labelAr.trim() },
      sortOrder,
    };

    startTransition(async () => {
      try {
        const res = editing
          ? await fetch(`/api/admin/mentor-categories/${editing.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify(payload),
            })
          : await fetch('/api/admin/mentor-categories', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ ...payload, active: true }),
            });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error?.message ?? t('failed'));
          return;
        }
        setDialogOpen(false);
        router.refresh();
      } catch {
        setError(t('networkError'));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="me-1.5 size-4" />
          {t('addCategory')}
        </Button>
      </div>

      {categories.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {t('noCategories')}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {categories.map((category) => (
            <AdminCategoryCard
              key={category.id}
              category={category}
              locale={locale}
              onEdit={() => openEdit(category)}
              onChanged={() => router.refresh()}
            />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('editCategory') : t('addCategory')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label={t('labelFr')} htmlFor="mc-label-fr" required>
              <Input
                id="mc-label-fr"
                value={form.labelFr}
                onChange={(e) => set('labelFr', e.target.value)}
                placeholder={t('labelFrPlaceholder')}
              />
            </FormField>
            <FormField label={t('labelEn')} htmlFor="mc-label-en" required>
              <Input
                id="mc-label-en"
                value={form.labelEn}
                onChange={(e) => set('labelEn', e.target.value)}
                placeholder={t('labelEnPlaceholder')}
              />
            </FormField>
            <FormField label={t('labelAr')} htmlFor="mc-label-ar" required>
              <Input
                id="mc-label-ar"
                dir="rtl"
                value={form.labelAr}
                onChange={(e) => set('labelAr', e.target.value)}
                placeholder={t('labelArPlaceholder')}
              />
            </FormField>
            <FormField label={t('sortOrder')} htmlFor="mc-sort-order" hint={t('sortOrderHint')}>
              <Input
                id="mc-sort-order"
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => set('sortOrder', e.target.value)}
              />
            </FormField>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={isPending}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" loading={isPending}>
                {editing ? t('save') : t('create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────── Card ─────────────────────── */

function AdminCategoryCard({
  category,
  locale,
  onEdit,
  onChanged,
}: {
  category: MentorCategoryRecord;
  locale: 'en' | 'fr' | 'ar';
  onEdit: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('admin.mentorCategoriesManager');
  const [toggling, setToggling] = useState(false);

  async function toggleActive() {
    setToggling(true);
    try {
      await fetch(`/api/admin/mentor-categories/${category.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ active: !category.active }),
      });
      onChanged();
    } finally {
      setToggling(false);
    }
  }

  return (
    <Card className={category.active ? '' : 'opacity-60'}>
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
            <Tags className="size-5" />
          </div>
          {!category.active && <Badge variant="danger">{t('inactive')}</Badge>}
        </div>

        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{getMentorCategoryLabel(category, locale)}</h3>
          <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            <div className="flex gap-1.5">
              <dt className="font-medium">FR</dt>
              <dd className="truncate">{category.label.fr}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="font-medium">EN</dt>
              <dd className="truncate">{category.label.en}</dd>
            </div>
            <div className="flex gap-1.5" dir="rtl">
              <dt className="font-medium">AR</dt>
              <dd className="truncate">{category.label.ar}</dd>
            </div>
          </dl>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="me-1 size-3.5" />
            {t('edit')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={toggling}
            onClick={toggleActive}
            className={
              category.active ? 'ms-auto text-destructive hover:text-destructive' : 'ms-auto text-muted-foreground'
            }
          >
            {category.active ? t('deactivate') : t('activate')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
