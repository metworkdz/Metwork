/**
 * METWORK OS CRM — Reports service (product spec §4.18, Prompt 6).
 *
 * All-time / current-state snapshots, no date-range picker in this pass
 * (owner decision — a period selector is a separate scoped addition). Same
 * query-consolidation approach as `dashboard.ts`: one `GROUP BY` or
 * `UNION ALL` per section instead of one small query per metric, since
 * production runs libSQL over HTTP (schema doc §12).
 */
import { sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import type { InternalUser } from '../db/schema';
import { canSeeMoney } from '../auth/guards';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export interface SalesKpis {
  leads: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  pipelineValue: number | null;
  revenueByType: { type: string; total: number }[] | null;
}

export interface OperationsKpis {
  tasksDoneThisMonth: number;
  tasksOverdue: number;
  avgProcessingDays: number | null;
}

export interface StartupsKpis {
  total: number;
  bySector: { sector: string; n: number }[];
  byStage: { stage: string; n: number }[];
  withProgram: number;
}

export interface EcosystemKpis {
  partners: number;
  experts: number;
  organizations: number;
  interactionsThisMonth: number;
}

export interface OpenInnovationKpis {
  total: number;
  byStage: { stage: string; n: number }[];
  mobilizedStartups: number;
  mobilizedExperts: number;
  budgetTotal: number | null;
}

export interface ProgramsKpis {
  fillRate: number | null;
  attendanceRate: number | null;
  revenue: number | null;
  avgSatisfaction: number | null;
}

export interface ReportsData {
  sales: SalesKpis;
  operations: OperationsKpis;
  startups: StartupsKpis;
  ecosystem: EcosystemKpis;
  openInnovation: OpenInnovationKpis;
  programs: ProgramsKpis;
}

async function getSalesKpis(user: Pick<InternalUser, 'role'>): Promise<SalesKpis> {
  const db = getCrmDb();
  const totals = await db.all<{ leads: number; won: number; lost: number; pipeline: number | null }>(sql`
    SELECT
      COUNT(*) AS leads,
      SUM(CASE WHEN stage = 'GAGNE' THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN stage = 'PERDU' THEN 1 ELSE 0 END) AS lost,
      SUM(CASE WHEN stage NOT IN ('GAGNE', 'PERDU') THEN amount ELSE 0 END) AS pipeline
    FROM crm_opportunities
  `);
  const revenueRows = await db.all<{ type: string; total: number }>(sql`
    SELECT type, SUM(amount) AS total FROM crm_opportunities WHERE stage = 'GAGNE' GROUP BY type
  `);

  const row = totals[0] ?? { leads: 0, won: 0, lost: 0, pipeline: 0 };
  const seeMoney = canSeeMoney(user);

  return {
    leads: row.leads,
    won: row.won,
    lost: row.lost,
    conversionRate: row.won + row.lost > 0 ? row.won / (row.won + row.lost) : null,
    pipelineValue: seeMoney ? (row.pipeline ?? 0) : null,
    revenueByType: seeMoney ? revenueRows : null,
  };
}

async function getOperationsKpis(): Promise<OperationsKpis> {
  const db = getCrmDb();
  const monthStart = startOfMonth();
  const t = today();
  const rows = await db.all<{ doneThisMonth: number; overdue: number; avgDays: number | null }>(sql`
    SELECT
      SUM(CASE WHEN status = 'TERMINEE' AND completed_at >= ${monthStart} THEN 1 ELSE 0 END) AS doneThisMonth,
      SUM(CASE WHEN status != 'TERMINEE' AND due_date < ${t} THEN 1 ELSE 0 END) AS overdue,
      AVG(CASE WHEN status = 'TERMINEE' AND completed_at >= ${monthStart}
               THEN julianday(completed_at) - julianday(created_at) END) AS avgDays
    FROM crm_tasks
  `);
  const row = rows[0] ?? { doneThisMonth: 0, overdue: 0, avgDays: null };
  return {
    tasksDoneThisMonth: row.doneThisMonth ?? 0,
    tasksOverdue: row.overdue ?? 0,
    avgProcessingDays: row.avgDays != null ? Math.round(row.avgDays * 10) / 10 : null,
  };
}

async function getStartupsKpis(): Promise<StartupsKpis> {
  const db = getCrmDb();
  const rows = await db.all<{ metric: string; key: string; n: number }>(sql`
    SELECT 'SECTOR' AS metric, COALESCE(sector, 'Non renseigné') AS key, COUNT(*) AS n
    FROM crm_startups GROUP BY sector
    UNION ALL
    SELECT 'STAGE', pipeline_stage, COUNT(*) FROM crm_startups GROUP BY pipeline_stage
    UNION ALL
    SELECT 'PROGRAM', CASE WHEN program_id IS NULL THEN 'SANS' ELSE 'AVEC' END, COUNT(*)
    FROM crm_startups GROUP BY (program_id IS NULL)
  `);

  const bySector = rows.filter((r) => r.metric === 'SECTOR').map((r) => ({ sector: r.key, n: r.n }));
  const byStage = rows.filter((r) => r.metric === 'STAGE').map((r) => ({ stage: r.key, n: r.n }));
  const withProgram = rows.find((r) => r.metric === 'PROGRAM' && r.key === 'AVEC')?.n ?? 0;
  const total = bySector.reduce((sum, r) => sum + r.n, 0);

  return { total, bySector, byStage, withProgram };
}

async function getEcosystemKpis(): Promise<EcosystemKpis> {
  const db = getCrmDb();
  const monthStart = startOfMonth();
  const rows = await db.all<{ metric: string; n: number }>(sql`
    SELECT 'PARTNERS' AS metric, COUNT(*) AS n FROM crm_partnerships
    UNION ALL
    SELECT 'EXPERTS', COUNT(*) FROM crm_experts
    UNION ALL
    SELECT 'ORGS', COUNT(*) FROM crm_organizations
    UNION ALL
    SELECT 'INTERACTIONS_MONTH', COUNT(*) FROM crm_interactions WHERE occurred_at >= ${monthStart}
  `);
  const byMetric = new Map(rows.map((r) => [r.metric, r.n]));
  return {
    partners: byMetric.get('PARTNERS') ?? 0,
    experts: byMetric.get('EXPERTS') ?? 0,
    organizations: byMetric.get('ORGS') ?? 0,
    interactionsThisMonth: byMetric.get('INTERACTIONS_MONTH') ?? 0,
  };
}

async function getOpenInnovationKpis(user: Pick<InternalUser, 'role'>): Promise<OpenInnovationKpis> {
  const db = getCrmDb();
  const rows = await db.all<{ metric: string; key: string; n: number; total: number | null }>(sql`
    SELECT 'TOTAL' AS metric, 'TOTAL' AS key, COUNT(*) AS n, NULL AS total FROM crm_oi_projects
    UNION ALL
    SELECT 'STAGE', stage, COUNT(*), NULL FROM crm_oi_projects GROUP BY stage
    UNION ALL
    SELECT 'BUDGET', 'TOTAL', COUNT(*), SUM(budget) FROM crm_oi_projects
    UNION ALL
    SELECT 'MOBILIZED_STARTUPS', 'TOTAL', COUNT(*), NULL FROM crm_oi_startups
    UNION ALL
    SELECT 'MOBILIZED_EXPERTS', 'TOTAL', COUNT(*), NULL FROM crm_oi_experts
  `);

  const byStage = rows.filter((r) => r.metric === 'STAGE').map((r) => ({ stage: r.key, n: r.n }));
  const total = rows.find((r) => r.metric === 'TOTAL')?.n ?? 0;
  const budgetRow = rows.find((r) => r.metric === 'BUDGET');
  const mobilizedStartups = rows.find((r) => r.metric === 'MOBILIZED_STARTUPS')?.n ?? 0;
  const mobilizedExperts = rows.find((r) => r.metric === 'MOBILIZED_EXPERTS')?.n ?? 0;

  return {
    total,
    byStage,
    mobilizedStartups,
    mobilizedExperts,
    budgetTotal: canSeeMoney(user) ? (budgetRow?.total ?? 0) : null,
  };
}

async function getProgramsKpis(user: Pick<InternalUser, 'role'>): Promise<ProgramsKpis> {
  const db = getCrmDb();

  const [capacityRows, participantRows] = await Promise.all([
    // Two scalar subqueries, not a join — joining programs to participants and
    // then SUM()-ing `capacity` would fan out: a 10-seat program with 3
    // registrations would sum capacity 3 times (30, not 10).
    db.all<{ totalCapacity: number | null; totalRegistered: number }>(sql`
      SELECT
        (SELECT SUM(capacity) FROM crm_programs WHERE capacity IS NOT NULL) AS totalCapacity,
        (SELECT COUNT(*) FROM crm_program_participants pp
          JOIN crm_programs pr ON pr.id = pp.program_id
          WHERE pr.capacity IS NOT NULL) AS totalRegistered
    `),
    db.all<{ attended: number; total: number; avgSatisfaction: number | null; revenue: number | null }>(sql`
      SELECT
        SUM(CASE WHEN pp.attended THEN 1 ELSE 0 END) AS attended,
        COUNT(*) AS total,
        AVG(CASE WHEN pp.satisfaction_score IS NOT NULL THEN pp.satisfaction_score END) AS avgSatisfaction,
        SUM(CASE WHEN pp.status IN ('CONFIRME', 'PRESENT') THEN pr.price ELSE 0 END) AS revenue
      FROM crm_program_participants pp
      JOIN crm_programs pr ON pr.id = pp.program_id
    `),
  ]);

  const cap = capacityRows[0] ?? { totalCapacity: null, totalRegistered: 0 };
  const part = participantRows[0] ?? { attended: 0, total: 0, avgSatisfaction: null, revenue: 0 };

  return {
    fillRate: cap.totalCapacity ? cap.totalRegistered / cap.totalCapacity : null,
    attendanceRate: part.total > 0 ? part.attended / part.total : null,
    revenue: canSeeMoney(user) ? (part.revenue ?? 0) : null,
    avgSatisfaction: part.avgSatisfaction != null ? Math.round(part.avgSatisfaction * 10) / 10 : null,
  };
}

export async function getReportsData(user: Pick<InternalUser, 'role'>): Promise<ReportsData> {
  const [sales, operations, startups, ecosystem, openInnovation, programs] = await Promise.all([
    getSalesKpis(user),
    getOperationsKpis(),
    getStartupsKpis(),
    getEcosystemKpis(),
    getOpenInnovationKpis(user),
    getProgramsKpis(user),
  ]);

  return { sales, operations, startups, ecosystem, openInnovation, programs };
}
