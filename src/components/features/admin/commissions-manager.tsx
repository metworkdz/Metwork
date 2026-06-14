'use client';

/**
 * Admin: commission rules editor.
 * Each rule card shows the current rate with an inline edit field.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, X, Check } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { CommissionRuleRecord } from '@/server/db/store';

async function patchRule(id: string, body: { rate?: number; isActive?: boolean }) {
  const res = await fetch(`/api/admin/commission-rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(d.error?.message ?? 'Update failed');
  }
  return (await res.json() as { rule: CommissionRuleRecord }).rule;
}

async function patchPlatformConfig(body: { receiverCommissionRate?: number; payerFeeRate?: number }) {
  const res = await fetch('/api/admin/platform-config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(d.error?.message ?? 'Update failed');
  }
  return (await res.json()) as { receiverCommissionRate?: number; payerFeeRate?: number };
}

/**
 * Central commission engine editor — the receiver (account holder) cut and the
 * payer (buyer) fee that the platform applies to all platform payments and
 * online cash deposits. Persists via the platform-config API. The total take
 * (receiver + payer) is shown for clarity. FLAT (Pro) incubators are exempt
 * from the receiver cut; their buyers still pay the payer fee.
 */
function CommissionEngineCard({
  receiverRate: initialReceiver,
  payerRate: initialPayer,
}: {
  receiverRate: number;
  payerRate: number;
}) {
  const t = useTranslations('admin.commissions');
  const [receiver, setReceiver] = useState((initialReceiver * 100).toFixed(1));
  const [payer, setPayer] = useState((initialPayer * 100).toFixed(1));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const receiverNum = parseFloat(receiver);
  const payerNum = parseFloat(payer);
  const totalTake =
    (Number.isNaN(receiverNum) ? 0 : receiverNum) + (Number.isNaN(payerNum) ? 0 : payerNum);

  async function save() {
    if (Number.isNaN(receiverNum) || receiverNum < 0 || receiverNum > 100) { setErr(t('rateError')); return; }
    if (Number.isNaN(payerNum) || payerNum < 0 || payerNum > 100) { setErr(t('rateError')); return; }
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const updated = await patchPlatformConfig({
        receiverCommissionRate: receiverNum / 100,
        payerFeeRate: payerNum / 100,
      });
      if (updated.receiverCommissionRate != null) setReceiver((updated.receiverCommissionRate * 100).toFixed(1));
      if (updated.payerFeeRate != null) setPayer((updated.payerFeeRate * 100).toFixed(1));
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-primary/30 bg-primary/[0.02]">
      <CardHeader className="pb-2">
        <p className="font-medium">{t('engineTitle')}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t('engineDescription')}</p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('receiverRate')}</p>
            <div className="relative w-28">
              <Input
                type="number" min="0" max="100" step="0.1"
                value={receiver}
                onChange={(e) => { setReceiver(e.target.value); setErr(null); setSaved(false); }}
                className="pe-7"
                aria-label={t('receiverRate')}
              />
              <span className="absolute end-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('payerRate')}</p>
            <div className="relative w-28">
              <Input
                type="number" min="0" max="100" step="0.1"
                value={payer}
                onChange={(e) => { setPayer(e.target.value); setErr(null); setSaved(false); }}
                className="pe-7"
                aria-label={t('payerRate')}
              />
              <span className="absolute end-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <p className="text-xs text-muted-foreground">{t('totalTake')}</p>
            <p className="text-xl font-semibold tabular-nums">{totalTake.toFixed(1)}%</p>
          </div>
          <Button onClick={save} loading={busy} className="ms-auto">
            {t('saveButton')}
          </Button>
        </div>
        {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
        {saved && !err && <p className="mt-2 text-xs text-emerald-600">{t('savedNotice')}</p>}
        <p className="mt-3 text-xs text-muted-foreground">{t('engineHint')}</p>
      </CardContent>
    </Card>
  );
}

function RuleCard({ rule: initial }: { rule: CommissionRuleRecord }) {
  const t = useTranslations('admin.commissions');
  const [rule,     setRule]     = useState(initial);
  const [editing,  setEditing]  = useState(false);
  const [draft,    setDraft]    = useState('');
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState<string | null>(null);

  function startEdit() {
    setDraft((rule.rate * 100).toFixed(1));
    setEditing(true);
    setErr(null);
  }

  async function saveRate() {
    const num = parseFloat(draft);
    if (isNaN(num) || num < 0 || num > 100) { setErr(t('rateError')); return; }
    setBusy(true);
    try {
      const updated = await patchRule(rule.id, { rate: num / 100 });
      setRule(updated);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      const updated = await patchRule(rule.id, { isActive: !rule.isActive });
      setRule(updated);
    } catch { /* silent */ }
    finally { setBusy(false); }
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{rule.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{rule.description}</p>
          </div>
          <Badge variant={rule.isActive ? 'success' : 'default'}>
            {rule.isActive ? t('active') : t('inactive')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3">
          {/* Rate display / edit */}
          {editing ? (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); setErr(null); }}
                  className="w-24 pe-7"
                  autoFocus
                />
                <span className="absolute end-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
              <Button size="sm" loading={busy} onClick={saveRate}>
                <Check className="size-3" /> {t('saveButton')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setErr(null); }}>
                <X className="size-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {(rule.rate * 100).toFixed(1)}%
              </span>
              <Button variant="ghost" size="icon" className="size-7" onClick={startEdit} disabled={busy}>
                <Pencil className="size-3" />
              </Button>
            </div>
          )}

          {/* Toggle active */}
          <Button
            variant="outline"
            size="sm"
            loading={busy && !editing}
            onClick={toggleActive}
            className="ms-auto"
          >
            {rule.isActive ? t('disable') : t('enable')}
          </Button>
        </div>
        {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          {t('appliesTo')} <code className="rounded bg-muted px-1">{rule.transactionType}</code>
        </p>
      </CardContent>
    </Card>
  );
}

export function CommissionsManager({
  rules,
  receiverRate,
  payerRate,
}: {
  rules: CommissionRuleRecord[];
  receiverRate: number;
  payerRate: number;
}) {
  const t = useTranslations('admin.commissions');
  return (
    <div className="space-y-5">
      <CommissionEngineCard receiverRate={receiverRate} payerRate={payerRate} />
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('description')}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} />
          ))}
        </div>
      </div>
    </div>
  );
}
