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
import { formatCurrency } from '@/lib/format';
import { computeCyclePrices } from '@/lib/billing-cycles';
import type { CommissionRuleRecord, MembershipPlanConfigRecord } from '@/server/db/store';
import type { Locale } from '@/i18n/config';

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

/** One admin-editable membership plan, as the manager receives it. */
export interface MembershipPlanView {
  config: MembershipPlanConfigRecord;
  /** Canonical allowance from platformConfig — NOT stored on the config record. */
  monthlyPassCount: number;
}

async function patchMembershipPlan(
  planCode: string,
  body: Partial<{
    monthlyPrice: number;
    annualDiscountPercent: number;
    consultationDiscountRate: number;
    spaceDiscountRate: number;
    monthlyPassCount: number;
    recommended: boolean;
  }>,
) {
  const res = await fetch(`/api/admin/membership-plans/${planCode}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: { message?: string }; message?: string };
    throw new Error(d.error?.message ?? d.message ?? 'Update failed');
  }
  return (await res.json()) as {
    plan: MembershipPlanConfigRecord;
    monthlyPassCount: number;
  };
}

/**
 * Admin: pricing + benefits for ONE membership plan.
 *
 * Same pencil → input → Check/X interaction as RuleCard, extended to the five
 * fields a plan carries. The semesterly / annual totals are DERIVED live from
 * the shared billing-cycle helper, so the admin sees exactly what a buyer will
 * be charged before saving.
 *
 * Everything edited here applies to NEW purchases only — active members keep
 * their frozen terms until renewal, which the card states explicitly.
 */
function MembershipPricingCard({
  plan: initial,
  locale,
}: {
  plan: MembershipPlanView;
  locale: Locale;
}) {
  const t = useTranslations('admin.commissions');
  const [plan, setPlan] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [price, setPrice] = useState(String(initial.config.monthlyPrice));
  const [annual, setAnnual] = useState(String(initial.config.annualDiscountPercent));
  const [consult, setConsult] = useState((initial.config.consultationDiscountRate * 100).toFixed(0));
  const [space, setSpace] = useState((initial.config.spaceDiscountRate * 100).toFixed(0));
  const [passes, setPasses] = useState(String(initial.monthlyPassCount));

  const planLabel = plan.config.planCode === 'STARTUP' ? t('planFounder') : t('planBuilder');

  function startEdit() {
    setPrice(String(plan.config.monthlyPrice));
    setAnnual(String(plan.config.annualDiscountPercent));
    setConsult((plan.config.consultationDiscountRate * 100).toFixed(0));
    setSpace((plan.config.spaceDiscountRate * 100).toFixed(0));
    setPasses(String(plan.monthlyPassCount));
    setErr(null);
    setSaved(false);
    setEditing(true);
  }

  // Live preview of what a buyer would pay, from the SAME helper the purchase
  // route uses — never a re-implementation of the cycle math.
  const draftPrices = computeCyclePrices({
    monthlyPrice: Number(price),
    semesterlyMonths: plan.config.semesterlyMonths,
    annualDiscountPercent: Number(annual),
  });
  const shownPrices = editing
    ? draftPrices
    : computeCyclePrices({
        monthlyPrice: plan.config.monthlyPrice,
        semesterlyMonths: plan.config.semesterlyMonths,
        annualDiscountPercent: plan.config.annualDiscountPercent,
      });

  async function save() {
    const priceNum = Number(price);
    const annualNum = Number(annual);
    const consultNum = Number(consult);
    const spaceNum = Number(space);
    const passNum = Number(passes);

    if (!Number.isInteger(priceNum) || priceNum < 0) { setErr(t('priceError')); return; }
    if (Number.isNaN(annualNum) || annualNum < 0 || annualNum > 100) { setErr(t('rateError')); return; }
    if (Number.isNaN(consultNum) || consultNum < 0 || consultNum > 100) { setErr(t('rateError')); return; }
    if (Number.isNaN(spaceNum) || spaceNum < 0 || spaceNum > 100) { setErr(t('rateError')); return; }
    if (!Number.isInteger(passNum) || passNum < 0 || passNum > 100) { setErr(t('passError')); return; }

    setBusy(true);
    setErr(null);
    try {
      const updated = await patchMembershipPlan(plan.config.planCode, {
        monthlyPrice: priceNum,
        annualDiscountPercent: annualNum,
        consultationDiscountRate: consultNum / 100,
        spaceDiscountRate: spaceNum / 100,
        monthlyPassCount: passNum,
      });
      setPlan({ config: updated.plan, monthlyPassCount: updated.monthlyPassCount });
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function makeRecommended() {
    setBusy(true);
    setErr(null);
    try {
      const updated = await patchMembershipPlan(plan.config.planCode, { recommended: true });
      setPlan({ config: updated.plan, monthlyPassCount: updated.monthlyPassCount });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{planLabel}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatCurrency(shownPrices.semesterly, locale)} · {t('semesterlyTotal')}
              {' — '}
              {formatCurrency(shownPrices.annual, locale)} · {t('annualTotal')}
            </p>
          </div>
          {plan.config.recommended && (
            <Badge variant="primary" className="shrink-0">{t('recommendedTag')}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('monthlyPrice')} suffix="DZD">
                <Input type="number" min="0" step="100" value={price} autoFocus
                  onChange={(e) => { setPrice(e.target.value); setErr(null); }} className="pe-12"
                  aria-label={t('monthlyPrice')} />
              </Field>
              <Field label={t('annualDiscount')} suffix="%">
                <Input type="number" min="0" max="100" step="1" value={annual}
                  onChange={(e) => { setAnnual(e.target.value); setErr(null); }} className="pe-7"
                  aria-label={t('annualDiscount')} />
              </Field>
              <Field label={t('consultationDiscount')} suffix="%">
                <Input type="number" min="0" max="100" step="1" value={consult}
                  onChange={(e) => { setConsult(e.target.value); setErr(null); }} className="pe-7"
                  aria-label={t('consultationDiscount')} />
              </Field>
              <Field label={t('spaceDiscount')} suffix="%">
                <Input type="number" min="0" max="100" step="1" value={space}
                  onChange={(e) => { setSpace(e.target.value); setErr(null); }} className="pe-7"
                  aria-label={t('spaceDiscount')} />
              </Field>
              <Field label={t('passCount')}>
                <Input type="number" min="0" max="100" step="1" value={passes}
                  onChange={(e) => { setPasses(e.target.value); setErr(null); }}
                  aria-label={t('passCount')} />
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" loading={busy} onClick={save}>
                <Check className="size-3" /> {t('saveButton')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setErr(null); }}>
                <X className="size-3" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {formatCurrency(plan.config.monthlyPrice, locale)}
              </span>
              <span className="text-sm text-muted-foreground">{t('perMonth')}</span>
              <Button variant="ghost" size="icon" className="size-7" onClick={startEdit} disabled={busy}>
                <Pencil className="size-3" />
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <ReadRow label={t('annualDiscount')} value={`${plan.config.annualDiscountPercent}%`} />
              <ReadRow label={t('consultationDiscount')} value={`${Math.round(plan.config.consultationDiscountRate * 100)}%`} />
              <ReadRow label={t('spaceDiscount')} value={`${Math.round(plan.config.spaceDiscountRate * 100)}%`} />
              <ReadRow label={t('passCount')} value={String(plan.monthlyPassCount)} />
            </dl>
            {!plan.config.recommended && (
              <Button variant="outline" size="sm" loading={busy} onClick={makeRecommended}>
                {t('markRecommended')}
              </Button>
            )}
          </div>
        )}
        {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
        {saved && !err && <p className="mt-2 text-xs text-emerald-600">{t('savedNotice')}</p>}
      </CardContent>
    </Card>
  );
}

function Field({ label, suffix, children }: { label: string; suffix?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="relative">
        {children}
        {suffix && (
          <span className="absolute end-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="text-end font-medium tabular-nums text-foreground">{value}</dd>
    </>
  );
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
  membershipPlans,
  locale,
}: {
  rules: CommissionRuleRecord[];
  receiverRate: number;
  payerRate: number;
  membershipPlans: MembershipPlanView[];
  locale: Locale;
}) {
  const t = useTranslations('admin.commissions');
  return (
    <div className="space-y-5">
      <CommissionEngineCard receiverRate={receiverRate} payerRate={payerRate} />

      {/* Membership plans — pricing + benefits for new purchases */}
      <div className="space-y-4">
        <div>
          <p className="font-medium">{t('membershipTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('membershipDescription')}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {membershipPlans.map((plan) => (
            <MembershipPricingCard key={plan.config.planCode} plan={plan} locale={locale} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('frozenHint')}</p>
      </div>

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
