'use client';

/**
 * Landing-page CMS editor.
 *
 * Sections: Hero · Stats · Features · Roles · CTA
 * Single "Publish" button PUTs the full document to /api/cms/landing.
 * The form mirrors the landing page layout so what-you-type = what-you-see.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LandingContent, FeatureItem, RoleItem } from '@/types/cms';

/* ─────────────────────────── Types ─────────────────────────── */

type TabKey = 'hero' | 'stats' | 'features' | 'roles' | 'cta';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/* ─────────────────────────── Main component ─────────────────────────── */

export function CmsEditor({ initial }: { initial: LandingContent }) {
  const t = useTranslations('admin.cmsEditor');
  const [content, setContent] = useState<LandingContent>(initial);
  const [activeTab, setActiveTab] = useState<TabKey>('hero');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'hero',     label: t('tabHero') },
    { key: 'stats',    label: t('tabStats') },
    { key: 'features', label: t('tabFeatures') },
    { key: 'roles',    label: t('tabRoles') },
    { key: 'cta',      label: t('tabCta') },
  ];

  /* Generic section updater */
  function setSection<K extends keyof LandingContent>(
    section: K,
    value: LandingContent[K],
  ) {
    setContent((prev) => ({ ...prev, [section]: value }));
    if (saveState === 'saved') setSaveState('idle');
  }

  async function handlePublish() {
    setSaveState('saving');
    setSaveError(null);
    try {
      const { updatedAt: _ignored, ...body } = content;
      const res = await fetch('/api/cms/landing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setSaveError(data.error?.message ?? t('saveFailedError'));
        setSaveState('error');
        return;
      }
      const saved = await res.json() as LandingContent;
      setContent(saved);
      setSaveState('saved');
      // Reset to idle after 3 s
      setTimeout(() => setSaveState('idle'), 3000);
    } catch {
      setSaveError(t('networkError'));
      setSaveState('error');
    }
  }

  const updatedLabel =
    content.updatedAt && content.updatedAt !== new Date(0).toISOString()
      ? t('lastSaved', { date: new Date(content.updatedAt).toLocaleString() })
      : t('usingDefaults');

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">{updatedLabel}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/" target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              {t('preview')}
            </a>
          </Button>
          <Button
            size="sm"
            loading={saveState === 'saving'}
            onClick={handlePublish}
            className={cn(
              saveState === 'saved' && 'bg-emerald-600 hover:bg-emerald-700',
            )}
          >
            <Save className="size-3.5" />
            {saveState === 'saved' ? t('published') : t('publishChanges')}
          </Button>
        </div>
      </div>

      {saveError && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {saveError}
        </p>
      )}

      {/* Tab nav */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border/60 bg-muted/20 p-1 scrollbar-none">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === 'hero'     && <HeroPanel     hero={content.hero}         onChange={(v) => setSection('hero', v)} />}
      {activeTab === 'stats'    && <StatsPanel    stats={content.stats}       onChange={(v) => setSection('stats', v)} />}
      {activeTab === 'features' && <FeaturesPanel features={content.features} onChange={(v) => setSection('features', v)} />}
      {activeTab === 'roles'    && <RolesPanel    roles={content.roles}       onChange={(v) => setSection('roles', v)} />}
      {activeTab === 'cta'      && <CtaPanel      cta={content.cta}           onChange={(v) => setSection('cta', v)} />}
    </div>
  );
}

/* ─────────────────────────── Helpers ─────────────────────────── */

function FieldGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2', className)}>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
  hint,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  hint?: string;
  maxLength?: number;
}) {
  const id = label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {maxLength && (
          <span
            className={cn(
              'text-xs tabular-nums',
              value.length > maxLength * 0.9
                ? 'text-destructive'
                : 'text-muted-foreground',
            )}
          >
            {value.length}/{maxLength}
          </span>
        )}
      </div>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          maxLength={maxLength}
          className={cn(
            'flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
      ) : (
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
        />
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-5">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </p>
        <div className="space-y-4">{children}</div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Hero panel ─────────────────────────── */

function HeroPanel({
  hero,
  onChange,
}: {
  hero: LandingContent['hero'];
  onChange: (v: LandingContent['hero']) => void;
}) {
  const t = useTranslations('admin.cmsEditor');

  function set<K extends keyof typeof hero>(key: K, value: string) {
    onChange({ ...hero, [key]: value });
  }

  return (
    <div className="space-y-4">
      <SectionCard title={t('heroBadgeHeadline')}>
        <Field label={t('heroBadgeText')}  value={hero.badge}    onChange={(v) => set('badge', v)}    maxLength={80} />
        <Field label={t('heroTitle')}      value={hero.title}    onChange={(v) => set('title', v)}    maxLength={120} />
        <Field label={t('heroSubtitle')}   value={hero.subtitle} onChange={(v) => set('subtitle', v)} maxLength={400} multiline />
      </SectionCard>
      <SectionCard title={t('heroCtaButtons')}>
        <FieldGroup>
          <Field label={t('heroPrimaryCta')}   value={hero.ctaPrimary}   onChange={(v) => set('ctaPrimary', v)}   maxLength={60} />
          <Field label={t('heroSecondaryCta')} value={hero.ctaSecondary} onChange={(v) => set('ctaSecondary', v)} maxLength={60} />
        </FieldGroup>
      </SectionCard>
    </div>
  );
}

/* ─────────────────────────── Stats panel ─────────────────────────── */

function StatsPanel({
  stats,
  onChange,
}: {
  stats: LandingContent['stats'];
  onChange: (v: LandingContent['stats']) => void;
}) {
  const t = useTranslations('admin.cmsEditor');
  type StatKey = keyof LandingContent['stats'];

  function setItem(key: StatKey, field: 'value' | 'label', v: string) {
    onChange({ ...stats, [key]: { ...stats[key], [field]: v } });
  }

  const keys: StatKey[] = ['founders', 'investors', 'incubators', 'cities'];

  return (
    <div className="space-y-3">
      {keys.map((key) => (
        <SectionCard key={key} title={key.charAt(0).toUpperCase() + key.slice(1)}>
          <FieldGroup>
            <Field
              label={t('statsValue')}
              value={stats[key].value}
              onChange={(v) => setItem(key, 'value', v)}
              maxLength={20}
            />
            <Field
              label={t('statsLabel')}
              value={stats[key].label}
              onChange={(v) => setItem(key, 'label', v)}
              maxLength={60}
            />
          </FieldGroup>
        </SectionCard>
      ))}
    </div>
  );
}

/* ─────────────────────────── Features panel ─────────────────────────── */

function FeaturesPanel({
  features,
  onChange,
}: {
  features: LandingContent['features'];
  onChange: (v: LandingContent['features']) => void;
}) {
  const t = useTranslations('admin.cmsEditor');

  function setItem(idx: number, patch: Partial<FeatureItem>) {
    const items = features.items.map((item, i) =>
      i === idx ? { ...item, ...patch } : item,
    );
    onChange({ ...features, items });
  }

  return (
    <div className="space-y-4">
      <SectionCard title={t('sectionHeader')}>
        <Field label={t('sectionTitle')}    value={features.title}    onChange={(v) => onChange({ ...features, title: v })}    maxLength={120} />
        <Field label={t('sectionSubtitle')} value={features.subtitle} onChange={(v) => onChange({ ...features, subtitle: v })} maxLength={200} multiline />
      </SectionCard>

      {features.items.map((item, idx) => (
        <SectionCard key={item.key} title={`${t('featurePrefix')} — ${item.key}`}>
          <Field
            label={t('itemTitle')}
            value={item.title}
            onChange={(v) => setItem(idx, { title: v })}
            maxLength={100}
          />
          <Field
            label={t('itemDescription')}
            value={item.description}
            onChange={(v) => setItem(idx, { description: v })}
            maxLength={300}
            multiline
          />
        </SectionCard>
      ))}
    </div>
  );
}

/* ─────────────────────────── Roles panel ─────────────────────────── */

function RolesPanel({
  roles,
  onChange,
}: {
  roles: LandingContent['roles'];
  onChange: (v: LandingContent['roles']) => void;
}) {
  const t = useTranslations('admin.cmsEditor');

  function setItem(idx: number, patch: Partial<RoleItem>) {
    const items = roles.items.map((item, i) =>
      i === idx ? { ...item, ...patch } : item,
    );
    onChange({ ...roles, items });
  }

  return (
    <div className="space-y-4">
      <SectionCard title={t('sectionHeader')}>
        <Field
          label={t('sectionTitle')}
          value={roles.title}
          onChange={(v) => onChange({ ...roles, title: v })}
          maxLength={120}
        />
      </SectionCard>

      {roles.items.map((item, idx) => (
        <SectionCard key={item.key} title={`${t('rolePrefix')} — ${item.key}`}>
          <Field
            label={t('itemTitle')}
            value={item.title}
            onChange={(v) => setItem(idx, { title: v })}
            maxLength={100}
          />
          <Field
            label={t('itemDescription')}
            value={item.description}
            onChange={(v) => setItem(idx, { description: v })}
            maxLength={300}
            multiline
          />
        </SectionCard>
      ))}
    </div>
  );
}

/* ─────────────────────────── CTA panel ─────────────────────────── */

function CtaPanel({
  cta,
  onChange,
}: {
  cta: LandingContent['cta'];
  onChange: (v: LandingContent['cta']) => void;
}) {
  const t = useTranslations('admin.cmsEditor');

  function set<K extends keyof typeof cta>(key: K, value: string) {
    onChange({ ...cta, [key]: value });
  }

  return (
    <SectionCard title={t('ctaBanner')}>
      <Field label={t('ctaTitle')}      value={cta.title}    onChange={(v) => set('title', v)}    maxLength={160} />
      <Field label={t('ctaSubtitle')}   value={cta.subtitle} onChange={(v) => set('subtitle', v)} maxLength={300} multiline />
      <Field label={t('ctaButtonText')} value={cta.button}   onChange={(v) => set('button', v)}   maxLength={60} />
    </SectionCard>
  );
}
