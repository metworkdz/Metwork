'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type LegalStatus = 'AUTO_ENTREPRENEUR' | 'REGISTRE_COMMERCE';
type RcType = 'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE';
type Template = 'CLASSIC' | 'GREEN_BAND' | 'MINIMAL';

interface Settings {
  invoiceLegalStatus?: LegalStatus | null;
  invoiceRcType?: RcType | null;
  invoiceRegNumber?: string | null;
  nif?: string | null;
  nis?: string | null;
  ai?: string | null;
  address?: string | null;
  bankName?: string | null;
  bankRib?: string | null;
  invoiceTemplate?: Template | null;
  defaultVatRate?: number | null;
  invoiceLogoUrl?: string | null;
  invoiceStampUrl?: string | null;
}

interface Payload {
  settings: Settings;
  issuer: { address: string | null; defaultVatRate: number };
  complete: boolean;
}

/** The freelancer letterhead — what makes their invoices legally valid. */
export function FreelancerInvoiceSettingsForm() {
  const t = useTranslations('freelancer.invoices.settings');
  const [s, setS] = useState<Settings | null>(null);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState(false);
  const [saving, startSaving] = useTransition();
  const [result, setResult] = useState<'saved' | 'error' | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/freelancer/invoices/settings', { cache: 'no-store' });
      if (!res.ok) { setError(true); return; }
      const body = (await res.json()) as Payload;
      setS({ ...body.settings, address: body.settings.address ?? body.issuer.address, defaultVatRate: body.issuer.defaultVatRate });
      setComplete(body.complete);
    })();
  }, []);

  if (error) return <p role="alert" className="text-sm text-destructive">{t('loadError')}</p>;
  if (!s) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x!, [k]: v }));
  const isRc = s.invoiceLegalStatus === 'REGISTRE_COMMERCE';

  function save() {
    setResult(null);
    startSaving(async () => {
      const res = await fetch('/api/freelancer/invoices/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...s, invoiceRcType: isRc ? s!.invoiceRcType ?? null : null, ai: isRc ? s!.ai ?? null : null }),
      });
      if (!res.ok) { setResult('error'); return; }
      const body = (await res.json()) as Payload;
      setComplete(body.complete);
      setResult('saved');
    });
  }

  return (
    <div className="space-y-6">
      <div className={cn('rounded-md border p-3 text-sm', complete ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200')}>
        {complete ? t('complete') : t('incomplete')}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('legalTitle')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('status')}>
            {(['AUTO_ENTREPRENEUR', 'REGISTRE_COMMERCE'] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={s.invoiceLegalStatus === v} onClick={() => set('invoiceLegalStatus', v)}
                className={cn('min-h-[44px] rounded-lg border-2 px-3 py-2 text-start text-sm', s.invoiceLegalStatus === v ? 'border-primary bg-primary-50/60 dark:bg-primary/10' : 'border-border hover:bg-muted/50')}>
                {t(`statusOption.${v}`)}
              </button>
            ))}
          </div>
          {isRc && (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('rcType')}>
              {(['PERSONNE_PHYSIQUE', 'PERSONNE_MORALE'] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={s.invoiceRcType === v} onClick={() => set('invoiceRcType', v)}
                  className={cn('min-h-[44px] rounded-lg border-2 px-3 py-2 text-start text-sm', s.invoiceRcType === v ? 'border-primary bg-primary-50/60 dark:bg-primary/10' : 'border-border hover:bg-muted/50')}>
                  {t(`rcOption.${v}`)}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Text id="is-reg" label={isRc ? t('regRc') : t('regAe')} value={s.invoiceRegNumber} onChange={(v) => set('invoiceRegNumber', v)} />
            <Text id="is-nif" label="NIF" value={s.nif} onChange={(v) => set('nif', v)} />
            <Text id="is-nis" label="NIS" value={s.nis} onChange={(v) => set('nis', v)} />
            {isRc && <Text id="is-ai" label={t('ai')} value={s.ai} onChange={(v) => set('ai', v)} />}
          </div>
          <Text id="is-address" label={t('address')} value={s.address} onChange={(v) => set('address', v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('bankTitle')}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Text id="is-bank" label={t('bankName')} value={s.bankName} onChange={(v) => set('bankName', v)} />
          <Text id="is-rib" label={t('rib')} value={s.bankRib} onChange={(v) => set('bankRib', v.replace(/[^\d\s]/g, ''))} ltr numeric />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('lookTitle')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('template')}>
            {(['CLASSIC', 'GREEN_BAND', 'MINIMAL'] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={(s.invoiceTemplate ?? 'CLASSIC') === v} onClick={() => set('invoiceTemplate', v)}
                className={cn('min-h-[44px] rounded-lg border-2 px-3 py-2 text-sm', (s.invoiceTemplate ?? 'CLASSIC') === v ? 'border-primary bg-primary-50/60 dark:bg-primary/10' : 'border-border hover:bg-muted/50')}>
                {t(`templateOption.${v}`)}
              </button>
            ))}
          </div>
          <div className="max-w-[12rem]">
            <Text id="is-vat" label={t('vat')} value={s.defaultVatRate == null ? '' : String(s.defaultVatRate)} onChange={(v) => set('defaultVatRate', v === '' ? null : Math.min(100, Number(v.replace(/\D/g, ''))))} ltr numeric />
            <p className="mt-1 text-xs text-muted-foreground">{t('vatHint')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ImageField label={t('logo')} url={s.invoiceLogoUrl ?? null} onChange={(u) => set('invoiceLogoUrl', u)} />
            <ImageField label={t('stamp')} url={s.invoiceStampUrl ?? null} onChange={(u) => set('invoiceStampUrl', u)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" loading={saving} onClick={save}>{t('save')}</Button>
        {result === 'saved' && <span className="text-sm text-emerald-600">{t('saved')}</span>}
        {result === 'error' && <span role="alert" className="text-sm text-destructive">{t('saveError')}</span>}
      </div>
    </div>
  );
}

function Text({ id, label, value, onChange, ltr, numeric }: { id: string; label: string; value: string | null | undefined; onChange: (v: string) => void; ltr?: boolean; numeric?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <Input id={id} className="mt-1.5 text-base sm:text-sm" dir={ltr ? 'ltr' : undefined} inputMode={numeric ? 'numeric' : undefined} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ImageField({ label, url, onChange }: { label: string; url: string | null; onChange: (url: string | null) => void }) {
  const t = useTranslations('freelancer.invoices.settings');
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('folder', 'letterheads');
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (res.ok) onChange(((await res.json()) as { url: string }).url);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="h-16 w-auto rounded border bg-white object-contain p-1" />
      )}
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" loading={busy} onClick={() => ref.current?.click()}><ImagePlus className="size-4" />{url ? t('replaceImage') : t('addImage')}</Button>
        {url && <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>{t('removeImage')}</Button>}
      </div>
    </div>
  );
}
