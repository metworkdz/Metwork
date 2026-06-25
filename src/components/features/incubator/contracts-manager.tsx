'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileSignature, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import {
  CONTRACT_VARIABLES,
  buildSampleVariables,
  renderTemplate,
  type ContractLang,
} from '@/server/contracts/variables';

type Category = 'ANY' | 'COWORKING' | 'PRIVATE_OFFICE' | 'TRAINING_ROOM' | 'DOMICILIATION';

interface TemplateRow {
  id: string;
  name: string;
  spaceCategory?: Category;
  body: string;
  language: ContractLang;
  createdAt: string;
  updatedAt: string;
}

interface Draft {
  id: string | null;
  name: string;
  spaceCategory: Category;
  body: string;
  language: ContractLang;
}

const EMPTY_DRAFT: Draft = { id: null, name: '', spaceCategory: 'ANY', body: '', language: 'fr' };
const CATEGORIES: Category[] = ['ANY', 'COWORKING', 'PRIVATE_OFFICE', 'TRAINING_ROOM', 'DOMICILIATION'];
const LANGS: ContractLang[] = ['fr', 'en', 'ar'];

export function ContractsManager({ initial }: { initial: TemplateRow[] }) {
  const t = useTranslations('incubator.contracts');
  const [items, setItems] = useState<TemplateRow[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const langLabel = (l: ContractLang) => t(l === 'fr' ? 'langFr' : l === 'en' ? 'langEn' : 'langAr');

  function startCreate() { setError(null); setDraft({ ...EMPTY_DRAFT }); }
  function startEdit(row: TemplateRow) {
    setError(null);
    setDraft({ id: row.id, name: row.name, spaceCategory: row.spaceCategory ?? 'ANY', body: row.body, language: row.language });
  }
  function closeEditor() { setDraft(null); setError(null); }

  /** Insert a {{token}} at the textarea caret (or append). */
  function insertToken(token: string) {
    if (!draft) return;
    const snippet = `{{${token}}}`;
    const el = bodyRef.current;
    if (!el) { setDraft({ ...draft, body: draft.body + snippet }); return; }
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? draft.body.length;
    const next = draft.body.slice(0, start) + snippet + draft.body.slice(end);
    setDraft({ ...draft, body: next });
    // Restore caret just after the inserted token.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.body.trim()) { setError(t('errorGeneric')); return; }
    setBusy(true);
    setError(null);
    try {
      const isEdit = draft.id != null;
      const res = await fetch(isEdit ? `/api/incubator/contracts/${draft.id}` : '/api/incubator/contracts', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: draft.name.trim(),
          spaceCategory: draft.spaceCategory,
          body: draft.body,
          language: draft.language,
        }),
      });
      if (!res.ok) { setError(t('errorGeneric')); return; }
      const data = (await res.json()) as { template: TemplateRow };
      setItems((prev) => isEdit
        ? prev.map((it) => (it.id === data.template.id ? data.template : it))
        : [data.template, ...prev]);
      setDraft(null);
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm(t('deleteConfirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/incubator/contracts/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) return;
      setItems((prev) => prev.filter((it) => it.id !== id));
      if (draft?.id === id) setDraft(null);
    } finally {
      setBusy(false);
    }
  }

  const previewText = useMemo(() => {
    if (!draft) return '';
    return renderTemplate(draft.body, buildSampleVariables(draft.language));
  }, [draft]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      {/* ── Left: template list ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('title')}</h2>
          <Button size="sm" className="h-8 gap-1.5" onClick={startCreate}>
            <Plus className="size-4" /> {t('newTemplate')}
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {items.length === 0 ? (
              <InlineEmptyState
                title={t('emptyTitle')}
                description={t('emptyDesc')}
                icon={<FileSignature className="size-5 text-muted-foreground" />}
              />
            ) : (
              <ul className="divide-y">
                {items.map((row) => {
                  const active = draft?.id === row.id;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/50 ${active ? 'bg-muted/60' : ''}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{row.name}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="text-xs">{t(`cat${row.spaceCategory ?? 'ANY'}`)}</Badge>
                            <Badge variant="info" className="text-xs uppercase">{row.language}</Badge>
                          </span>
                        </span>
                        <Trash2
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); void remove(row.id); }}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Right: editor + preview ── */}
      <div>
        {draft === null ? (
          <Card className="h-full">
            <CardContent className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <FileSignature className="size-8 opacity-40" />
              <p>{t('subtitle')}</p>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={startCreate}>
                <Plus className="size-4" /> {t('newTemplate')}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{draft.id ? t('editTemplate') : t('newTemplate')}</h3>
                <Button size="icon" variant="ghost" className="size-7" onClick={closeEditor} aria-label={t('cancel')}>
                  <X className="size-4" />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                <div className="space-y-1.5">
                  <Label htmlFor="ct-name">{t('name')}</Label>
                  <Input
                    id="ct-name"
                    value={draft.name}
                    placeholder={t('namePlaceholder')}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('category')}</Label>
                  <Select value={draft.spaceCategory} onValueChange={(v) => setDraft({ ...draft, spaceCategory: v as Category })}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`cat${c}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('language')}</Label>
                  <Select value={draft.language} onValueChange={(v) => setDraft({ ...draft, language: v as ContractLang })}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANGS.map((l) => <SelectItem key={l} value={l}>{langLabel(l)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Variable reference panel */}
              <div className="space-y-1.5">
                <Label>{t('variables')}</Label>
                <p className="text-xs text-muted-foreground">{t('variablesHint')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {CONTRACT_VARIABLES.map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      title={t(`vars.${v.descriptionKey}`)}
                      onClick={() => insertToken(v.token)}
                      className="rounded-md border border-input bg-muted/40 px-2 py-1 font-mono text-xs text-foreground transition-colors hover:border-primary hover:bg-primary/10"
                    >
                      {`{{${v.token}}}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div className="space-y-1.5">
                <Label htmlFor="ct-body">{t('body')}</Label>
                <Textarea
                  id="ct-body"
                  ref={bodyRef}
                  value={draft.body}
                  placeholder={t('bodyPlaceholder')}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  dir={draft.language === 'ar' ? 'rtl' : 'ltr'}
                  className="min-h-[180px] font-mono text-sm leading-relaxed"
                />
              </div>

              {/* Live preview */}
              <div className="space-y-1.5">
                <Label>{t('preview')}</Label>
                <p className="text-xs text-muted-foreground">{t('previewHint')}</p>
                <div
                  dir={draft.language === 'ar' ? 'rtl' : 'ltr'}
                  className={`min-h-[120px] whitespace-pre-wrap rounded-md border bg-muted/30 p-4 text-sm leading-relaxed ${draft.language === 'ar' ? 'text-right' : 'text-left'}`}
                >
                  {previewText || <span className="text-muted-foreground">{t('bodyPlaceholder')}</span>}
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={closeEditor} disabled={busy}>{t('cancel')}</Button>
                <Button className="gap-1.5" onClick={() => void save()} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {busy ? t('saving') : t('save')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
