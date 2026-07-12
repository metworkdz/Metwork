'use client';

/**
 * Admin Partner Perks manager — card grid + create/edit dialog.
 *
 * Reads come from the RSC parent (direct service read); every mutation goes
 * through the /api/admin/perks routes then router.refresh(), following the
 * create-promo-code-form / promo-code-toggle conventions.
 *
 * The fulfillment type is chosen at creation only — the PATCH contract
 * intentionally has no fulfillmentType (switching would orphan pool entries
 * or vouchers), so the edit dialog shows it as a locked badge.
 */
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { Plus, Pencil, Ticket, BadgeCheck, AlertTriangle, ListOrdered } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { MembershipTierBadge } from '@/components/ui/membership-tier-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PerkWithCounts } from '@/server/perks/service';

interface FormState {
  partnerName: string;
  logoUrl: string;
  title: string;
  description: string;
  fulfillmentType: 'CODE_POOL' | 'VOUCHER';
  minTier: 'BUILDER' | 'FOUNDER';
  lowStockThreshold: string;
  /** Create-mode only — newline-separated initial pool codes. */
  codes: string;
}

const EMPTY_FORM: FormState = {
  partnerName: '',
  logoUrl: '',
  title: '',
  description: '',
  fulfillmentType: 'CODE_POOL',
  minTier: 'BUILDER',
  lowStockThreshold: '',
  codes: '',
};

function formFromPerk(p: PerkWithCounts): FormState {
  return {
    partnerName: p.partnerName,
    logoUrl: p.logoUrl ?? '',
    title: p.title,
    description: p.description,
    fulfillmentType: p.fulfillmentType,
    minTier: p.minTier,
    lowStockThreshold: p.lowStockThreshold !== null ? String(p.lowStockThreshold) : '',
    codes: '',
  };
}

