/**
 * Browser-safe UUID v4.
 *
 * `crypto.randomUUID()` is only available in secure contexts AND was added to
 * WebKit/Safari in iOS 15.4. Older iPhones (still in the wild) throw
 * "undefined is not a function" when it's called during render or in an event
 * handler, which surfaces the App Router error boundary. This helper prefers
 * the native API, falls back to a `getRandomValues`-seeded RFC 4122 v4 string,
 * and finally to `Math.random` if web-crypto is entirely absent.
 *
 * The output is used as a client-side idempotency key, so the non-native
 * fallbacks do not need to be cryptographically strong — only unique enough to
 * dedupe a retried submit.
 */
const HEX: string[] = [];
for (let i = 0; i < 256; i++) HEX.push((i + 0x100).toString(16).slice(1));

export function safeUUID(): string {
  const c: Crypto | undefined =
    typeof globalThis !== 'undefined'
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;

  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* fall through to the manual path */
    }
  }

  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(b);
  } else {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 §4.4 — set version (4) and variant (10) bits.
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;

  const h: string[] = [];
  for (let i = 0; i < 16; i++) h.push(HEX[b[i] ?? 0] ?? '00');

  return (
    h.slice(0, 4).join('') + '-' +
    h.slice(4, 6).join('') + '-' +
    h.slice(6, 8).join('') + '-' +
    h.slice(8, 10).join('') + '-' +
    h.slice(10, 16).join('')
  );
}
