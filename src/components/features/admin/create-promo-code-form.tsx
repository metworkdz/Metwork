'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type AppliesTo = 'ALL' | 'MEMBERSHIP' | 'SPACE' | 'CONSULTATION';

interface FormState {
  code: string;
  discountPercent: string;
  appliesTo: AppliesTo;
  expiresAt: string;
  usageLimit: string;
}

const DEFAULT: FormState = {
  code: '',
  discountPercent: '',
  appliesTo: 'ALL',
  expiresAt: '',
  usageLimit: '',
};

export function CreatePromoCodeForm() {
  const t = useTranslations('admin.promoCodes');
  const router = useRouter();
  const [form, setForm] = useState<FormState>(DEFAULT);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function set(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
    setSuccess(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const discountNum = parseInt(form.discountPercent, 10);
    if (!form.code.trim()) { setError(t('codeRequired')); return; }
    if (isNaN(discountNum) || discountNum < 1 || discountNum > 100) {
      setError(t('discountRange'));
      return;
    }

    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/promo-codes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: form.code.trim().toUpperCase(),
            discountPercent: discountNum,
            appliesTo: form.appliesTo,
            expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
            usageLimit: form.usageLimit ? parseInt(form.usageLimit, 10) : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 409) setError(t('codeExists'));
          else setError(data.message ?? t('failed'));
          return;
        }
        setSuccess(t('success', { code: data.code }));
        setForm(DEFAULT);
        router.refresh();
      } catch {
        setError(t('networkError'));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField label={t('colCode')} htmlFor="pc-code" required>
        <Input
          id="pc-code"
          placeholder={t('codePlaceholder')}
          value={form.code}
          onChange={(e) => set('code', e.target.value.toUpperCase())}
          className="font-mono uppercase"
        />
      </FormField>

      <FormField label={t('colDiscount')} htmlFor="pc-discount" required>
        <Input
          id="pc-discount"
          type="number"
          min={1}
          max={100}
          placeholder="20"
          value={form.discountPercent}
          onChange={(e) => set('discountPercent', e.target.value)}
        />
      </FormField>

      <FormField label={t('colAppliesTo')} htmlFor="pc-applies">
        <Select
          value={form.appliesTo}
          onValueChange={(v) => set('appliesTo', v as AppliesTo)}
        >
          <SelectTrigger id="pc-applies">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('allPurchases')}</SelectItem>
            <SelectItem value="MEMBERSHIP">{t('membershipsOnly')}</SelectItem>
            <SelectItem value="SPACE">{t('spaceBookingsOnly')}</SelectItem>
            <SelectItem value="CONSULTATION">{t('consultationsOnly')}</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <FormField label={t('colExpiry')} htmlFor="pc-expires" hint={t('noExpiry')}>
        <Input
          id="pc-expires"
          type="datetime-local"
          value={form.expiresAt}
          onChange={(e) => set('expiresAt', e.target.value)}
        />
      </FormField>

      <FormField label={t('colUsageLimit')} htmlFor="pc-limit" hint={t('noLimit')}>
        <Input
          id="pc-limit"
          type="number"
          min={1}
          placeholder="100"
          value={form.usageLimit}
          onChange={(e) => set('usageLimit', e.target.value)}
        />
      </FormField>

      <div className="flex items-end">
        <Button type="submit" loading={isPending} className="w-full">
          {t('create')}
        </Button>
      </div>

      {error && (
        <p className="col-span-full text-sm text-destructive">{error}</p>
      )}
      {success && (
        <p className="col-span-full text-sm text-green-600">{success}</p>
      )}
    </form>
  );
}
