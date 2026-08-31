export interface ApiErrorResponse {
  error?: {
    code?: string;
    message?: string;
    details?: { fieldErrors?: Record<string, string[]> };
  };
}

/**
 * Every CRM validation failure comes back as `{error:{code:'VALIDATION_ERROR',
 * message:'Invalid input', details:{fieldErrors}}}` (see `fromZod` in
 * `src/server/http/json.ts`) — the top-level message is deliberately generic
 * for every field, while the actual reason (e.g. "L'objet est requis.",
 * "Rattachez cette tâche à au moins un élément.") only exists in
 * `details.fieldErrors`. Showing `error.message` alone told the user
 * something was wrong without ever saying what — this surfaces the first
 * real field message instead, falling back to the generic one for
 * non-validation errors (which have no `fieldErrors` to dig into).
 */
export function extractApiErrorMessage(data: ApiErrorResponse, fallback = 'Une erreur est survenue.'): string {
  const fieldErrors = data.error?.details?.fieldErrors;
  const firstField = fieldErrors ? Object.values(fieldErrors).flat().find(Boolean) : undefined;
  return firstField ?? data.error?.message ?? fallback;
}
