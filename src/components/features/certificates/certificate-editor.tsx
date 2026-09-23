'use client';

/**
 * Designing a program's participation certificate.
 *
 * Settings on one side, the certificate on the other. The preview is the real
 * PDF, drawn by the same renderer that issues the certificates — not an HTML
 * imitation that could drift from what prints — requested a moment after the
 * host stops typing.
 *
 * Shared by the incubator dashboard and the consultant portal; only the API
 * base and the upload route differ.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, ExternalLink, Loader2, PenLine, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SignaturePad, type SignaturePadHandle } from '@/components/shared/signature-pad';
import { cn } from '@/lib/utils';
import {
  certificateVariables,
  emptyVariablesIn,
} from '@/server/certificates/text';
import {
  CERTIFICATE_VARIABLES,
  type CertificateContext,
  type CertificateFont,
  type CertificateMode,
  type CertificateSettings,
  type CertificateSignatory,
  type CertificateTemplate,
} from '@/server/certificates/types';

interface Props {
  programId: string;
  apiBase: '/api/incubator/programs' | '/api/consultant/programs';
  uploadEndpoint: '/api/incubator/upload' | '/api/consultant/upload';
  /** Extra field the consultant upload route reads to pick an image folder. */
  uploadKind?: string;
}

const TEMPLATES: Array<{ id: CertificateTemplate; labelKey: string }> = [
  { id: 'VAGUES', labelKey: 'templateWaves' },
  { id: 'DIAGONALES', labelKey: 'templateDiagonals' },
  { id: 'CADRE', labelKey: 'templateFrame' },
  { id: 'LATERAL', labelKey: 'templateSide' },
];

const FONTS: Array<{ id: CertificateFont; label: string }> = [
  { id: 'MONTSERRAT', label: 'Montserrat' },
  { id: 'POPPINS', label: 'Poppins' },
  { id: 'LATO', label: 'Lato' },
  { id: 'SPECTRAL', label: 'Spectral' },
  { id: 'CORMORANT', label: 'Cormorant Garamond' },
];

/** Two colors each: the ribbon and main band, then the deep corner. */
const PALETTES: Array<{ labelKey: string; primary: string; dark: string }> = [
  { labelKey: 'paletteGreen', primary: '#3fb34f', dark: '#0b7a3d' },
  { labelKey: 'paletteBlue', primary: '#2d6cdf', dark: '#16326b' },
  { labelKey: 'paletteBurgundy', primary: '#b0304a', dark: '#5e1426' },
  { labelKey: 'paletteGold', primary: '#d4a017', dark: '#7a5a06' },
  { labelKey: 'paletteGraphite', primary: '#6b7280', dark: '#1f2933' },
];

/** Tiny glyph of each template's decoration, so the choice is visual. */
function TemplateGlyph({ id }: { id: CertificateTemplate }) {
  const common = { fill: 'currentColor' };
  return (
    <svg viewBox="0 0 42 30" className="h-7 w-10" aria-hidden>
      <rect x="0.5" y="0.5" width="41" height="29" rx="2" fill="none" stroke="currentColor" strokeOpacity=".35" />
      {id === 'VAGUES' && (
        <>
          <path d="M22 0.5 Q34 4 41.5 15 V0.5 Z" {...common} />
          <path d="M0.5 12 Q5 25 17 29.5 H0.5 Z" {...common} />
        </>
      )}
      {id === 'DIAGONALES' && (
        <>
          <path d="M24 0.5 H41.5 V13 Z" {...common} />
          <path d="M0.5 16 V29.5 H16 Z" {...common} />
        </>
      )}
      {id === 'CADRE' && <rect x="3" y="3" width="36" height="24" rx="1" fill="none" stroke="currentColor" strokeWidth="2" />}
      {id === 'LATERAL' && <path d="M32 0.5 Q27 15 35 29.5 H41.5 V0.5 Z" {...common} />}
      <rect x="11" y="10" width="16" height="3" rx="1" fill="currentColor" fillOpacity=".55" />
      <rect x="9" y="16" width="20" height="1.5" rx=".75" fill="currentColor" fillOpacity=".35" />
    </svg>
  );
}

