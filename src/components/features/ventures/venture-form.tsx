'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, FileBadge, Lightbulb, Rocket, Users, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link, useRouter } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { algerianCities, getCityName } from '@/config/cities';
import {
  VENTURE_KINDS, VENTURE_NEEDS, VENTURE_STAGES, defaultLegalStatusFor, type VentureKind,
} from '@/lib/venture-options';
import { COMPANY_FORMS, LEGAL_STATUSES, type CompanyForm, type LegalStatus } from '@/types/legal-status';
import type { Locale } from '@/i18n/config';

const KIND_ICONS: Record<VentureKind, typeof Rocket> = {
  STARTUP: Rocket, COMPANY: Building2, AUTO_ENTREPRENEUR: FileBadge, PROJECT: Lightbulb, ASSOCIATION: Users,
};

export interface VentureFormValues {
  name: string;
  kind: VentureKind;
  legal: { status: LegalStatus; companyForm?: CompanyForm | null; hasStartupLabel?: boolean };
  stage: (typeof VENTURE_STAGES)[number];
  sector: string;
  wilaya: string;
  description: string;
  website: string | null;
  lookingFor: (typeof VENTURE_NEEDS)[number][];
  isPublic: boolean;
}

interface Props {
  initial: VentureFormValues;
  exists: boolean;
  slug: string | null;
  canPublish: boolean;
}

