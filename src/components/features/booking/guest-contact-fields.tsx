'use client';

/**
 * Contact fields collected from a GUEST (not-logged-in) client before a
 * card-settled booking. The card flow needs a name / email / phone for the
 * receipt and the hosted-checkout customer. Registered clients never see this
 * — their profile details are used instead.
 *
 * Controlled component: the parent form owns the state so it can validate and
 * submit. No card data is ever collected here — payment happens on the hosted
 * checkout page.
 */
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface GuestContact {
  fullName: string;
  email: string;
  phone: string;
}

export const emptyGuestContact: GuestContact = { fullName: '', email: '', phone: '' };

/** Lightweight client-side validity check (the server validates authoritatively). */
export function isGuestContactValid(c: GuestContact): boolean {
  return (
    c.fullName.trim().length >= 2 &&
    /^\S+@\S+\.\S+$/.test(c.email.trim()) &&
    c.phone.trim().length >= 6
  );
}

export function GuestContactFields({
  value,
  onChange,
  disabled,
  idPrefix = 'guest',
}: {
  value: GuestContact;
  onChange: (next: GuestContact) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const t = useTranslations('booking.guest');
  const set =
    (key: keyof GuestContact) => (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, [key]: e.target.value });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">{t('title')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor={`${idPrefix}-name`}>{t('fullName')}</Label>
          <Input
            id={`${idPrefix}-name`}
            className="mt-1.5"
            value={value.fullName}
            onChange={set('fullName')}
            disabled={disabled}
            autoComplete="name"
            required
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-email`}>{t('email')}</Label>
          <Input
            id={`${idPrefix}-email`}
            className="mt-1.5"
            type="email"
            value={value.email}
            onChange={set('email')}
            disabled={disabled}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-phone`}>{t('phone')}</Label>
          <Input
            id={`${idPrefix}-phone`}
            className="mt-1.5"
            type="tel"
            value={value.phone}
            onChange={set('phone')}
            disabled={disabled}
            autoComplete="tel"
            required
          />
        </div>
      </div>
    </div>
  );
}
