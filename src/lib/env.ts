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
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SMS_PROVIDER: z.string().transform(v => v.toLowerCase()).pipe(z.enum(['mock', 'twilio', 'local'])).default('mock'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
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
  // Mock provider mode: `sync` (default, settles immediately) or `async`
  // (returns PENDING + redirectUrl, exercises the webhook path locally).
  MOCK_PAYMENT_MODE: z.enum(['sync', 'async']).default('sync'),
});

const clientEnv = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
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
