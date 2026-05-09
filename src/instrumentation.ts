/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to initialise Sentry for Node.js and Edge runtimes.
 *
 * Next.js automatically picks up this file; no config change is needed.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
