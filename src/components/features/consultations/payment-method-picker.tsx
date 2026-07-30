'use client';

/**
 * Payment-method picker for consultation checkout.
 *
 * Three selectable cards — never a dropdown, never a silent default charge:
 *   • Metwork wallet      (offered only when the balance covers the amount)
 *   • CIB / Edahabia      (local card, billed in DZD)
 *   • Visa / Mastercard   (international card)
 *
 * Money rules this component obeys:
 *  - It NEVER computes a price. Every figure it renders — the DZD total, the
 *    "≈ €X" line, which methods are offerable — comes from
 *    GET /api/consultations/quote.
 *  - The DZD amount is always the prominent one.
 *  - The exchange rate is never shown, and the word "rate" never appears.
 */
import { CreditCard, Wallet, Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { siteConfig } from '@/config/site';

export type ConsultationPaymentMethod = 'WALLET' | 'SLICKPAY' | 'STRIPE';

export interface ConsultationQuote {
  amountDzd: number;
  walletBalance: number;
  walletCovers: boolean;
  methods: Record<ConsultationPaymentMethod, boolean>;
  amountEur: number | null;
}

interface Props {
  quote: ConsultationQuote;
  value: ConsultationPaymentMethod | null;
  onChange: (method: ConsultationPaymentMethod) => void;
  disabled?: boolean;
  locale: string;
}

function intlLocale(locale: string): string {
  if (locale === 'ar') return 'ar-DZ';
  if (locale === 'en') return 'en-GB';
  return 'fr-DZ';
}

export function PaymentMethodPicker({ quote, value, onChange, disabled, locale }: Props) {
  const t = useTranslations('consultations.payment');
  const fmtDzd = (n: number) => `${n.toLocaleString(intlLocale(locale))} DZD`;
  // Always fr-style 2dp for EUR — it's a secondary, informational figure.
  const fmtEur = (n: number) =>
    new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);

  const options: {
    method: ConsultationPaymentMethod;
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    trailing?: string;
  }[] = [];

  if (quote.methods.WALLET) {
    options.push({
      method: 'WALLET',
      icon: <Wallet className="size-4" />,
      title: t('walletTitle'),
      subtitle: t('walletBalance', { amount: fmtDzd(quote.walletBalance) }),
    });
  }
  if (quote.methods.SLICKPAY) {
    options.push({
      method: 'SLICKPAY',
      icon: <CreditCard className="size-4" />,
      title: t('cibTitle'),
      subtitle: t('cibSubtitle'),
    });
  }
  if (quote.methods.STRIPE) {
    options.push({
      method: 'STRIPE',
      icon: <Globe className="size-4" />,
      title: t('internationalTitle'),
      subtitle: t('internationalSubtitle'),
      // Secondary, muted — the DZD total below is the price.
      trailing: quote.amountEur != null ? `≈ ${fmtEur(quote.amountEur)}` : undefined,
    });
  }

  if (options.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('chooseMethod')}
      </p>

      <div
        role="radiogroup"
        aria-label={t('chooseMethod')}
        className="space-y-2"
      >
        {options.map((opt) => {
          const selected = value === opt.method;
          return (
            <button
              key={opt.method}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(opt.method)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-start transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-60',
                selected
                  ? 'border-[#30a735] bg-[#30a735]/5'
                  : 'border-border/60 bg-background hover:border-[#30a735]/40 hover:bg-accent',
              )}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-md',
                  selected ? 'bg-[#30a735] text-white' : 'bg-muted text-foreground',
                )}
              >
                {opt.icon}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block font-grotesk text-sm font-semibold text-[#0D0D0D] dark:text-foreground">
                  {opt.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{opt.subtitle}</span>
              </span>

              {opt.trailing && (
                <span className="shrink-0 font-grotesk text-xs tabular-nums text-muted-foreground">
                  {opt.trailing}
                </span>
              )}

              {/* Radio affordance, kept at the end so RTL mirrors correctly. */}
              <span
                aria-hidden
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border',
                  selected ? 'border-[#30a735]' : 'border-muted-foreground/40',
                )}
              >
                {selected && <span className="size-2 rounded-full bg-[#30a735]" />}
              </span>
            </button>
          );
        })}
      </div>

      {/* The DZD price is the price. */}
      <div className="flex items-baseline justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
        <span className="text-sm font-medium text-muted-foreground">{t('totalLabel')}</span>
        <span className="font-grotesk text-lg font-bold tabular-nums text-[#0D0D0D] dark:text-foreground">
          {fmtDzd(quote.amountDzd)}
        </span>
      </div>

      {/*
        Who the payer is actually contracting with, disclosed at the point of
        payment rather than only in the Terms — this is also the name that will
        appear on their card statement, which is what prevents "unrecognised
        charge" disputes. Shown only for the international card.
      */}
      {value === 'STRIPE' && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('internationalProcessor', {
            company: siteConfig.entities.internationalPayments.name,
            country: t('internationalCountryName'),
          })}
        </p>
      )}
    </div>
  );
}
