/**
 * METWORK OS CRM — Dashboard service (product spec §4.18, Prompt 6).
 *
 * Six views: Aujourd'hui · Urgent · Commercial · Écosystème · Open Innovation
 * · Programmes. "Aujourd'hui"/"Urgent" are PERSONAL (scoped to the viewer via
 * `assigneeId`/`createdBy`/`ownerId`); the other four are team-wide pipeline
 * snapshots.
 *
 * Query-performance note (schema doc §12, R-19): production runs libSQL over
 * Turso's HTTP transport, so every additional query is a real network round
 * trip, not an in-process call. Each view below issues ONE consolidated query
 * — a `UNION ALL` across tables (the `search.ts` precedent) or a single
 * `GROUP BY` — instead of one small query per metric. Every filter used here
 * is covered by an existing Prompt 1 index: `idx_crm_task_assignee_due`,
 * `idx_crm_int_next_action`, `idx_crm_opp_stale`, `idx_crm_opp_stage`,
 * `idx_crm_oi_stage`, `idx_crm_prog_dates`. The handful of aggregates with no
 * supporting index (partnerships/participants `created_at >= X`) scan small
 * tables at internal-CRM volume — the same reasoning `search.ts` already
 * documents for skipping FTS.
 */
import { sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import type { InternalUser } from '../db/schema';
import { canSeeMoney } from '../auth/guards';
import { countOverduePayments } from './payments';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoDate(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** The "stalled 7+ days" threshold `idx_crm_opp_stale` was built for — reused, not reinvented. */
const STALE_OPPORTUNITY_DAYS = 7;
const NEW_PARTNER_WINDOW_DAYS = 30;
const RECENT_REGISTRATION_DAYS = 7;

export interface DashboardListItem {
  kind: string;
  id: string;
  title: string;
  subtitle: string | null;
  meta: string | null;
}

export interface TodayViewData {
  tasks: DashboardListItem[];
  followUps: DashboardListItem[];
}

export interface UrgentViewData {
  overdueTasks: DashboardListItem[];
  unfollowedProspects: DashboardListItem[];
  blockedOpportunities: DashboardListItem[];
  overduePaymentsCount: number | null;
}

export interface CommercialViewData {
  newLeads: number;
  offers: number;
  negotiations: number;
  wonDeals: number;
  pipelineValue: number | null;
}

export interface EcosystemViewData {
  newPartners: number;
  activePartnerships: number;
  startups: number;
  experts: number;
}

export interface OpenInnovationViewData {
  interestedCompanies: number;
  challenges: number;
  pocs: number;
  activeProjects: number;
}

export interface ProgramsViewData {
  upcoming: DashboardListItem[];
  recentRegistrations: number;
}

export interface DashboardData {
  today: TodayViewData;
  urgent: UrgentViewData;
  commercial: CommercialViewData;
  ecosystem: EcosystemViewData;
  openInnovation: OpenInnovationViewData;
  programs: ProgramsViewData;
}

async function getTodayView(userId: string): Promise<TodayViewData> {
  const db = getCrmDb();
  const t = today();

  const rows = await db.all<{ kind: string; id: string; title: string; subtitle: string | null; meta: string | null }>(sql`
    SELECT 'TASK' AS kind, id, title AS title, NULL AS subtitle, priority AS meta
    FROM crm_tasks
    WHERE assignee_id = ${userId} AND status != 'TERMINEE' AND due_date = ${t}
    ORDER BY due_at IS NULL, due_at ASC
    LIMIT 20
  `);
  const followUps = await db.all<{ kind: string; id: string; title: string; subtitle: string | null; meta: string | null }>(sql`
    SELECT 'FOLLOW_UP' AS kind, i.id AS id, i.subject AS title,
           COALESCE(o.name, c.full_name) AS subtitle, i.next_action AS meta
    FROM crm_interactions i
    LEFT JOIN crm_organizations o ON o.id = i.organization_id
    LEFT JOIN crm_contacts c ON c.id = i.contact_id
    WHERE i.created_by = ${userId} AND i.next_action_done = 0 AND i.next_action_date = ${t}
    ORDER BY i.next_action_date ASC
    LIMIT 20
  `);

  return { tasks: rows, followUps };
}

async function getUrgentView(user: Pick<InternalUser, 'id' | 'role'>): Promise<UrgentViewData> {
  const db = getCrmDb();
  const t = today();
  const staleBefore = daysAgoDate(STALE_OPPORTUNITY_DAYS);

  const rows = await db.all<{ kind: string; id: string; title: string; subtitle: string | null; meta: string | null }>(sql`
    SELECT 'TASK' AS kind, id, title AS title, NULL AS subtitle, due_date AS meta
    FROM crm_tasks
    WHERE assignee_id = ${user.id} AND status != 'TERMINEE' AND due_date < ${t}
    ORDER BY due_date ASC
    LIMIT 20
  `);
  const prospects = await db.all<{ kind: string; id: string; title: string; subtitle: string | null; meta: string | null }>(sql`
    SELECT 'FOLLOW_UP' AS kind, i.id AS id, i.subject AS title,
           COALESCE(o.name, c.full_name) AS subtitle, i.next_action_date AS meta
    FROM crm_interactions i
    LEFT JOIN crm_organizations o ON o.id = i.organization_id
    LEFT JOIN crm_contacts c ON c.id = i.contact_id
    WHERE i.created_by = ${user.id} AND i.next_action_done = 0 AND i.next_action_date < ${t}
      AND (o.status = 'PROSPECT' OR c.status = 'PROSPECT')
    ORDER BY i.next_action_date ASC
    LIMIT 20
  `);
  const blocked = await db.all<{ kind: string; id: string; title: string; subtitle: string | null; meta: string | null }>(sql`
    SELECT 'OPPORTUNITY' AS kind, id, title AS title, stage AS subtitle, stage_changed_at AS meta
    FROM crm_opportunities
    WHERE owner_id = ${user.id} AND stage NOT IN ('GAGNE', 'PERDU') AND stage_changed_at < ${staleBefore}
    ORDER BY stage_changed_at ASC
    LIMIT 20
  `);

  return {
    overdueTasks: rows,
    unfollowedProspects: prospects,
    blockedOpportunities: blocked,
    // crm_payments carries no ownerId — this section cannot be personal-scoped by
    // construction, so it is admin-only rather than falsely "scoped to me".
    overduePaymentsCount: canSeeMoney(user) ? await countOverduePayments() : null,
  };
}

async function getCommercialView(user: Pick<InternalUser, 'role'>): Promise<CommercialViewData> {
  const db = getCrmDb();
  const rows = await db.all<{ stage: string; n: number; total: number | null }>(sql`
    SELECT stage, COUNT(*) AS n, SUM(amount) AS total
    FROM crm_opportunities
    GROUP BY stage
  `);

  const byStage = new Map(rows.map((r) => [r.stage, r]));
  const pipelineValueRaw = rows
    .filter((r) => r.stage !== 'GAGNE' && r.stage !== 'PERDU')
    .reduce((sum, r) => sum + (r.total ?? 0), 0);

  return {
    newLeads: byStage.get('NOUVEAU_LEAD')?.n ?? 0,
    offers: byStage.get('PROPOSITION_ENVOYEE')?.n ?? 0,
    negotiations: byStage.get('NEGOCIATION')?.n ?? 0,
    wonDeals: byStage.get('GAGNE')?.n ?? 0,
    pipelineValue: canSeeMoney(user) ? pipelineValueRaw : null,
  };
}

async function getEcosystemView(): Promise<EcosystemViewData> {
  const db = getCrmDb();
  const since = daysAgoDate(NEW_PARTNER_WINDOW_DAYS);
  const rows = await db.all<{ metric: string; n: number }>(sql`
    SELECT 'NEW_PARTNERS' AS metric, COUNT(*) AS n FROM crm_partnerships WHERE created_at >= ${since}
    UNION ALL
    SELECT 'ACTIVE_PARTNERSHIPS', COUNT(*) FROM crm_partnerships WHERE stage = 'ACTIF'
    UNION ALL
    SELECT 'STARTUPS', COUNT(*) FROM crm_startups
    UNION ALL
    SELECT 'EXPERTS', COUNT(*) FROM crm_experts
  `);
  const byMetric = new Map(rows.map((r) => [r.metric, r.n]));
  return {
    newPartners: byMetric.get('NEW_PARTNERS') ?? 0,
    activePartnerships: byMetric.get('ACTIVE_PARTNERSHIPS') ?? 0,
    startups: byMetric.get('STARTUPS') ?? 0,
    experts: byMetric.get('EXPERTS') ?? 0,
  };
}

async function getOpenInnovationView(): Promise<OpenInnovationViewData> {
  const db = getCrmDb();
  const rows = await db.all<{ metric: string; n: number }>(sql`
    SELECT 'COMPANIES' AS metric, COUNT(DISTINCT organization_id) AS n
    FROM crm_oi_projects WHERE organization_id IS NOT NULL
    UNION ALL
    SELECT 'CHALLENGES', COUNT(*) FROM crm_oi_projects WHERE challenge_statement IS NOT NULL
    UNION ALL
    SELECT 'POC', COUNT(*) FROM crm_oi_projects WHERE stage = 'POC'
    UNION ALL
    SELECT 'ACTIVE', COUNT(*) FROM crm_oi_projects WHERE stage != 'TERMINE'
  `);
  const byMetric = new Map(rows.map((r) => [r.metric, r.n]));
  return {
    interestedCompanies: byMetric.get('COMPANIES') ?? 0,
    challenges: byMetric.get('CHALLENGES') ?? 0,
    pocs: byMetric.get('POC') ?? 0,
    activeProjects: byMetric.get('ACTIVE') ?? 0,
  };
}

async function getProgramsView(): Promise<ProgramsViewData> {
  const db = getCrmDb();
  const t = today();
  const since = daysAgoDate(RECENT_REGISTRATION_DAYS);

  const [upcoming, registrationRows] = await Promise.all([
    db.all<{ kind: string; id: string; title: string; subtitle: string | null; meta: string | null }>(sql`
      SELECT 'PROGRAM' AS kind, id, title AS title, type AS subtitle, start_date AS meta
      FROM crm_programs
      WHERE start_date >= ${t}
      ORDER BY start_date ASC
      LIMIT 10
    `),
    db.all<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM crm_program_participants WHERE created_at >= ${since}
    `),
  ]);

  return {
    upcoming,
    recentRegistrations: registrationRows[0]?.n ?? 0,
  };
}

export async function getDashboardData(user: Pick<InternalUser, 'id' | 'role'>): Promise<DashboardData> {
  const [todayView, urgent, commercial, ecosystem, openInnovation, programs] = await Promise.all([
    getTodayView(user.id),
    getUrgentView(user),
    getCommercialView(user),
    getEcosystemView(),
    getOpenInnovationView(),
    getProgramsView(),
  ]);

  return { today: todayView, urgent, commercial, ecosystem, openInnovation, programs };
}
