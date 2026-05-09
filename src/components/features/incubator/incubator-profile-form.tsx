'use client';

/**
 * Incubator profile settings form.
 * Lets the incubator update: name, description, city, website, logo, subscription tier.
 * Also updates the manager's personal fullName and avatar.
 */
import { useRef, useState } from 'react';
import { Building2, Upload, Globe, CreditCard, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AvatarUpload } from '@/components/shared/avatar-upload';
import type { IncubatorRecord, UserRecord } from '@/server/db/store';

interface Props {
  incubator: IncubatorRecord;
  user: Pick<UserRecord, 'id' | 'fullName' | 'email' | 'avatarUrl'>;
}

export function IncubatorProfileForm({ incubator, user }: Props) {
  const [form, setForm] = useState({
    incubatorName: incubator.name,
    description: incubator.description,
    city: incubator.city,
    website: incubator.website ?? '',
    logoUrl: incubator.logoUrl ?? '',
    subscriptionTier: incubator.subscriptionTier,
    address: incubator.address ?? '',
    commercialRegNumber: incubator.commercialRegNumber ?? '',
    nif: incubator.nif ?? '',
    fullName: user.fullName,
    avatarUrl: user.avatarUrl ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleLogoUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/incubator/upload', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json() as { url: string };
      setForm((f) => ({ ...f, logoUrl: data.url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
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
          subscriptionTier: form.subscriptionTier,
          address: form.address.trim() || null,
          commercialRegNumber: form.commercialRegNumber.trim() || null,
          nif: form.nif.trim() || null,
          fullName: form.fullName.trim(),
          avatarUrl: form.avatarUrl.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
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
            <Building2 className="size-4" /> Manager profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mgr-name">Your full name</Label>
              <Input id="mgr-name" value={form.fullName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email (read-only)</Label>
              <Input value={user.email} disabled />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Profile picture</Label>
            <div className="flex items-center gap-4">
              <AvatarUpload
                currentUrl={form.avatarUrl || null}
                fallbackInitials={form.fullName}
                onUpload={(url) => setForm((f) => ({ ...f, avatarUrl: url }))}
                onError={(msg) => setError(msg)}
                size="size-16"
              />
              <div>
                <p className="text-sm text-muted-foreground">Click to upload a profile photo</p>
                <p className="text-xs text-muted-foreground">JPG, PNG, WebP — max 5 MB</p>
              </div>
            </div>
            <Input id="mgr-avatar" value={form.avatarUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, avatarUrl: e.target.value }))}
              placeholder="Or paste a URL: https://…" />
          </div>
        </CardContent>
      </Card>

      {/* Incubator info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" /> Incubator profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inc-name">Incubator name *</Label>
              <Input id="inc-name" value={form.incubatorName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, incubatorName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inc-city">City *</Label>
              <Input id="inc-city" value={form.city}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inc-desc">Description</Label>
            <textarea id="inc-desc" rows={3} value={form.description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Describe your incubator, mission, history…"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inc-website">
                <Globe className="me-1 inline size-3.5" />Website
              </Label>
              <Input id="inc-website" type="url" value={form.website}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, website: e.target.value }))}
                placeholder="https://myincubator.dz" />
            </div>
            <div className="space-y-1.5">
              <Label>Logo</Label>
              <div className="flex gap-2">
                <Input value={form.logoUrl}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
                  placeholder="https://… or upload below" />
                <Button type="button" variant="outline" size="icon"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  title="Upload logo">
                  <Upload className="size-4" />
                </Button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const f = e.target.files?.[0];
                    if (f) void handleLogoUpload(f);
                    e.target.value = '';
                  }} />
              </div>
              {form.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.logoUrl} alt="Logo preview"
                  className="mt-2 h-12 w-12 rounded object-contain border border-border" />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Legal & Billing info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" /> Legal &amp; billing info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="inc-address">Address</Label>
            <Input id="inc-address" value={form.address}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="Street address, city, postal code…" />
            <p className="text-xs text-muted-foreground">Shown on printed receipts.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inc-rc">Commercial register number (RC)</Label>
              <Input id="inc-rc" value={form.commercialRegNumber}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, commercialRegNumber: e.target.value }))}
                placeholder="e.g. 16/00-0000000B00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inc-nif">Tax ID (NIF)</Label>
              <Input id="inc-nif" value={form.nif}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, nif: e.target.value }))}
                placeholder="e.g. 000000000000000" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="size-4" /> Billing plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label>Subscription tier</Label>
            <Select
              value={form.subscriptionTier}
              onValueChange={(v) => setForm((f) => ({ ...f, subscriptionTier: v as 'COMMISSION' | 'FLAT' }))}
            >
              <SelectTrigger className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="COMMISSION">Commission (20% per booking)</SelectItem>
                <SelectItem value="FLAT">Flat rate (6 000 DZD/month, keep 100%)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Contact support to switch from Commission to Flat if you have an active subscription.
            </p>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
          Profile saved successfully.
        </div>
      )}

      <div className="flex justify-end">
        <Button loading={saving} onClick={save} disabled={!form.incubatorName.trim()}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
