/**
 * "Show this question only if…" rule for registration forms.
 *
 * A question may depend on ONE earlier question's answer: it is asked only
 * when that answer equals (or, for multi-select, includes) a chosen option.
 * Pure and client-safe — the public form uses it to skip steps as people
 * answer, and the server uses it so a question that was never shown is never
 * reported as "missing".
 *
 * The controlling question is referenced by its `order` (its position in the
 * saved list), not its id: a bulk save re-creates every field with a fresh id,
 * so an id would not survive the host editing the form. The builder re-points
 * the order on every save, and only allows an EARLIER question, so rules can
 * never form a cycle.
 */

export interface ShowWhen {
  /** `order` of the controlling question. Always lower than the dependent's. */
  order: number;
  /** The option that makes the dependent question appear. */
  equals: string;
}

interface ConditionalField {
  id: string;
  order: number;
  showWhen?: ShowWhen | null;
}

type AnswerValue = string | string[] | undefined;

/** Safety bound for a malformed chain; real forms nest one level at most. */
const MAX_DEPTH = 10;

export function isQuestionVisible(
  field: ConditionalField,
  fields: readonly ConditionalField[],
  answerOf: (fieldId: string) => AnswerValue,
  depth = 0,
): boolean {
  const rule = field.showWhen;
  if (!rule) return true;
  if (depth >= MAX_DEPTH) return true;

  const controller = fields.find((f) => f.order === rule.order);
  // A dangling or forward reference must never hide a question forever.
  if (!controller || controller.order >= field.order) return true;
  // A question that is itself hidden never gets answered, so it cannot unlock another.
  if (!isQuestionVisible(controller, fields, answerOf, depth + 1)) return false;

  const answer = answerOf(controller.id);
  if (Array.isArray(answer)) return answer.includes(rule.equals);
  return (answer ?? '').trim() === rule.equals;
}
