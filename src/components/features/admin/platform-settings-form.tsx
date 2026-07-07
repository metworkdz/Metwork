'use client';

/**
 * Admin: platform settings form.
 * App name, maintenance mode, feature toggles.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { LANDING_SECTIONS, type LandingSection } from '@/config/landing-sections';
import type { PlatformSettingsRecord } from '@/server/db/store';

interface ToggleRowProps {
  label:       string;
  description: string;
  checked:     boolean;
  onChange:    (v: boolean) => void;
  disabled?:   boolean;
}

function ToggleRow({ label, description, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
          'transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-input',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block size-5 rounded-full bg-background shadow-lg ring-0',
            'transition duration-200 ease-in-out',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  );
}

export function PlatformSettingsForm({ initial }: { initial: PlatformSettingsRecord }) {
  const t = useTranslations('admin.platformSettings');
  const [form,    setForm]    = useState(initial);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  /** Landing section awaiting hide confirmation (hiding is destructive-ish: nav link + 404). */
  const [pendingHide, setPendingHide] = useState<LandingSection | null>(null);

  function set<K extends keyof PlatformSettingsRecord>(k: K, v: PlatformSettingsRecord[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  }

  /** Missing map / missing key ⇒ visible (backward-compatible default). */
  function isSectionVisible(section: LandingSection): boolean {
    return form.landingVisibility?.[section] !== false;
  }

  function setSectionVisible(section: LandingSection, visible: boolean) {
    setForm((f) => ({
      ...f,
      landingVisibility: { ...(f.landingVisibility ?? {}), [section]: visible },
    }));
    setSaved(false);
  }

  /** Showing is instant; hiding asks for confirmation first. */
  function requestSectionToggle(section: LandingSection, visible: boolean) {
    if (visible) setSectionVisible(section, true);
    else setPendingHide(section);
  }

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      const { updatedAt: _, ...patch } = form;
      void _;
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? t('saveFailed'));
      }
      const data = await res.json() as { settings: PlatformSettingsRecord };
      setForm(data.settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* General */}
      <Card>
        <CardHeader>
          <p className="font-medium">{t('sectionGeneral')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="app-name">{t('platformNameLabel')}</Label>
            <Input
              id="app-name"
              value={form.appName}
              onChange={(e) => set('appName', e.target.value)}
              maxLength={60}
              placeholder={t('platformNamePlaceholder')}
            />
            <p className="text-xs text-muted-foreground">
              {t('platformNameHint')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Feature flags */}
      <Card>
        <CardHeader>
          <p className="font-medium">{t('sectionFeatureFlags')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            label={t('maintenanceModeLabel')}
            description={t('maintenanceModeDescription')}
            checked={form.maintenanceMode}
            onChange={(v) => set('maintenanceMode', v)}
          />
          <ToggleRow
            label={t('newSignupsLabel')}
            description={t('newSignupsDescription')}
            checked={form.signupsEnabled}
            onChange={(v) => set('signupsEnabled', v)}
          />
          <ToggleRow
            label={t('paymentsLabel')}
            description={t('paymentsDescription')}
            checked={form.paymentsEnabled}
            onChange={(v) => set('paymentsEnabled', v)}
          />
        </CardContent>
      </Card>

      {/* Landing sections — hidden sections vanish from the public nav AND 404 */}
      <Card>
        <CardHeader>
          <p className="font-medium">{t('sectionLanding')}</p>
          <p className="text-xs text-muted-foreground">{t('sectionLandingDescription')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {LANDING_SECTIONS.map((section) => (
            <ToggleRow
              key={section}
              label={t(`landing.${section}`)}
              description={t('landingToggleDescription')}
              checked={isSectionVisible(section)}
              onChange={(v) => requestSectionToggle(section, v)}
            />
          ))}
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <Button loading={saving} onClick={save}>
          <Save className="size-4" /> {t('saveSettings')}
        </Button>
        {saved  && <p className="text-sm text-emerald-600">{t('settingsSaved')}</p>}
        {error  && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {form.updatedAt && (
        <p className="text-xs text-muted-foreground">
          {t('lastUpdated', { date: new Date(form.updatedAt).toLocaleString() })}
        </p>
      )}

      {/* Hide-section confirmation — hiding removes the nav link AND 404s the page */}
      <Dialog open={pendingHide !== null} onOpenChange={(open) => { if (!open) setPendingHide(null); }}>
        <DialogContent showClose={false}>
          <DialogHeader>
            <DialogTitle>
              {pendingHide && t('hideConfirmTitle', { page: t(`landing.${pendingHide}`) })}
            </DialogTitle>
            <DialogDescription>{t('hideConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingHide(null)}>
              {t('hideConfirmCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingHide) setSectionVisible(pendingHide, false);
                setPendingHide(null);
              }}
            >
              {t('hideConfirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
