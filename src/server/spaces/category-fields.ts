/**
 * Shared validation/normalisation for category-specific space fields, used by
 * BOTH the create (POST) and edit (PATCH) routes so the rules can't diverge.
 *
 *  - COWORKING     → at least one desk, names trimmed, non-empty, unique
 *                    (case-insensitively).
 *  - DOMICILIATION → at least one address slot.
 *
 * Pure & framework-agnostic: returns an error string (or null) and cleaned
 * values; the caller decides how to surface it.
 */

/** Trim each name and drop empties. */
export function cleanDeskNames(names: string[] | undefined): string[] {
  return (names ?? []).map((n) => n.trim()).filter(Boolean);
}

/**
 * Validate a coworking desk-name list. Returns null when valid, else a message.
 * Requires ≥1 desk and case-insensitively unique names (after trimming).
 */
export function validateDeskNames(names: string[] | undefined): string | null {
  const cleaned = cleanDeskNames(names);
  if (cleaned.length === 0) return 'A coworking space needs at least one desk';
  const lower = cleaned.map((n) => n.toLowerCase());
  if (new Set(lower).size !== lower.length) return 'Desk names must be unique';
  return null;
}

/** Validate the domiciliation slot count. Returns null when valid, else a message. */
export function validateDomiciliationSlots(slots: number | null | undefined): string | null {
  if (slots == null || !Number.isInteger(slots) || slots < 1) {
    return 'Domiciliation requires at least 1 address slot';
  }
  return null;
}
