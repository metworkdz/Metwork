/**
 * Returns a safe LinkedIn URL or null. Requires `https://` and a
 * `linkedin.com` host — anything else is dropped so we never render
 * an outbound link to an arbitrary site. Shared by every mentor surface.
 */
export function safeLinkedinUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'https:') return null;
    if (!u.hostname.toLowerCase().endsWith('linkedin.com')) return null;
    return u.toString();
  } catch {
    return null;
  }
}
