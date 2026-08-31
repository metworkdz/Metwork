import { describe, it, expect } from 'vitest';
import { extractApiErrorMessage } from '@/components/metworkcrm/shared/api-error';

/**
 * Regression coverage for a real bug: every CRM create/edit dialog showed
 * the server's generic top-level VALIDATION_ERROR message ("Invalid input",
 * see `fromZod` in src/server/http/json.ts) and never looked at
 * `details.fieldErrors`, which is where the actual reason lives (e.g.
 * "Rattachez cette tâche à au moins un élément."). Users filling in a
 * task/interaction/etc. and forgetting to link an organization or contact —
 * the linked-entity fields aren't visually marked required — got "Invalid
 * input" with zero indication of what to fix. Reproduced live via the
 * Tasks dialog before this fix existed (see SESSION_LOG.md).
 */
describe('extractApiErrorMessage', () => {
  it('prefers the first field-level message over the generic top-level one', () => {
    const data = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { fieldErrors: { organizationId: ['Rattachez cette tâche à au moins un élément.'] } },
      },
    };
    expect(extractApiErrorMessage(data)).toBe('Rattachez cette tâche à au moins un élément.');
  });

  it('falls back to the top-level message when there are no field errors', () => {
    const data = { error: { code: 'CRM_INTERNAL_ERROR', message: 'Une erreur interne est survenue.' } };
    expect(extractApiErrorMessage(data)).toBe('Une erreur interne est survenue.');
  });

  it('falls back to the caller-supplied default when the body has no error at all', () => {
    expect(extractApiErrorMessage({}, 'Modification impossible.')).toBe('Modification impossible.');
  });

  it('skips an empty field-errors array and falls through to the next field', () => {
    const data = {
      error: {
        message: 'Invalid input',
        details: { fieldErrors: { subject: [], organizationId: ['Rattachez cette tâche à au moins un élément.'] } },
      },
    };
    expect(extractApiErrorMessage(data)).toBe('Rattachez cette tâche à au moins un élément.');
  });
});
