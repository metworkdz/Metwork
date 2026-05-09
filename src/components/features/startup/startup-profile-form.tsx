'use client';

/**
 * Startup-profile editor for entrepreneurs.
 * Creates or updates the founder's startup listing via the real API.
 *
 *   No existing listing → POST /api/startups   (creates, returns id)
 *   Existing listing    → PATCH /api/startups/:id
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

const INDUSTRIES = [
  'AI / ML',
  'HealthTech',
  'FinTech',
  'Logistics',
  'E-commerce',
  'EdTech',
  'AgriTech',
  'CleanTech',
  'SaaS',
  'Media',
  'Other',
];

export interface StartupProfileFormState {
  /** DB id — null when the startup doesn't exist yet. */
  id:            string | null;
  name:          string;
  description:   string;
  industry:      string;
  fundingGoal:   string; // string in form, parsed on submit
  equityOffered: string; // string in form, parsed on submit
  valuation:     string; // optional, empty string = null
  status:        'DRAFT' | 'ACTIVE' | 'CLOSED';
}

export function StartupProfileForm({ initial }: { initial: StartupProfileFormState }) {
  const [values, setValues] = useState<StartupProfileFormState>(initial);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function update<K extends keyof StartupProfileFormState>(key: K, val: StartupProfileFormState[K]) {
    setFeedback(null);
    setValues((v) => ({ ...v, [key]: val }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const fundingGoal   = parseInt(values.fundingGoal, 10);
    const equityOffered = parseFloat(values.equityOffered);
    const valuation     = values.valuation ? parseInt(values.valuation, 10) : null;

    if (isNaN(fundingGoal) || fundingGoal < 100_000) {
      setFeedback({ ok: false, text: 'Funding goal must be at least 100,000 DZD.' });
      return;
    }
    if (isNaN(equityOffered) || equityOffered < 0.1 || equityOffered > 100) {
      setFeedback({ ok: false, text: 'Equity offered must be between 0.1% and 100%.' });
      return;
    }

    const body = {
      name:          values.name.trim(),
      description:   values.description.trim(),
      industry:      values.industry,
      fundingGoal,
      equityOffered,
      valuation,
      status:        values.status,
    };

    startTransition(async () => {
      try {
        let res: Response;
        if (values.id) {
          // Update existing listing.
          res = await fetch(`/api/startups/${values.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
          });
        } else {
          // Create new listing.
          res = await fetch('/api/startups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
          });
        }

        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
          if (d.error?.message?.includes('membership')) {
            setFeedback({ ok: false, text: 'An active membership is required to list your startup. Upgrade your plan.' });
          } else {
            setFeedback({ ok: false, text: d.error?.message ?? 'Save failed. Please try again.' });
          }
          return;
        }

        const data = await res.json() as { startup?: { id: string }; id?: string };
        const newId = data.startup?.id ?? data.id;
        if (newId && !values.id) {
          setValues((v) => ({ ...v, id: newId }));
        }
        setFeedback({ ok: true, text: 'Startup profile saved successfully.' });
      } catch {
        setFeedback({ ok: false, text: 'Network error. Please check your connection.' });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basic info</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Startup name" htmlFor="su-name" required>
            <Input
              id="su-name"
              value={values.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Acme Inc"
              required
            />
          </Field>

          <Field label="Industry" htmlFor="su-industry">
            <Select
              value={values.industry}
              onValueChange={(v) => update('industry', v)}
            >
              <SelectTrigger id="su-industry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Funding goal (DZD)" htmlFor="su-funding">
            <Input
              id="su-funding"
              type="number"
              min={100_000}
              step={1}
              inputMode="numeric"
              value={values.fundingGoal}
              onChange={(e) => update('fundingGoal', e.target.value)}
              placeholder="10,000,000"
            />
          </Field>

          <Field label="Equity offered (%)" htmlFor="su-equity">
            <Input
              id="su-equity"
              type="number"
              min={0.1}
              max={100}
              step={0.1}
              inputMode="decimal"
              value={values.equityOffered}
              onChange={(e) => update('equityOffered', e.target.value)}
              placeholder="15"
            />
          </Field>

          <Field label="Pre-money valuation (DZD, optional)" htmlFor="su-val">
            <Input
              id="su-val"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={values.valuation}
              onChange={(e) => update('valuation', e.target.value)}
              placeholder="Leave blank if unknown"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pitch</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="Description" htmlFor="su-desc" required>
            <textarea
              id="su-desc"
              value={values.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Tell investors who you are, your traction, and what you're raising for."
              rows={6}
              className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">{values.description.length}/2000</p>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Marketplace visibility</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Show in investor marketplace</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Investors browsing the marketplace will see your profile and can request a meeting.
              Requires an active STARTUP membership.
            </p>
          </div>
          <Select
            value={values.status}
            onValueChange={(v) => update('status', v as 'DRAFT' | 'ACTIVE' | 'CLOSED')}
          >
            <SelectTrigger className="w-32 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {feedback && (
          <p className={`text-sm ${feedback.ok ? 'text-emerald-600' : 'text-destructive'}`}>
            {feedback.text}
          </p>
        )}
        {values.id && (
          <Badge variant="outline" className="text-xs">
            ID: {values.id.slice(0, 8)}…
          </Badge>
        )}
        <Button type="submit" loading={pending}>
          {values.id ? 'Save changes' : 'Create listing'}
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