/** Reads the error envelope `{ error: { code, message, details } }`. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as
    { error?: { message?: string; details?: { fieldErrors?: Record<string, string[]> } } } | null;
  const field = body?.error?.details?.fieldErrors;
  const firstField = field ? Object.values(field).flat()[0] : undefined;
  return firstField ?? body?.error?.message ?? fallback;
}

export function CertificateEditor({ programId, apiBase, uploadEndpoint, uploadKind }: Props) {
  const t = useTranslations('certificates');
  const base = `${apiBase}/${programId}/certificates`;

  const [settings, setSettings] = useState<CertificateSettings | null>(null);
  const [context, setContext] = useState<CertificateContext | null>(null);
  const [hasStamp, setHasStamp] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const [mode, setMode] = useState<CertificateMode>('PRINT');
  /** The PDF on screen, and the next one loading behind it. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  /** Blob URLs still alive, so a superseded preview (or leaving) frees them. */
  const shownRef = useRef<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  /* ── Load ── */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(base, { credentials: 'include' });
        if (!res.ok) throw new Error(await errorMessage(res, t('loadFailed')));
        const data = await res.json() as {
          settings: CertificateSettings; saved: boolean; context: CertificateContext; hasStamp: boolean;
        };
        if (cancelled) return;
        setSettings(data.settings);
        setContext(data.context);
        setHasStamp(data.hasStamp);
        setSaved(data.saved);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t('loadFailed'));
      }
    })();
    return () => { cancelled = true; };
  }, [base, t]);

  const update = useCallback((patch: Partial<CertificateSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setJustSaved(false);
  }, []);

  /* ── Live preview, a moment after the last change ── */
  useEffect(() => {
    if (!settings) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const res = await fetch(`${base}/preview`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings, mode }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await errorMessage(res, t('previewFailed')));
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        // A newer preview supersedes one that never finished loading.
        if (pendingRef.current) URL.revokeObjectURL(pendingRef.current);
        pendingRef.current = url;
        setPendingUrl(url);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setPreviewError(err instanceof Error ? err.message : t('previewFailed'));
        }
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }, 650);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [settings, mode, base, t]);

  // Release the last preview's memory when the editor goes away.
  useEffect(() => () => {
    if (shownRef.current) URL.revokeObjectURL(shownRef.current);
    if (pendingRef.current) URL.revokeObjectURL(pendingRef.current);
  }, []);

  /**
   * The next PDF loads in a hidden frame and replaces the visible one only
   * once it has loaded — reloading the visible frame instead would flash the
   * viewer's empty background on every edit. The short pause lets the viewer
   * draw the page after its document loads.
   */
  const promotePending = useCallback((url: string) => {
    setTimeout(() => {
      if (pendingRef.current !== url) return;
      if (shownRef.current) URL.revokeObjectURL(shownRef.current);
      shownRef.current = url;
      pendingRef.current = null;
      setPreviewUrl(url);
      setPendingUrl(null);
    }, 300);
  }, []);

  /* ── Save ── */
  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(base, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, t('saveFailed')));
      setSaved(true);
      setDirty(false);
      setJustSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  /* ── Variables that would print empty ── */
  const emptyVars = useMemo(() => {
    if (!settings || !context) return [];
    return emptyVariablesIn(settings.body, certificateVariables(settings, context));
  }, [settings, context]);

  function insertVariable(v: string) {
    if (!settings) return;
    const el = bodyRef.current;
    const at = el?.selectionStart ?? settings.body.length;
    const end = el?.selectionEnd ?? at;
    const next = settings.body.slice(0, at) + v + settings.body.slice(end);
    update({ body: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + v.length, at + v.length);
    });
  }

  /* ── Signatories ── */
  function setSignatory(index: number, patch: Partial<CertificateSignatory>) {
    if (!settings) return;
    const next = settings.signatories.map((s, i) => (i === index ? { ...s, ...patch } : s));
    update({ signatories: next });
  }

  function setSignatoryCount(count: 1 | 2) {
    if (!settings) return;
    const current = settings.signatories;
    const next = count === 1
      ? current.slice(0, 1)
      : [...current.slice(0, 1), current[1] ?? { name: '', role: t('defaultSecondRole'), imageUrl: null }];
    update({ signatories: next });
  }

  const uploadImage = useCallback(async (blob: Blob, filename: string): Promise<string> => {
    const form = new FormData();
    form.append('file', new File([blob], filename, { type: blob.type || 'image/png' }));
    if (uploadKind) form.append('kind', uploadKind);
    const res = await fetch(uploadEndpoint, { method: 'POST', credentials: 'include', body: form });
    if (!res.ok) throw new Error(await errorMessage(res, t('uploadFailed')));
    const data = await res.json() as { url: string };
    return data.url;
  }, [uploadEndpoint, uploadKind, t]);

  /* ── Render ── */
  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {loadError}
      </div>
    );
  }
  if (!settings || !context) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
      {/* ═══════ Preview — first on a phone, right-hand on a desktop ═══════ */}
      <div className="order-first space-y-3 lg:sticky lg:top-6 lg:order-last">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1" role="group" aria-label={t('previewMode')}>
            {(['PRINT', 'DIGITAL'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'min-h-8 rounded-md px-3 text-sm font-medium transition-colors',
                  mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'PRINT' ? t('modePrint') : t('modeDigital')}
              </button>
            ))}
          </div>
          {previewLoading && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {t('previewUpdating')}
            </span>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {mode === 'PRINT' ? t('modePrintHint') : t('modeDigitalHint')}
        </p>

        <div className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
          {previewUrl ? (
            <iframe
              key={previewUrl}
              title={t('previewTitle')}
              src={`${previewUrl}#toolbar=0&navpanes=0&view=Fit`}
              className="block aspect-[297/210] w-full bg-white"
            />
          ) : (
            <div className="flex aspect-[297/210] items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          {pendingUrl && (
            <iframe
              key={pendingUrl}
              title={t('previewTitle')}
              aria-hidden
              tabIndex={-1}
              src={`${pendingUrl}#toolbar=0&navpanes=0&view=Fit`}
              onLoad={() => promotePending(pendingUrl)}
              className="pointer-events-none absolute inset-0 block h-full w-full opacity-0"
            />
          )}
        </div>
        {previewUrl && (
          // Some browsers (Android Chrome) will not draw a PDF inside a frame;
          // opening it on its own always works — and is the full-size view.
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" /> {t('openPreview')}
          </a>
        )}
        {previewError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {previewError}
          </p>
        )}
      </div>

      {/* ═══════ Settings ═══════ */}
      <div className="space-y-6">
        {/* Template */}
        <section className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sectionTemplate')}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
            {TEMPLATES.map(({ id, labelKey }) => (
              <button
                key={id}
                type="button"
                aria-pressed={settings.template === id}
                onClick={() => update({ template: id })}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-start text-sm font-medium transition-colors',
                  settings.template === id
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-foreground hover:border-primary/40',
                )}
              >
                <TemplateGlyph id={id} />
                {t(labelKey)}
              </button>
            ))}
          </div>
        </section>

        {/* Font + size */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cert-font">{t('labelFont')}</Label>
            <select
              id="cert-font"
              value={settings.font}
              onChange={(e) => update({ font: e.target.value as CertificateFont })}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm"
            >
              {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <span className="text-sm font-medium">{t('labelSize')}</span>
            <div className="mt-1 grid grid-cols-2 gap-2" role="group" aria-label={t('labelSize')}>
              {(['A5', 'A4'] as const).map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={settings.pageSize === size}
                  onClick={() => update({ pageSize: size })}
                  className={cn(
                    'h-10 rounded-md border text-sm font-medium transition-colors',
                    settings.pageSize === size ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40',
                  )}
                >
                  {size === 'A5' ? t('sizeA5') : t('sizeA4')}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Colors */}
        <section className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sectionColors')}</h3>
          <div className="flex flex-wrap gap-2">
            {PALETTES.map((p) => {
              const on = settings.primaryColor.toLowerCase() === p.primary && settings.darkColor.toLowerCase() === p.dark;
              return (
                <button
                  key={p.labelKey}
                  type="button"
                  aria-pressed={on}
                  title={t(p.labelKey)}
                  aria-label={t(p.labelKey)}
                  onClick={() => update({ primaryColor: p.primary, darkColor: p.dark })}
                  className={cn('size-9 rounded-full border-2 border-background ring-1 transition', on ? 'ring-2 ring-foreground' : 'ring-border')}
                  style={{ background: `linear-gradient(135deg, ${p.primary} 50%, ${p.dark} 50%)` }}
                />
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm" htmlFor="cert-primary">
              <input
                id="cert-primary"
                type="color"
                value={settings.primaryColor}
                onChange={(e) => update({ primaryColor: e.target.value })}
                className="size-9 cursor-pointer rounded border border-border bg-background p-0.5"
              />
              {t('colorPrimary')}
            </label>
            <label className="flex items-center gap-2 text-sm" htmlFor="cert-dark">
              <input
                id="cert-dark"
                type="color"
                value={settings.darkColor}
                onChange={(e) => update({ darkColor: e.target.value })}
                className="size-9 cursor-pointer rounded border border-border bg-background p-0.5"
              />
              {t('colorDark')}
            </label>
          </div>
        </section>

        {/* Wording */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sectionText')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cert-title">{t('labelTitle')}</Label>
              <Input id="cert-title" className="mt-1" maxLength={40} value={settings.title}
                onChange={(e) => update({ title: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="cert-subtitle">{t('labelSubtitle')}</Label>
              <Input id="cert-subtitle" className="mt-1" maxLength={40} value={settings.subtitle}
                onChange={(e) => update({ subtitle: e.target.value })} />
            </div>
          </div>
          <div>
            <Label htmlFor="cert-intro">{t('labelIntro')}</Label>
            <Input id="cert-intro" className="mt-1" maxLength={120} value={settings.intro}
              onChange={(e) => update({ intro: e.target.value })} />
          </div>
          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {t('nameHint')}
          </p>
          <div>
            <Label htmlFor="cert-body">{t('labelBody')}</Label>
            <textarea
              id="cert-body"
              ref={bodyRef}
              rows={5}
              maxLength={900}
              value={settings.body}
              onChange={(e) => update({ body: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-base leading-relaxed sm:text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label={t('insertVariable')}>
              {CERTIFICATE_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="rounded-md bg-primary/10 px-2 py-1 font-mono text-xs text-primary transition-colors hover:bg-primary/15"
                >
                  {v}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('bodySyntaxHint')}</p>
            {emptyVars.length > 0 && (
              <p className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {t('emptyVariables', { list: emptyVars.join(', ') })}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cert-trainer">{t('labelTrainer')}</Label>
              <Input id="cert-trainer" className="mt-1" maxLength={120} value={settings.trainerName ?? ''}
                placeholder={t('trainerPlaceholder')}
                onChange={(e) => update({ trainerName: e.target.value || null })} />
            </div>
            <div>
              <Label htmlFor="cert-hours">{t('labelHours')}</Label>
              <Input id="cert-hours" className="mt-1" maxLength={40} value={settings.hours ?? ''}
                placeholder={t('hoursPlaceholder')}
                onChange={(e) => update({ hours: e.target.value || null })} />
            </div>
          </div>
        </section>

        {/* Signatures */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sectionSignatures')}</h3>
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="group" aria-label={t('signatoryCount')}>
              {([1, 2] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={settings.signatories.length === n}
                  onClick={() => setSignatoryCount(n)}
                  className={cn(
                    'min-h-8 rounded-md px-3 text-sm font-medium',
                    settings.signatories.length === n ? 'bg-background shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {n === 1 ? t('oneSignature') : t('twoSignatures')}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('signaturesHint')}</p>
          {settings.signatories.map((sig, i) => (
            <SignatoryCard
              key={i}
              index={i}
              signatory={sig}
              onChange={(patch) => setSignatory(i, patch)}
              upload={uploadImage}
            />
          ))}
        </section>

        {/* Options */}
        <section className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sectionOptions')}</h3>
          <label className={cn('flex items-start gap-2.5 text-sm', !hasStamp && 'opacity-60')} htmlFor="cert-stamp">
            <input
              id="cert-stamp"
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={hasStamp && settings.showStamp}
              disabled={!hasStamp}
              onChange={(e) => update({ showStamp: e.target.checked })}
            />
            <span>
              <span className="font-medium">{t('labelStamp')}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {hasStamp ? t('stampHint') : t('stampMissing')}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm" htmlFor="cert-verify">
            <input
              id="cert-verify"
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={settings.showVerification}
              onChange={(e) => update({ showVerification: e.target.checked })}
            />
            <span>
              <span className="font-medium">{t('labelVerification')}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t('verificationHint')}</span>
            </span>
          </label>
        </section>

        {/* Save */}
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
          <Button onClick={() => void save()} loading={saving} disabled={!dirty && saved}>
            {t('save')}
          </Button>
          <span className="text-xs text-muted-foreground">
            {justSaved ? (
              <span className="inline-flex items-center gap-1 text-primary"><Check className="size-3.5" /> {t('saved')}</span>
            ) : dirty || !saved ? t('unsaved') : t('upToDate')}
          </span>
          {saveError && <p className="w-full text-xs text-destructive">{saveError}</p>}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── One signatory ─────────────────── */

/**
 * The pad hands back a data: URL. Decoded here rather than with
 * `fetch(dataUrl)`, which the Content-Security-Policy's connect-src refuses.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head = '', data = ''] = dataUrl.split(',', 2);
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? 'image/png';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function SignatoryCard({
  index,
  signatory,
  onChange,
  upload,
}: {
  index: number;
  signatory: CertificateSignatory;
  onChange: (patch: Partial<CertificateSignatory>) => void;
  upload: (blob: Blob, filename: string) => Promise<string>;
}) {
  const t = useTranslations('certificates');
  const padRef = useRef<SignaturePadHandle | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveDrawing() {
    const dataUrl = padRef.current?.toDataUrl();
    if (!dataUrl) return;
    setBusy(true);
    setError(null);
    try {
      const blob = dataUrlToBlob(dataUrl);
      onChange({ imageUrl: await upload(blob, `signature-${index + 1}.png`) });
      setDrawing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange({ imageUrl: await upload(file, file.name) });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('uploadFailed'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3.5">
      <p className="text-sm font-semibold">{t('signatoryN', { n: index + 1 })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`cert-sig-role-${index}`}>{t('labelRole')}</Label>
          <Input id={`cert-sig-role-${index}`} className="mt-1" maxLength={60} value={signatory.role}
            placeholder={t('rolePlaceholder')}
            onChange={(e) => onChange({ role: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`cert-sig-name-${index}`}>{t('labelSignatoryName')}</Label>
          <Input id={`cert-sig-name-${index}`} className="mt-1" maxLength={80} value={signatory.name}
            placeholder={t('signatoryNamePlaceholder')}
            onChange={(e) => onChange({ name: e.target.value })} />
        </div>
      </div>

      {drawing ? (
        <div className="space-y-2">
          <SignaturePad ref={padRef} height={140} onChange={setHasInk} note={null} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void saveDrawing()} loading={busy} disabled={!hasInk}>{t('useDrawing')}</Button>
            <Button size="sm" variant="outline" onClick={() => setDrawing(false)} disabled={busy}>{t('cancel')}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {signatory.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a user upload on Cloudinary, shown as-is
            <img src={signatory.imageUrl} alt={t('signatureImageAlt')} className="h-12 max-w-[140px] rounded border border-border bg-white object-contain p-1" />
          ) : (
            <span className="text-xs text-muted-foreground">{t('noSignatureImage')}</span>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDrawing(true)} disabled={busy}>
            <PenLine className="size-3.5" /> {t('draw')}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()} loading={busy}>
            <Upload className="size-3.5" /> {t('import')}
          </Button>
          {signatory.imageUrl && (
            <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-destructive"
              onClick={() => onChange({ imageUrl: null })} disabled={busy}>
              <Trash2 className="size-3.5" /> {t('removeImage')}
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
