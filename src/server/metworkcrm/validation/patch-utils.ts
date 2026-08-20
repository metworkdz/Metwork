/**
 * `z.object().parse()` always materializes every schema key in its output,
 * setting absent optional fields to `undefined` rather than omitting them —
 * so `'field' in parsed` is true whether or not the client actually sent it.
 * Update services that need to tell "omitted" from "explicitly cleared" (e.g.
 * the crm_interactions/crm_tasks link-invariant check, which must merge the
 * patch onto the EXISTING row) can't rely on the parsed object's own keys.
 *
 * This rebuilds a patch containing only the keys present in the RAW request
 * body, using the zod-validated/coerced values for each. Pass the parsed
 * result through this before handing it to a service's update function.
 */
export function pickProvidedFields<T extends Record<string, unknown>>(
  rawBody: unknown,
  parsed: T,
): Partial<T> {
  if (typeof rawBody !== 'object' || rawBody === null) return {};
  const out: Partial<T> = {};
  for (const key of Object.keys(rawBody)) {
    if (key in parsed) out[key as keyof T] = parsed[key as keyof T];
  }
  return out;
}
