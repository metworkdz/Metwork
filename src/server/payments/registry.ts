/**
 * Payment-provider registry. Maps provider codes to implementations.
 *
 * `getActiveProvider()` is what the wallet service uses for new top-ups.
 * `getProviderByCode()` is what the webhook route uses to dispatch
 * inbound callbacks to the right verifier.
 */
import { serverEnvVars } from '@/lib/env';
import { mockProvider } from './mock-provider';
import { slickpayProvider } from './slickpay-provider';
import { stripeProvider } from './stripe-provider';
import type { PaymentProvider } from './provider';

const providers: Record<string, PaymentProvider> = {
  mock: mockProvider,
  slickpay: slickpayProvider,
  // Registered so the webhook dispatcher can resolve it, but NOT selectable via
  // PAYMENT_PROVIDER: Stripe is chosen per-transaction by the payer at
  // consultation checkout. Every other flow stays on the env-configured
  // provider (SlickPay in production).
  stripe: stripeProvider,
};

export function getActiveProvider(): PaymentProvider {
  const code = serverEnvVars.PAYMENT_PROVIDER;
  if (process.env.NODE_ENV === 'production' && (providers[code] === undefined || providers[code] === mockProvider)) {
    throw new Error(`[FATAL] PAYMENT_PROVIDER="${code}" is not a real provider. Set PAYMENT_PROVIDER to a valid value in production.`);
  }
  return providers[code] ?? mockProvider;
}

export function getProviderByCode(code: string): PaymentProvider | null {
  return providers[code] ?? null;
}

export function listRegisteredProviders(): string[] {
  return Object.keys(providers);
}