export function VentureForm({ initial, exists, slug, canPublish }: Props) {
  const t = useTranslations('venture');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [v, setV] = useState<VentureFormValues>(initial);
  const [saving, startSaving] = useTransition();
  const [result, setResult] = useState<'saved' | 'error' | 'founder' | null>(null);
  const [savedSlug, setSavedSlug] = useState(slug);
  const set = <K extends keyof VentureFormValues>(k: K, val: VentureFormValues[K]) => setV((x) => ({ ...x, [k]: val }));

  function chooseKind(kind: VentureKind) {
    setV((x) => ({ ...x, kind, legal: { ...x.legal, status: defaultLegalStatusFor(kind) } }));
  }

  function save() {
    setResult(null);
    startSaving(async () => {
      const res = await fetch('/api/ventures/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...v, website: v.website?.trim() || null }),
      });
      if (!res.ok) {
        const err = ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error;
        setResult(err?.code === 'PUBLIC_PAGE_REQUIRES_FOUNDER' ? 'founder' : 'error');
        return;
      }
      const body = (await res.json()) as { venture: { slug: string } };
      setSavedSlug(body.venture.slug);
      setResult('saved');
      router.refresh();
    });
  }

  const valid = v.name.trim().length >= 2 && v.sector.trim().length >= 2 && !!v.wilaya;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">{t('kindTitle')}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label={t('kindTitle')}>
            {VENTURE_KINDS.map((k) => {
              const Icon = KIND_ICONS[k];
              const on = v.kind === k;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} onClick={() => chooseKind(k)}
                  className={cn('flex min-h-[64px] items-start gap-3 rounded-lg border-2 p-3 text-start transition-colors', on ? 'border-primary bg-primary-50/60 dark:bg-primary/10' : 'border-border hover:bg-muted/50')}>
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md', on ? 'bg-primary-100 text-primary-700' : 'bg-muted text-muted-foreground')}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{t(`kind.${k}`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`kindDesc.${k}`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('detailsTitle')}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <Labeled id="v-name" label={t('name')}>
            <Input id="v-name" value={v.name} maxLength={80} onChange={(e) => set('name', e.target.value)} className="text-base sm:text-sm" />
          </Labeled>
          <div className="grid gap-5 sm:grid-cols-2">
            <Labeled id="v-sector" label={t('sector')}>
              <Input id="v-sector" value={v.sector} maxLength={60} placeholder={t('sectorPlaceholder')} onChange={(e) => set('sector', e.target.value)} className="text-base sm:text-sm" />
            </Labeled>
            <Labeled id="v-wilaya" label={t('wilaya')}>
              <Select value={v.wilaya} onValueChange={(w) => set('wilaya', w)}>
                <SelectTrigger id="v-wilaya"><SelectValue placeholder={t('wilayaPlaceholder')} /></SelectTrigger>
                <SelectContent>
                  {algerianCities.map((c) => <SelectItem key={c.code} value={c.code}>{getCityName(c.code, locale)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Labeled>
          </div>
          <fieldset>
            <legend className="text-sm font-medium">{t('stage')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {VENTURE_STAGES.map((s) => (
                <Chip key={s} on={v.stage === s} onClick={() => set('stage', s)}>{t(`stages.${s}`)}</Chip>
              ))}
            </div>
          </fieldset>
          <Labeled id="v-desc" label={t('description')}>
            <Textarea id="v-desc" rows={4} maxLength={1500} value={v.description} onChange={(e) => set('description', e.target.value)} className="text-base sm:text-sm" />
          </Labeled>
          <Labeled id="v-web" label={t('website')}>
            <Input id="v-web" dir="ltr" inputMode="url" placeholder="https://" value={v.website ?? ''} onChange={(e) => set('website', e.target.value)} className="text-base sm:text-sm" />
          </Labeled>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('legalTitle')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Labeled id="v-legal" label={t('legalStatus')}>
            <Select value={v.legal.status} onValueChange={(s) => set('legal', { ...v.legal, status: s as LegalStatus })}>
              <SelectTrigger id="v-legal"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEGAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`legal.${s}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Labeled>
          {v.legal.status === 'COMPANY' && (
            <Labeled id="v-form" label={t('companyForm')}>
              <Select value={v.legal.companyForm ?? ''} onValueChange={(f) => set('legal', { ...v.legal, companyForm: f as CompanyForm })}>
                <SelectTrigger id="v-form"><SelectValue placeholder={t('companyFormPlaceholder')} /></SelectTrigger>
                <SelectContent>
                  {COMPANY_FORMS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </Labeled>
          )}
          {(v.kind === 'STARTUP' || v.kind === 'COMPANY') && (
            <label className="flex min-h-[40px] cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 rounded border-input" checked={!!v.legal.hasStartupLabel}
                onChange={(e) => set('legal', { ...v.legal, hasStartupLabel: e.target.checked })} />
              {t('startupLabel')}
            </label>
          )}
          <p className="text-xs text-muted-foreground">{t('legalHint')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('needsTitle')}</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">{t('needsHint')}</p>
          <div className="flex flex-wrap gap-2">
            {VENTURE_NEEDS.map((n) => {
              const on = v.lookingFor.includes(n);
              return (
                <Chip key={n} on={on} onClick={() => set('lookingFor', on ? v.lookingFor.filter((x) => x !== n) : [...v.lookingFor, n])}>
                  {t(`needs.${n}`)}
                </Chip>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('publicTitle')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {canPublish ? (
            <label className="flex min-h-[40px] cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 rounded border-input" checked={v.isPublic} onChange={(e) => set('isPublic', e.target.checked)} />
              {t('publicToggle')}
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('publicFounderOnly')}{' '}
              <Link href="/dashboard/entrepreneur/membership" className="font-medium text-primary hover:underline">{t('publicUpgrade')}</Link>
            </p>
          )}
          {exists && v.isPublic && savedSlug && canPublish && (
            <Link href={`/ventures/${savedSlug}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <ExternalLink className="size-4" /> {t('publicView')}
            </Link>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" loading={saving} disabled={!valid} onClick={save}>{exists ? t('save') : t('create')}</Button>
        {result === 'saved' && <span className="text-sm text-emerald-600">{t('saved')}</span>}
        {result === 'error' && <span role="alert" className="text-sm text-destructive">{t('saveError')}</span>}
        {result === 'founder' && <span role="alert" className="text-sm text-destructive">{t('publicFounderOnly')}</span>}
      </div>
    </div>
  );
}

function Labeled({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('min-h-[40px] rounded-full border px-4 text-sm transition-colors', on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}>
      {children}
    </button>
  );
}
