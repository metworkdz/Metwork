/**
 * METWORK OS CRM — Notifications (product spec §4.16, Prompt 7).
 *
 * In-app only for v1 — no WhatsApp/email (see SESSION_LOG). Five trigger
 * types are TIME-based (task due today, follow-up due, payment overdue,
 * meeting in 30 min, opportunity inactive 7+ days) rather than tied to a
 * single write, so they can't hook into one service call the way the
 * event-triggered automations in `automations.ts` do. `syncNotifications()`
 * is a lazy sweep instead of a cron (owner decision, see SESSION_LOG — no
 * platform-file changes outside `/metworkcrm`): it runs inline whenever
 * `GET /api/metworkcrm/notifications` is called, i.e. whenever a
 * notification-bell component polls. It is GLOBAL, not scoped to the
 * requester — it finds the correct recipient for every due item (the task's
 * assignee, the interaction's logger, the opportunity's owner, every active
 * ADMIN for payments) and writes each one's notification row, so anyone's
 * bell fills in as long as *someone* is polling.
 *
 * Idempotent throughout via `crm_notifications.dedupe_key` (unique partial
 * index, Prompt 1): every check's SQL excludes candidates that already have
 * a matching dedupe key via `NOT EXISTS`, and every insert carries a final
 * `onConflictDoNothing()` as a race-safety net for concurrent pollers.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import { crmNotifications, type NotificationType } from '../db/schema';
import { runPaymentOverdueAutomation } from './automations';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function insertNotification(input: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  dedupeKey: string;
}): Promise<void> {
  const db = getCrmDb();
  await db
    .insert(crmNotifications)
    .values({
      id: randomUUID(),
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      read: false,
      readAt: null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      dedupeKey: input.dedupeKey,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
}

/** One sweep check, isolated: a failure here must not stop the other four. */
async function safely(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[metworkcrm] notification sweep "${label}" failed:`, err);
  }
}

async function syncTaskDueToday(): Promise<void> {
  const db = getCrmDb();
  const t = today();
  const rows = await db.all<{ id: string; title: string; assigneeId: string }>(sql`
    SELECT t.id, t.title, t.assignee_id AS assigneeId
    FROM crm_tasks t
    WHERE t.status != 'TERMINEE' AND t.due_date = ${t} AND t.assignee_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM crm_notifications n
        WHERE n.dedupe_key = 'tache-due:' || t.id || ':' || t.assignee_id || ':' || t.due_date
      )
  `);
  for (const row of rows) {
    await insertNotification({
      userId: row.assigneeId,
      type: 'TACHE_DUE',
      title: 'Tâche à échéance aujourd’hui',
      body: row.title,
      href: '/metworkcrm/tasks',
      entityType: 'TASK',
      entityId: row.id,
      dedupeKey: `tache-due:${row.id}:${row.assigneeId}:${t}`,
    });
  }
}

async function syncFollowUpDueToday(): Promise<void> {
  const db = getCrmDb();
  const t = today();
  const rows = await db.all<{ id: string; subject: string; createdBy: string }>(sql`
    SELECT i.id, i.subject, i.created_by AS createdBy
    FROM crm_interactions i
    WHERE i.next_action_done = 0 AND i.next_action_date = ${t} AND i.created_by IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM crm_notifications n
        WHERE n.dedupe_key = 'relance-due:' || i.id || ':' || i.created_by || ':' || i.next_action_date
      )
  `);
  for (const row of rows) {
    await insertNotification({
      userId: row.createdBy,
      type: 'RELANCE_DUE',
      title: 'Relance à échéance aujourd’hui',
      body: row.subject,
      href: '/metworkcrm/activities',
      entityType: 'INTERACTION',
      entityId: row.id,
      dedupeKey: `relance-due:${row.id}:${row.createdBy}:${t}`,
    });
  }
}

async function syncPaymentOverdue(): Promise<void> {
  const db = getCrmDb();
  const t = today();
  const overdue = await db.all<{ id: string; label: string; organizationId: string | null; contactId: string | null }>(sql`
    SELECT p.id, p.label, p.organization_id AS organizationId, p.contact_id AS contactId
    FROM crm_payments p
    WHERE p.due_date < ${t} AND p.status IN ('EN_ATTENTE', 'RELANCE_1', 'RELANCE_2')
      AND NOT EXISTS (SELECT 1 FROM crm_tasks WHERE automation_key = 'payment-overdue-task:' || p.id)
  `);
  if (overdue.length === 0) return;

  const admins = await db.all<{ id: string }>(sql`SELECT id FROM internal_users WHERE role = 'ADMIN' AND is_active = 1`);

  for (const payment of overdue) {
    // Non-blocking automation (R-22/R-23) — creates the one-shot "Relance
    // paiement" task; this is the anchor that makes the whole payment
    // one-shot (see the NOT EXISTS above), not a per-notification concern.
    await runPaymentOverdueAutomation(payment);
    for (const admin of admins) {
      await insertNotification({
        userId: admin.id,
        type: 'PAIEMENT_RETARD',
        title: 'Paiement en retard',
        body: payment.label,
        href: '/metworkcrm/payments',
        entityType: 'PAYMENT',
        entityId: payment.id,
        dedupeKey: `paiement-retard:${payment.id}:${admin.id}`,
      });
    }
  }
}

async function syncMeetingSoon(): Promise<void> {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const in30min = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const rows = await db.all<{ id: string; title: string; assigneeId: string; dueAt: string }>(sql`
    SELECT t.id, t.title, t.assignee_id AS assigneeId, t.due_at AS dueAt
    FROM crm_tasks t
    WHERE t.status != 'TERMINEE' AND t.assignee_id IS NOT NULL
      AND t.due_at IS NOT NULL AND t.due_at BETWEEN ${now} AND ${in30min}
      AND NOT EXISTS (
        SELECT 1 FROM crm_notifications n
        WHERE n.dedupe_key = 'reunion-30min:' || t.id || ':' || t.assignee_id || ':' || t.due_at
      )
  `);
  for (const row of rows) {
    await insertNotification({
      userId: row.assigneeId,
      type: 'REUNION_30MIN',
      title: 'Réunion dans 30 minutes',
      body: row.title,
      href: '/metworkcrm/tasks',
      entityType: 'TASK',
      entityId: row.id,
      dedupeKey: `reunion-30min:${row.id}:${row.assigneeId}:${row.dueAt}`,
    });
  }
}

async function syncOpportunityInactive(): Promise<void> {
  const db = getCrmDb();
  const staleBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.all<{ id: string; title: string; ownerId: string; stageChangedAt: string }>(sql`
    SELECT o.id, o.title, o.owner_id AS ownerId, o.stage_changed_at AS stageChangedAt
    FROM crm_opportunities o
    WHERE o.stage NOT IN ('GAGNE', 'PERDU') AND o.owner_id IS NOT NULL AND o.stage_changed_at < ${staleBefore}
      AND NOT EXISTS (
        SELECT 1 FROM crm_notifications n
        WHERE n.dedupe_key = 'opportunite-inactive:' || o.id || ':' || o.owner_id || ':' || o.stage_changed_at
      )
  `);
  for (const row of rows) {
    await insertNotification({
      userId: row.ownerId,
      type: 'OPPORTUNITE_INACTIVE',
      title: 'Opportunité inactive depuis 7 jours ou plus',
      body: row.title,
      href: '/metworkcrm/sales',
      entityType: 'OPPORTUNITY',
      entityId: row.id,
      dedupeKey: `opportunite-inactive:${row.id}:${row.ownerId}:${row.stageChangedAt}`,
    });
  }
}

export async function syncNotifications(): Promise<void> {
  await Promise.all([
    safely('task-due-today', syncTaskDueToday),
    safely('followup-due-today', syncFollowUpDueToday),
    safely('payment-overdue', syncPaymentOverdue),
    safely('meeting-soon', syncMeetingSoon),
    safely('opportunity-inactive', syncOpportunityInactive),
  ]);
}

export async function listNotifications(userId: string) {
  const db = getCrmDb();
  const [rows, unreadRows] = await Promise.all([
    db
      .select()
      .from(crmNotifications)
      .where(eq(crmNotifications.userId, userId))
      .orderBy(desc(crmNotifications.createdAt))
      .limit(50),
    db
      .select({ n: sql<number>`count(*)` })
      .from(crmNotifications)
      .where(and(eq(crmNotifications.userId, userId), eq(crmNotifications.read, false))),
  ]);
  return { rows, unreadCount: Number(unreadRows[0]?.n ?? 0) };
}

export async function markNotificationRead(id: string, userId: string): Promise<void> {
  const db = getCrmDb();
  await db
    .update(crmNotifications)
    .set({ read: true, readAt: new Date().toISOString() })
    .where(and(eq(crmNotifications.id, id), eq(crmNotifications.userId, userId)));
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const db = getCrmDb();
  await db
    .update(crmNotifications)
    .set({ read: true, readAt: new Date().toISOString() })
    .where(and(eq(crmNotifications.userId, userId), eq(crmNotifications.read, false)));
}
