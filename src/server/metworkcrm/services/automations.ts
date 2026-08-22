/**
 * METWORK OS CRM — Automations (product spec §4.17, dev rules R-22/R-23).
 *
 * Every automation here runs AFTER its triggering write has already
 * committed, from inside the same service call, and is wrapped so a failure
 * can never fail or roll back that write (R-22 — "aucune automatisation ne
 * participe à la transaction principale"). Idempotent via the unique partial
 * index on `crm_tasks.automation_key` (R-23) — a retry, a duplicate sweep
 * tick, or a replayed event never creates a duplicate task. Every attempt is
 * logged to `crm_automation_runs`: one `OK` row when a task is actually
 * created, one `ERREUR` row (with the message) on failure. A no-op (the
 * automation key already exists) logs nothing — it was already logged the
 * first time it succeeded.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import { crmAutomationRuns, crmTasks } from '../db/schema';

type TaskLinks = Partial<
  Record<
    | 'organizationId'
    | 'contactId'
    | 'opportunityId'
    | 'startupId'
    | 'expertId'
    | 'partnershipId'
    | 'programId'
    | 'oiProjectId'
    | 'bookingId'
    | 'paymentId',
    string
  >
>;

interface AutomationTaskInput {
  title: string;
  automationKey: string;
  priority?: 'URGENTE' | 'HAUTE' | 'MOYENNE' | 'BASSE';
  dueDate?: string | null;
  assigneeId?: string | null;
  links: TaskLinks;
}

/**
 * Insert one automation-generated task, idempotent on `automationKey`.
 * Returns `true` if a new row was actually created, `false` if it already
 * existed (nothing to do — not an error).
 */
