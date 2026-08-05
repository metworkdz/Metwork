import { z } from 'zod';

/**
 * Schema for client-exposed env vars (must start with NEXT_PUBLIC_).
 * These are baked into the JS bundle at build time.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_NAME: z.string().default('Metwork'),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['en', 'fr', 'ar']).default('en'),
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  /**
   * PostHog public project API key (`phc_...`). Optional — analytics
   * no-op when absent so previews and dev builds aren't blocked.
   */
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  /**
   * PostHog API host. EU = https://eu.i.posthog.com (default, GDPR-friendly),
   * US = https://us.i.posthog.com.
   */
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().default('https://eu.i.posthog.com'),
});

/**
 * Schema for server-only env vars.
 * Never exposed to the client — accessing these on the client throws.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  AUTH_COOKIE_NAME: z.string().default('metwork_session'),
  AUTH_COOKIE_DOMAIN: z.string().default('localhost'),
  API_INTERNAL_URL: z.string().url(),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  // Accept any string value; unknown providers (e.g. 'twilio' set in Vercel)
  // are silently normalised to 'mock' so the build never hard-crashes on an
  // unrecognised value.
  SMS_PROVIDER: z
    .string()
    .transform((v): 'mock' | 'infobip' => {
      const lower = v.toLowerCase();
      return lower === 'infobip' ? 'infobip' : 'mock';
    })
    .default('mock'),
  // All Infobip vars are optional. Invalid / placeholder values (no protocol,
  // wrong format, etc.) are coerced to undefined so a misconfigured Vercel
  // variable never crashes the build — getConfig() returns null anyway when
  // any of the three is absent.
  INFOBIP_BASE_URL: z.preprocess((v) => {
    if (typeof v !== 'string' || v.trim() === '') return undefined;
    const t = v.trim();
    try { new URL(t); return t; } catch { return undefined; }
  }, z.string().url().optional()),
  INFOBIP_API_KEY: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined), z.string().optional()),
  INFOBIP_SENDER: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined), z.string().optional()),
  /**
   * Shared secret for cron-triggered routes (e.g. /api/cron/space-expiry).
   * Optional — when unset the cron routes reject all callers (locked down).
   */
  CRON_SECRET: z.string().optional(),
  PAYMENT_PROVIDER: z.string().transform(v => v.toLowerCase()).pipe(z.enum(['mock', 'slickpay', 'cib', 'edahabia'])).default('mock'),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  // SlickPay (Algerian processor). All optional — required only when
  // PAYMENT_PROVIDER=slickpay; the provider stub validates at runtime.
  SLICKPAY_PUBLIC_KEY: z.string().optional(),
  SLICKPAY_SECRET_KEY: z.string().optional(),
  SLICKPAY_WEBHOOK_SECRET: z.string().optional(),
  /** Preferred — overrides SLICKPAY_API_BASE when both are set. */
  SLICKPAY_BASE_URL: z.string().url().optional(),
  SLICKPAY_API_BASE: z.string().url().optional(),
  // Stripe (international Visa/Mastercard). NOT a PAYMENT_PROVIDER value —
  // it's chosen per-transaction by the payer at consultation checkout. Both
  // optional so the app boots without it; the provider fails closed at runtime
  // and the card option is hidden in the UI.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Mock provider mode: `sync` (default, settles immediately) or `async`
  // (returns PENDING + redirectUrl, exercises the webhook path locally).
  MOCK_PAYMENT_MODE: z.enum(['sync', 'async']).default('sync'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  /**
   * PostHog server-side API key (`phx_...`). Optional. Used only by
   * server-side `track()` calls so they reach PostHog directly instead
   * of relying on the browser to flush them. SAFE TO LEAK is FALSE —
   * keep this server-only.
   */
  POSTHOG_SERVER_KEY: z.string().optional(),
  // Zoom Server-to-Server OAuth app (auto-generated consultation meetings).
  // All optional — auto-generation is skipped (falls back to the manual
  // consultant-supplied link) whenever any of the three is absent.
  ZOOM_ACCOUNT_ID: z.string().optional(),
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(),
  /**
   * Anthropic API key for AI-assisted mentor recommendation. Optional —
   * the match endpoint fails gracefully to plain category browsing when
   * unset. Never exposed to the client.
   */
  ANTHROPIC_API_KEY: z.string().optional(),
});

const clientEnv = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
};

function parseClient() {
  const parsed = clientSchema.safeParse(clientEnv);
  if (!parsed.success) {
    console.error(
      '❌ Invalid client environment variables:',
      parsed.error.flatten().fieldErrors,
    );
    throw new Error('Invalid client environment variables');
  }
  return parsed.data;
}

function parseServer() {
  if (typeof window !== 'undefined') {
    throw new Error('Server env should not be accessed on the client.');
  }
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      '❌ Invalid server environment variables:',
      parsed.error.flatten().fieldErrors,
    );
    throw new Error('Invalid server environment variables');
  }
  return parsed.data;
}

/** Client-safe env vars (NEXT_PUBLIC_*). Available in browser & server. */
export const clientEnvVars = parseClient();

/** Server-only env vars. Throws if accessed in the browser. */
export const serverEnvVars = typeof window === 'undefined' ? parseServer() : ({} as never);
