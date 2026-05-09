'use client';

/**
 * Admin: platform settings form.
 * App name, maintenance mode, feature toggles.
 */
import { useState } from 'react';
import { Save } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
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
  const [form,    setForm]    = useState(initial);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  function set<K extends keyof PlatformSettingsRecord>(k: K, v: PlatformSettingsRecord[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
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
        throw new Error(d.error?.message ?? 'Save failed');
      }
      const data = await res.json() as { settings: PlatformSettingsRecord };
      setForm(data.settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* General */}
      <Card>
        <CardHeader>
          <p className="font-medium">General</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="app-name">Platform name</Label>
            <Input
              id="app-name"
              value={form.appName}
              onChange={(e) => set('appName', e.target.value)}
              maxLength={60}
              placeholder="Metwork"
            />
            <p className="text-xs text-muted-foreground">
              Shown in emails, page titles, and the browser tab.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Feature flags */}
      <Card>
        <CardHeader>
          <p className="font-medium">Feature flags</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            label="Maintenance mode"
            description="Redirect all visitors to a maintenance page. Admins can still log in."
            checked={form.maintenanceMode}
            onChange={(v) => set('maintenanceMode', v)}
          />
          <ToggleRow
            label="New signups"
            description="Allow new users to register. Disable to pause user growth."
            checked={form.signupsEnabled}
            onChange={(v) => set('signupsEnabled', v)}
          />
          <ToggleRow
            label="Payments"
            description="Allow wallet top-ups and booking payments. Disable during maintenance."
            checked={form.paymentsEnabled}
            onChange={(v) => set('paymentsEnabled', v)}
          />
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <Button loading={saving} onClick={save}>
          <Save className="size-4" /> Save settings
        </Button>
        {saved  && <p className="text-sm text-emerald-600">Settings saved.</p>}
        {error  && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {form.updatedAt && (
        <p className="text-xs text-muted-foreground">
          Last updated: {new Date(form.updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