export function PerksManager({ perks }: { perks: PerkWithCounts[] }) {
  const t = useTranslations('admin.perks');
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  /** null = create mode, otherwise the perk being edited. */
  const [editing, setEditing] = useState<PerkWithCounts | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(perk: PerkWithCounts) {
    setEditing(perk);
    setForm(formFromPerk(perk));
    setError(null);
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.partnerName.trim()) { setError(t('partnerRequired')); return; }
    if (!form.title.trim()) { setError(t('titleRequired')); return; }
    if (!form.description.trim()) { setError(t('descriptionRequired')); return; }

    const isPool = form.fulfillmentType === 'CODE_POOL';
    const threshold = form.lowStockThreshold.trim()
      ? parseInt(form.lowStockThreshold, 10)
      : null;
    if (isPool && threshold !== null && (isNaN(threshold) || threshold < 1)) {
      setError(t('thresholdInvalid'));
      return;
    }

    const payload = {
      partnerName: form.partnerName.trim(),
      logoUrl: form.logoUrl.trim() || null,
      title: form.title.trim(),
      description: form.description.trim(),
      minTier: form.minTier,
      lowStockThreshold: isPool ? threshold : null,
    };

    startTransition(async () => {
      try {
        let res: Response;
        if (editing) {
          res = await fetch(`/api/admin/perks/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
          });
        } else {
          res = await fetch('/api/admin/perks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              ...payload,
              fulfillmentType: form.fulfillmentType,
              active: true,
            }),
          });
        }
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error?.message ?? t('failed'));
          return;
        }
        // Create mode: bulk-add any pasted codes right after the perk exists.
        if (!editing && isPool && form.codes.trim()) {
          const codesRes = await fetch(`/api/admin/perks/${data.id}/codes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ codes: form.codes }),
          });
          if (!codesRes.ok) {
            const codesData = await codesRes.json();
            setError(codesData?.error?.message ?? t('codesFailed'));
            router.refresh();
            return;
          }
        }
        setDialogOpen(false);
        router.refresh();
      } catch {
        setError(t('networkError'));
      }
    });
  }

  const isPool = form.fulfillmentType === 'CODE_POOL';

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="me-1.5 size-4" />
          {t('addPerk')}
        </Button>
      </div>

      {perks.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {t('noPerks')}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {perks.map((perk) => (
            <AdminPerkCard key={perk.id} perk={perk} onEdit={() => openEdit(perk)} />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('editPerk') : t('addPerk')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('partnerName')} htmlFor="perk-partner" required>
                <Input
                  id="perk-partner"
                  value={form.partnerName}
                  onChange={(e) => set('partnerName', e.target.value)}
                  placeholder="SlickPay"
                />
              </FormField>
              <FormField label={t('logoUrl')} htmlFor="perk-logo">
                <Input
                  id="perk-logo"
                  type="url"
                  value={form.logoUrl}
                  onChange={(e) => set('logoUrl', e.target.value)}
                  placeholder="https://…/logo.png"
                />
              </FormField>
            </div>

            <FormField label={t('perkTitle')} htmlFor="perk-title" required>
              <Input
                id="perk-title"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder={t('titlePlaceholder')}
              />
            </FormField>

            <FormField label={t('description')} htmlFor="perk-desc" required>
              <Textarea
                id="perk-desc"
                rows={3}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('fulfillmentType')} htmlFor="perk-type">
                {editing ? (
                  <div className="flex h-10 items-center">
                    <FulfillmentBadge type={editing.fulfillmentType} />
                  </div>
                ) : (
                  <Select
                    value={form.fulfillmentType}
                    onValueChange={(v) => set('fulfillmentType', v as FormState['fulfillmentType'])}
                  >
                    <SelectTrigger id="perk-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CODE_POOL">{t('codePool')}</SelectItem>
                      <SelectItem value="VOUCHER">{t('voucher')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <FormField label={t('minTier')} htmlFor="perk-tier">
                <Select
                  value={form.minTier}
                  onValueChange={(v) => set('minTier', v as FormState['minTier'])}
                >
                  <SelectTrigger id="perk-tier">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUILDER">Builder+</SelectItem>
                    <SelectItem value="FOUNDER">Founder</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            {isPool && (
              <FormField
                label={t('lowStockThreshold')}
                htmlFor="perk-threshold"
                hint={t('thresholdHint')}
              >
                <Input
                  id="perk-threshold"
                  type="number"
                  min={1}
                  value={form.lowStockThreshold}
                  onChange={(e) => set('lowStockThreshold', e.target.value)}
                  placeholder="5"
                />
              </FormField>
            )}

            {isPool && !editing && (
              <FormField label={t('bulkCodes')} htmlFor="perk-codes" hint={t('bulkCodesHint')}>
                <Textarea
                  id="perk-codes"
                  rows={5}
                  className="font-mono text-sm"
                  value={form.codes}
                  onChange={(e) => set('codes', e.target.value)}
                  placeholder={'SLICK-A1B2\nSLICK-C3D4'}
                />
              </FormField>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={isPending}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" loading={isPending}>
                {editing ? t('save') : t('create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────── Card ─────────────────────── */

function FulfillmentBadge({ type }: { type: 'CODE_POOL' | 'VOUCHER' }) {
  const t = useTranslations('admin.perks');
  return type === 'CODE_POOL' ? (
    <Badge variant="info" className="gap-1">
      <ListOrdered className="size-3" />
      {t('codePool')}
    </Badge>
  ) : (
    <Badge variant="primary" className="gap-1">
      <Ticket className="size-3" />
      {t('voucher')}
    </Badge>
  );
}

function AdminPerkCard({ perk, onEdit }: { perk: PerkWithCounts; onEdit: () => void }) {
  const t = useTranslations('admin.perks');
  const router = useRouter();
  const [toggling, setToggling] = useState(false);

  const lowStock =
    perk.fulfillmentType === 'CODE_POOL' &&
    perk.lowStockThreshold !== null &&
    (perk.stockAvailable ?? 0) < perk.lowStockThreshold;

  async function toggleActive() {
    setToggling(true);
    try {
      await fetch(`/api/admin/perks/${perk.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ active: !perk.active }),
      });
      router.refresh();
    } finally {
      setToggling(false);
    }
  }

  return (
    <Card className={perk.active ? '' : 'opacity-60'}>
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <PartnerLogo logoUrl={perk.logoUrl} partnerName={perk.partnerName} />
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <FulfillmentBadge type={perk.fulfillmentType} />
            <MembershipTierBadge tier={perk.minTier} size="xs" />
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {perk.partnerName}
          </p>
          <h3 className="mt-0.5 truncate text-base font-semibold">{perk.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{perk.description}</p>
        </div>

        <div className="mt-auto space-y-3">
          <div className="flex items-center gap-2 text-sm">
            {perk.fulfillmentType === 'CODE_POOL' ? (
              <>
                <span className={lowStock ? 'font-semibold text-red-600' : 'font-semibold'}>
                  {t('availableCount', { count: perk.stockAvailable ?? 0 })}
                </span>
                <span className="text-muted-foreground">
                  / {t('issuedCount', { count: perk.codesAssigned ?? 0 })}
                </span>
                {lowStock && (
                  <Badge variant="danger" className="gap-1">
                    <AlertTriangle className="size-3" />
                    {t('lowStock')}
                  </Badge>
                )}
              </>
            ) : (
              <span className="flex items-center gap-1.5 font-semibold">
                <BadgeCheck className="size-4 text-primary-600" />
                {t('issuedCount', { count: perk.claimCount ?? 0 })}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="me-1 size-3.5" />
              {t('edit')}
            </Button>
            {perk.fulfillmentType === 'CODE_POOL' && (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/dashboard/admin/perks/${perk.id}`}>{t('manageCodes')}</Link>
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              loading={toggling}
              onClick={toggleActive}
              className={
                perk.active ? 'ms-auto text-destructive hover:text-destructive' : 'ms-auto text-muted-foreground'
              }
            >
              {perk.active ? t('deactivate') : t('activate')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PartnerLogo({
  logoUrl,
  partnerName,
  size = 'md',
}: {
  logoUrl: string | null;
  partnerName: string;
  size?: 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const box = size === 'lg' ? 'size-16 rounded-2xl text-xl' : 'size-11 rounded-xl text-base';
  if (!logoUrl || failed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center border border-border bg-muted font-semibold text-muted-foreground ${box}`}
        aria-hidden
      >
        {partnerName.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt={partnerName}
      className={`shrink-0 border border-border bg-white object-contain p-1 ${box}`}
      onError={() => setFailed(true)}
    />
  );
}
