'use client';

/**
 * Metwork's own legal identity — the RC / NIF / address printed on the
 * letterhead of every signed consultant contract PDF.
 *
 * This is NOT platform config: it lives on the admin-as-incubator
 * `IncubatorRecord` (the same record `receipt.ts` and the space-booking
 * contract letterhead already read), reached through the existing
 * `/api/incubator/profile` endpoint — which already allows the ADMIN role.
 * The only thing that was actually missing was a page an admin could reach
 * to edit it: `/dashboard/incubator/settings` redirects any non-INCUBATOR
 * session straight back out. This card puts the same three fields where an
 * admin actually looks instead.
 *
 * `consultant-contracts/service.ts` refuses to send a contract until all
 * three are filled in (`missingLegalFields` in `party.ts`) — a contract
 * whose purpose is proving to a tax authority who collected whose money is
 * worth nothing if it can't name the collector.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Save, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface MetworkLegalIdentity {
  address: string | null;
  commercialRegNumber: string | null;
  nif: string | null;
}

export function MetworkLegalForm({ initial }: { initial: MetworkLegalIdentity }) {
  const t = useTranslations('admin.platformSettings');
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(patch: Partial<MetworkLegalIdentity>) {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  }

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch('/api/incubator/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          address: form.address?.trim() || null,
          commercialRegNumber: form.commercialRegNumber?.trim() || null,
          nif: form.nif?.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? t('saveFailed'));
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const complete = Boolean(form.address?.trim() && form.commercialRegNumber?.trim() && form.nif?.trim());

  return (
    <Card>
      <CardHeader>
        <p className="font-medium">{t('sectionMetworkLegal')}</p>
        <p className="text-xs text-muted-foreground">{t('sectionMetworkLegalDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!complete && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            {t('metworkLegalIncompleteWarning')}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="metwork-address">{t('metworkAddressLabel')}</Label>
          <Input
            id="metwork-address"
            value={form.address ?? ''}
            onChange={(e) => set({ address: e.target.value })}
            placeholder="12 rue des Frères Bouadou, Oran, Algérie"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="metwork-rc">{t('metworkRcLabel')}</Label>
            <Input
              id="metwork-rc"
              value={form.commercialRegNumber ?? ''}
              onChange={(e) => set({ commercialRegNumber: e.target.value })}
              placeholder="31/00-1234567 B 24"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="metwork-nif">{t('metworkNifLabel')}</Label>
            <Input
              id="metwork-nif"
              value={form.nif ?? ''}
              onChange={(e) => set({ nif: e.target.value })}
              placeholder="002431012345678"
            />
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <Button size="sm" loading={saving} onClick={() => void save()}>
            <Save className="size-3.5" /> {t('saveSettings')}
          </Button>
          {saved && <span className="text-xs text-emerald-600">{t('settingsSaved')}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
