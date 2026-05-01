'use client';

/**
 * Startup-profile editor for entrepreneurs. Demo-only persistence (state)
 * until the backend `startups` resource ships. The submit handler is
 * the natural drop-in point for `startupService.upsert(...)`.
 */
import { useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { algerianCities } from '@/config/cities';
import type { StartupStage } from '@/types/domain';

const STAGES: { value: StartupStage; label: string }[] = [
  { value: 'IDEA', label: 'Idea' },
  { value: 'PRE_SEED', label: 'Pre-seed' },
  { value: 'SEED', label: 'Seed' },
  { value: 'SERIES_A', label: 'Series A' },
  { value: 'GROWTH', label: 'Growth' },
];

const SECTORS = [
  'AI / Media',
  'HealthTech',
  'FinTech',
  'Logistics',
  'E-commerce',
  'EdTech',
  'AgriTech',
  'CleanTech',
  'SaaS',
  'Other',
];

export interface StartupProfileFormState {
  name: string;
  tagline: string;
  pitch: string;
  stage: StartupStage;
  sector: string;
  city: string;
  fundingAsk: string; // string in the form, parsed on submit
  isListed: boolean;
}

export function StartupProfileForm({ initial }: { initial: StartupProfileFormState }) {
  const [values, setValues] = useState<StartupProfileFormState>(initial);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function update<K extends keyof StartupProfileFormState>(key: K, val: StartupProfileFormState[K]) {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: val }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      // TODO: replace with `await startupService.upsert(values)` when the
      // backend resource ships. We intentionally simulate latency so the
      // success state is visible.
      await new Promise((r) => setTimeout(r, 600));
      setSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basic info</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Startup name" htmlFor="name" required>
            <Input
              id="name"
              value={values.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Acme Inc"
              required
            />
          </Field>
          <Field label="Tagline" htmlFor="tagline" required>
            <Input
              id="tagline"
              value={values.tagline}
              onChange={(e) => update('tagline', e.target.value)}
              placeholder="One sentence about what you do"
              required
            />
          </Field>
          <Field label="Stage" htmlFor="stage">
            <Select
              value={values.stage}
              onValueChange={(v) => update('stage', v as StartupStage)}
            >
              <SelectTrigger id="stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Sector" htmlFor="sector">
            <Select
              value={values.sector}
              onValueChange={(v) => update('sector', v)}
            >
              <SelectTrigger id="sector">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECTORS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="City" htmlFor="city">
            <Select value={values.city} onValueChange={(v) => update('city', v)}>
              <SelectTrigger id="city">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {algerianCities.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Funding ask (DZD)" htmlFor="fundingAsk">
            <Input
              id="fundingAsk"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={values.fundingAsk}
              onChange={(e) => update('fundingAsk', e.target.value)}
              placeholder="10000000"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pitch</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="Long pitch" htmlFor="pitch" required>
            <textarea
              id="pitch"
              value={values.pitch}
              onChange={(e) => update('pitch', e.target.value)}
              placeholder="Tell investors who you are, your traction, and what you're raising for."
              rows={5}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Marketplace listing</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Show in investor marketplace</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Investors browsing the marketplace will see your profile and can
              request a meeting.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.isListed}
              onChange={(e) => update('isListed', e.target.checked)}
              className="size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
            />
            <span className="font-medium">{values.isListed ? 'Listed' : 'Hidden'}</span>
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {saved && (
          <Badge variant="success" className="px-2.5 py-1 text-xs">
            Saved
          </Badge>
        )}
        <Button type="submit" loading={pending}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