async function insertAutomationTask(input: AutomationTaskInput): Promise<boolean> {
  const db = getCrmDb();
  const existing = await db
    .select({ id: crmTasks.id })
    .from(crmTasks)
    .where(eq(crmTasks.automationKey, input.automationKey))
    .limit(1);
  if (existing.length > 0) return false;

  const now = new Date().toISOString();
  await db
    .insert(crmTasks)
    .values({
      id: randomUUID(),
      title: input.title,
      priority: input.priority ?? 'MOYENNE',
      status: 'A_FAIRE',
      dueDate: input.dueDate ?? null,
      assigneeId: input.assigneeId ?? null,
      source: 'AUTOMATION',
      automationKey: input.automationKey,
      ...input.links,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  return true;
}

async function logRun(params: {
  automationKey: string;
  rule: string;
  triggerEntityType: string;
  triggerEntityId: string;
  status: 'OK' | 'ERREUR';
  error?: string;
}): Promise<void> {
  const db = getCrmDb();
  await db.insert(crmAutomationRuns).values({
    id: randomUUID(),
    automationKey: params.automationKey,
    rule: params.rule,
    triggerEntityType: params.triggerEntityType,
    triggerEntityId: params.triggerEntityId,
    status: params.status,
    error: params.error ?? null,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Runs `fn`, swallowing and logging any error instead of letting it
 * propagate — the one rule every automation call site depends on (R-22).
 * Logs an `OK` run only when `fn` reports it actually created something
 * (returned `true`); a no-op (already ran) logs nothing.
 */
async function runNonBlocking(params: {
  automationKey: string;
  rule: string;
  triggerEntityType: string;
  triggerEntityId: string;
  fn: () => Promise<boolean>;
}): Promise<void> {
  try {
    const created = await params.fn();
    if (created) {
      await logRun({
        automationKey: params.automationKey,
        rule: params.rule,
        triggerEntityType: params.triggerEntityType,
        triggerEntityId: params.triggerEntityId,
        status: 'OK',
      });
    }
  } catch (err) {
    console.error(`[metworkcrm] automation "${params.rule}" failed:`, err);
    try {
      await logRun({
        automationKey: params.automationKey,
        rule: params.rule,
        triggerEntityType: params.triggerEntityType,
        triggerEntityId: params.triggerEntityId,
        status: 'ERREUR',
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // Logging itself failed — nothing more we can safely do without risking
      // the triggering write. Already printed above.
    }
  }
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Opportunité → PROPOSITION_ENVOYEE : tâche « Relance dans 3 jours ».
 *
 * Callers MUST `await` this (never fire-and-forget): on Vercel serverless the
 * function instance can be frozen the moment the response is sent, so an
 * un-awaited promise risks never finishing. `runNonBlocking` already
 * guarantees this can't fail the CALLER's request — awaiting only guarantees
 * it gets to actually run.
 */
export async function runProposalFollowupAutomation(opportunity: {
  id: string;
  title: string;
  organizationId: string | null;
  contactId: string | null;
  ownerId: string | null;
  stageChangedAt: string;
}): Promise<void> {
  await runNonBlocking({
    automationKey: `opp-proposal-followup:${opportunity.id}:${opportunity.stageChangedAt}`,
    rule: 'opportunity-proposal-followup',
    triggerEntityType: 'OPPORTUNITY',
    triggerEntityId: opportunity.id,
    fn: () =>
      insertAutomationTask({
        title: `Relance dans 3 jours — ${opportunity.title}`,
        automationKey: `opp-proposal-followup:${opportunity.id}:${opportunity.stageChangedAt}`,
        priority: 'HAUTE',
        dueDate: addDays(opportunity.stageChangedAt, 3),
        assigneeId: opportunity.ownerId,
        links: {
          opportunityId: opportunity.id,
          organizationId: opportunity.organizationId ?? undefined,
          contactId: opportunity.contactId ?? undefined,
        },
      }),
  });
}

/** Paiement en retard : tâche « Relance paiement » (one-shot, ADMIN-only module — no assignee). */
export async function runPaymentOverdueAutomation(payment: { id: string; label: string; organizationId: string | null; contactId: string | null }): Promise<void> {
  const automationKey = `payment-overdue-task:${payment.id}`;
  await runNonBlocking({
    automationKey,
    rule: 'payment-overdue-reminder',
    triggerEntityType: 'PAYMENT',
    triggerEntityId: payment.id,
    fn: () =>
      insertAutomationTask({
        title: `Relance paiement — ${payment.label}`,
        automationKey,
        priority: 'URGENTE',
        links: {
          paymentId: payment.id,
          organizationId: payment.organizationId ?? undefined,
          contactId: payment.contactId ?? undefined,
        },
      }),
  });
}

/**
 * Startup → ONBOARDING : jeu de tâches d'onboarding.
 * Proposed 5-item default (product spec doesn't enumerate this set the way
 * it does for Programs) — see SESSION_LOG for the flagged decision.
 */
const STARTUP_ONBOARDING_TASKS = [
  "Convention / contrat d'incubation envoyé",
  'Accès espace / coworking configuré',
  "Kickoff planifié avec l'expert assigné",
  'Dossier de suivi créé',
  'Kit de bienvenue envoyé',
] as const;

export async function runStartupOnboardingAutomation(startup: {
  id: string;
  displayName: string;
  organizationId: string | null;
  primaryContactId: string | null;
  assignedExpertId: string | null;
  stageChangedAt: string;
}): Promise<void> {
  for (const title of STARTUP_ONBOARDING_TASKS) {
    const automationKey = `startup-onboarding:${startup.id}:${startup.stageChangedAt}:${title}`;
    await runNonBlocking({
      automationKey,
      rule: 'startup-onboarding-checklist',
      triggerEntityType: 'STARTUP',
      triggerEntityId: startup.id,
      fn: () =>
        insertAutomationTask({
          title: `${title} — ${startup.displayName}`,
          automationKey,
          links: {
            startupId: startup.id,
            organizationId: startup.organizationId ?? undefined,
            contactId: startup.primaryContactId ?? undefined,
            expertId: startup.assignedExpertId ?? undefined,
          },
        }),
    });
  }
}

/** Programme créé : checklist standard (10 items, product spec §4.17). */
const PROGRAM_CHECKLIST_ITEMS = [
  'Formateur',
  'Salle',
  'Visuel',
  'Communication',
  'Inscriptions',
  'Paiement',
  'Supports',
  'Certificats',
  'Feedback',
  'Reporting',
] as const;

export async function runProgramChecklistAutomation(program: { id: string; title: string; ownerId: string | null }): Promise<void> {
  for (const item of PROGRAM_CHECKLIST_ITEMS) {
    const automationKey = `program-checklist:${program.id}:${item}`;
    await runNonBlocking({
      automationKey,
      rule: 'program-creation-checklist',
      triggerEntityType: 'PROGRAM',
      triggerEntityId: program.id,
      fn: () =>
        insertAutomationTask({
          title: `${item} — ${program.title}`,
          automationKey,
          assigneeId: program.ownerId,
          links: { programId: program.id },
        }),
    });
  }
}

/** Exported for the notification sweep, which shares the same idempotent-insert plumbing. */
export { insertAutomationTask, runNonBlocking };
