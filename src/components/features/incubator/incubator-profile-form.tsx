'use client';

/**
 * Incubator profile settings form.
 * Lets the incubator update: name, description, city, website, logo, subscription tier.
 * Also updates the manager's personal fullName and avatar.
 */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Upload, Globe, CreditCard, FileText, ReceiptText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AvatarUpload } from '@/components/shared/avatar-upload';
import type { IncubatorRecord, InvoiceTemplate, UserRecord } from '@/server/db/store';

interface Props {
  incubator: IncubatorRecord;
  user: Pick<UserRecord, 'id' | 'fullName' | 'email' | 'avatarUrl'>;
  /**
   * Whether to show the billing / subscription-tier section. Defaults to true
   * (incubator behaviour unchanged). Trainers are commission-only and have no
   * subscription plan, so the trainer settings page passes false.
   */
  showSubscriptionTier?: boolean;
}

export function IncubatorProfileForm({ incubator, user, showSubscriptionTier = true }: Props) {
  const t = useTranslations('incubator.profileForm');
  const [form, setForm] = useState({
    incubatorName: incubator.name,
    description: incubator.description ?? '',
    city: incubator.city,
    website: incubator.website ?? '',
    logoUrl: incubator.logoUrl ?? '',
    stampUrl: incubator.stampUrl ?? '',
    subscriptionTier: incubator.subscriptionTier,
    address: incubator.address ?? '',
    commercialRegNumber: incubator.commercialRegNumber ?? '',
    nif: incubator.nif ?? '',
    nis: incubator.nis ?? '',
    ai: incubator.ai ?? '',
    bankName: incubator.bankName ?? '',
    bankRib: incubator.bankRib ?? '',
    contactEmail: incubator.contactEmail ?? '',
    contactPhone: incubator.contactPhone ?? '',
    defaultVatRate: String(incubator.defaultVatRate ?? 19),
    invoiceTemplate: (incubator.invoiceTemplate ?? 'CLASSIC') as InvoiceTemplate,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stampRef = useRef<HTMLInputElement>(null);

  /** Upload an image and store its URL under `field` (logo or stamp). */
  async function handleImageUpload(file: File, field: 'logoUrl' | 'stampUrl') {
    const setBusy = field === 'stampUrl' ? setUploadingStamp : setUploading;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/incubator/upload', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) throw new Error(t('errorUpload'));
      const data = await res.json() as { url: string };
      setForm((f) => ({ ...f, [field]: data.url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorUpload'));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setSaving(true); setError(null); setSuccess(false);
    try {
      const res = await fetch('/api/incubator/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          incubatorName: form.incubatorName.trim(),
          description: form.description.trim(),
          city: form.city.trim(),
          website: form.website.trim() || null,
          logoUrl: form.logoUrl.trim() || null,
          stampUrl: form.stampUrl.trim() || null,
          ...(showSubscriptionTier ? { subscriptionTier: form.subscriptionTier } : {}),
          address: form.address.trim() || null,
          commercialRegNumber: form.commercialRegNumber.trim() || null,
          nif: form.nif.trim() || null,
          nis: form.nis.trim() || null,
          ai: form.ai.trim() || null,
          bankName: form.bankName.trim() || null,
          bankRib: form.bankRib.trim() || null,
          contactEmail: form.contactEmail.trim() || null,
          contactPhone: form.contactPhone.trim() || null,
          defaultVatRate: form.defaultVatRate.trim() !== '' && Number.isFinite(Number(form.defaultVatRate))
            ? Number(form.defaultVatRate)
            : null,
          invoiceTemplate: form.invoiceTemplate,
          fullName: form.fullName.trim(),
          avatarUrl: form.avatarUrl.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(t('errorSave'));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorSave'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Personal info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" /> {t('sectionManager')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mgr-name">{t('labelYourFullName')}</Label>
              <Input id="mgr-name" value={form.fullName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('labelEmailReadOnly')}</Label>
              <Input value={user.email} disabled />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('labelProfilePicture')}</Label>
            <div className="flex items-center gap-4">
              <AvatarUpload
                currentUrl={form.avatarUrl || null}
                fallbackInitials={form.fullName}
                onUpload={(url) => setForm((f) => ({ ...f, avatarUrl: url }))}
                onError={(msg) => setError(msg)}
                size="size-16"
              />
              <div>
                <p className="text-sm text-muted-foreground">{t('uploadPhotoHint')}</p>
                <p className="text-xs text-muted-foreground">{t('uploadPhotoTypes')}</p>
              </div>
            </div>
            <Input id="mgr-avatar" value={form.avatarUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, avatarUrl: e.target.value }))}
              placeholder={t('avatarUrlPlaceholder')} />
          </div>
        </CardContent>
      </Card>

      {/* Incubator info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" /> {t('sectionIncubator')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inc-name">{t('labelIncubatorName')}</Label>
              <Input id="inc-name" value={form.incubatorName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, incubatorName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inc-city">{t('labelCity')}</Label>
              <Input id="inc-city" value={form.city}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inc-desc">{t('labelDescription')}</Label>
            <textarea id="inc-desc" rows={3} value={form.description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t('descriptionPlaceholder')}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inc-website">
                <Globe className="me-1 inline size-3.5" />{t('labelWebsite')}
              </Label>
              <Input id="inc-website" type="url" value={form.website}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, website: e.target.value }))}
                placeholder="https://myincubator.dz" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('labelLogo')}</Label>
              <div className="flex gap-2">
                <Input value={form.logoUrl}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
                  placeholder={t('logoUrlPlaceholder')} />
                <Button type="button" variant="outline" size="icon"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  title={t('uploadLogoTitle')}>
                  <Upload className="size-4" />
                </Button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const f = e.target.files?.[0];
                    if (f) void handleImageUpload(f, 'logoUrl');
                    e.target.value = '';
                  }} />
              </div>
              {form.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.logoUrl} alt={t('logoPreviewAlt')}
                  className="mt-2 h-12 w-12 rounded object-contain border border-border" />
              )}
            </div>
          </div>

          {/* Official stamp / seal — printed at the bottom of receipts. */}
          <div className="space-y-1.5">
            <Label>{t('labelStamp')}</Label>
            <div className="flex gap-2">
              <Input value={form.stampUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, stampUrl: e.target.value }))}
                placeholder={t('stampUrlPlaceholder')} />
              <Button type="button" variant="outline" size="icon"
                disabled={uploadingStamp}
                onClick={() => stampRef.current?.click()}
                title={t('uploadStampTitle')}>
                <Upload className="size-4" />
              </Button>
              <input ref={stampRef} type="file" accept="image/png,image/jpeg,image/jpg" className="hidden"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImageUpload(f, 'stampUrl');
                  e.target.value = '';
                }} />
            </div>
            <p className="text-xs text-muted-foreground">{t('stampHint')}</p>
            {form.stampUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.stampUrl} alt={t('stampPreviewAlt')}
                className="mt-2 h-20 w-20 rounded object-contain border border-border bg-white p-1" />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Legal & Billing info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" /> {t('sectionLegal')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="inc-address">{t('labelAddress')}</Label>
            <Input id="inc-address" value={form.address}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder={t('addressPlaceholder')} />
            <p className="text-xs text-muted-foreground">{t('addressHint')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inc-rc">{t('labelRc')}</Label>
              <Input id="inc-rc" value={form.commercialRegNumber}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, commercialRegNumber: e.target.value }))}
                placeholder={t('rcPlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inc-nif">{t('labelNif')}</Label>
              <Input id="inc-nif" value={form.nif}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, nif: e.target.value }))}
                placeholder={t('nifPlaceholder')} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inc-nis">{t('labelNis')}</Label>
              <Input id="inc-nis" value={form.nis}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, nis: e.target.value }))}
                placeholder={t('nisPlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inc-ai">{t('labelAi')}</Label>
              <Input id="inc-ai" value={form.ai}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, ai: e.target.value }))}
                placeholder={t('aiPlaceholder')} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inc-bank-name">{t('labelBankName')}</Label>
              <Input id="inc-bank-name" value={form.bankName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                placeholder={t('bankNamePlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inc-bank-rib">{t('labelBankRib')}</Label>
              <Input id="inc-bank-rib" value={form.bankRib}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, bankRib: e.target.value }))}
                placeholder={t('bankRibPlaceholder')} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('bankHint')}</p>
        </CardContent>
      </Card>

      {/* Invoicing — footer contact, default VAT, PDF template */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="size-4" /> {t('sectionInvoicing')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inc-contact-email">{t('labelContactEmail')}</Label>
              <Input id="inc-contact-email" type="email" value={form.contactEmail}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                placeholder={t('contactEmailPlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inc-contact-phone">{t('labelContactPhone')}</Label>
              <Input id="inc-contact-phone" type="tel" value={form.contactPhone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                placeholder={t('contactPhonePlaceholder')} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('contactHint')}</p>

          <div className="max-w-[160px] space-y-1.5">
            <Label htmlFor="inc-vat">{t('labelDefaultVat')}</Label>
            <Input id="inc-vat" type="number" min="0" max="100" step="any" value={form.defaultVatRate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, defaultVatRate: e.target.value }))} />
            <p className="text-xs text-muted-foreground">{t('defaultVatHint')}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t('labelInvoiceTemplate')}</Label>
            <div className="grid max-w-md grid-cols-3 gap-3">
              {(['CLASSIC', 'GREEN_BAND', 'MINIMAL'] as const).map((tpl) => (
                <button
                  key={tpl}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, invoiceTemplate: tpl }))}
                  className={cn(
                    'group rounded-lg border-2 p-2 text-start transition-colors',
                    form.invoiceTemplate === tpl
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/40',
                  )}
                  aria-pressed={form.invoiceTemplate === tpl}
                >
                  <InvoiceTemplateThumb template={tpl} />
                  <p className={cn(
                    'mt-1.5 text-center text-xs font-medium',
                    form.invoiceTemplate === tpl ? 'text-primary' : 'text-muted-foreground',
                  )}>
                    {t(`template${tpl === 'CLASSIC' ? 'Classic' : tpl === 'GREEN_BAND' ? 'GreenBand' : 'Minimal'}`)}
                  </p>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t('invoiceTemplateHint')}</p>
          </div>
        </CardContent>
      </Card>

      {/* Billing */}
      {showSubscriptionTier && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="size-4" /> {t('sectionBilling')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <Label>{t('labelSubscriptionTier')}</Label>
              <Select
                value={form.subscriptionTier}
                onValueChange={(v) => setForm((f) => ({ ...f, subscriptionTier: v as 'COMMISSION' | 'FLAT' }))}
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMMISSION">{t('tierCommission')}</SelectItem>
                  <SelectItem value="FLAT">{t('tierFlat')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('tierSwitchHint')}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
          {t('successSaved')}
        </div>
      )}

      <div className="flex justify-end">
        <Button loading={saving} onClick={save} disabled={!form.incubatorName.trim()}>
          {t('saveChanges')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Pure-CSS miniature of each invoice PDF template, used by the template
 * chooser. Mirrors the real layouts: CLASSIC = letterhead + centered title
 * rule; GREEN_BAND = full-width brand band; MINIMAL = hairlines + whitespace.
 */
function InvoiceTemplateThumb({ template }: { template: InvoiceTemplate }) {
  const line = 'rounded-full bg-muted-foreground/30';
  return (
    <div className="aspect-[3/4] w-full overflow-hidden rounded-md border border-border bg-background p-1.5">
      {template === 'GREEN_BAND' ? (
        <div className="flex h-full flex-col gap-1">
          <div className="flex h-1/5 items-center justify-end rounded-sm bg-primary px-1">
            <div className="h-1 w-1/3 rounded-full bg-white/90" />
          </div>
          <div className="flex gap-1">
            <div className="flex-1 space-y-0.5">
              <div className={cn(line, 'h-0.5 w-4/5')} />
              <div className={cn(line, 'h-0.5 w-3/5')} />
            </div>
            <div className="flex-1 space-y-0.5">
              <div className={cn(line, 'h-0.5 w-4/5')} />
              <div className={cn(line, 'h-0.5 w-3/5')} />
            </div>
          </div>
          <div className="mt-auto space-y-0.5">
            <div className={cn(line, 'h-0.5 w-full')} />
            <div className={cn(line, 'h-0.5 w-full')} />
            <div className="ms-auto h-1 w-1/3 rounded-full bg-primary/70" />
          </div>
        </div>
      ) : template === 'MINIMAL' ? (
        <div className="flex h-full flex-col gap-1.5">
          <div className="flex items-start justify-between">
            <div className="size-2 rounded-sm bg-muted-foreground/25" />
            <div className={cn(line, 'h-1 w-2/5')} />
          </div>
          <div className="h-px w-full bg-foreground/50" />
          <div className="flex gap-1">
            <div className="flex-1 space-y-0.5">
              <div className={cn(line, 'h-0.5 w-4/5')} />
              <div className={cn(line, 'h-0.5 w-3/5')} />
            </div>
            <div className="flex-1 space-y-0.5">
              <div className={cn(line, 'h-0.5 w-4/5')} />
              <div className={cn(line, 'h-0.5 w-3/5')} />
            </div>
          </div>
          <div className="h-px w-full bg-foreground/50" />
          <div className="mt-auto space-y-0.5">
            <div className={cn(line, 'h-0.5 w-full')} />
            <div className="ms-auto h-1 w-1/3 rounded-full bg-primary/70" />
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col gap-1">
          <div className="flex items-start justify-between">
            <div className="size-2.5 rounded-sm bg-primary/60" />
            <div className="space-y-0.5">
              <div className={cn(line, 'h-0.5 w-6')} />
              <div className={cn(line, 'h-0.5 w-5')} />
              <div className={cn(line, 'h-0.5 w-6')} />
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <div className="h-px flex-1 bg-muted-foreground/40" />
            <div className={cn(line, 'h-1 w-1/4 bg-foreground/60')} />
            <div className="h-px flex-1 bg-muted-foreground/40" />
          </div>
          <div className="space-y-0.5">
            <div className={cn(line, 'h-0.5 w-1/2')} />
            <div className={cn(line, 'h-0.5 w-2/5')} />
          </div>
          <div className="mt-auto space-y-0.5">
            <div className={cn(line, 'h-0.5 w-full')} />
            <div className={cn(line, 'h-0.5 w-full')} />
            <div className="ms-auto h-1 w-1/3 rounded-full bg-primary/70" />
          </div>
        </div>
      )}
    </div>
  );
}
