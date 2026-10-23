/**
 * Tax center — THE service behind /dashboard/{freelancer,entrepreneur}/taxes,
 * its API and the reminder cron. The calendar itself is computed by
 * `lib/tax-calendar` (pure, sourced); this module only adds who the user is
 * (legal status + regime), what they already did (done, receipt, reminders
 * sent) and the amounts prefilled from their factures on a paid plan.
 *
 * Validate before mutating: db.update has no rollback.
 */
import { db, type TaxTaskStateRecord, type UserRecord } from '@/server/db/store';
import {
  OBLIGATION_RULES,
  TAX_FIGURES,
  daysUntil,
  effectiveRegime,
  obligationsFor,
  reminderDue,
  tasksFor,
  type ObligationId,
  type RuleSource,
  type TaxProfile,
  type TaxTask,
} from '@/lib/tax-calendar';
import { invoicesFor } from '@/server/invoices/owner';
import { salesForMonth, turnoverForYear } from '@/lib/turnover';
import { entitlementsForUser } from '@/lib/entitlements';
import { ventureOf } from '@/server/ventures/service';
import { createNotification } from '@/server/notifications/create-notification';
import { sendTaxReminderNotice } from '@/server/notifications/mock';
import type { TaxRegime } from '@/types/legal-status';

type DbShape = Awaited<ReturnType<typeof db.read>>;

export type TaxAudience = 'FREELANCER' | 'ENTREPRENEUR';

export function isTaxAudience(role: string): role is TaxAudience {
  return role === 'FREELANCER' || role === 'ENTREPRENEUR';
}

/**
 * The legal situation the calendar is computed from, or null when the user
 * has not said yet. A freelancer's comes from their business document, else
 * their invoice letterhead; an entrepreneur's from their venture.
 */
export function taxProfileOf(data: DbShape, user: Pick<UserRecord, 'id' | 'role'>): TaxProfile | null {
  if (user.role === 'FREELANCER') {
    const p = data.freelancerProfiles?.find((x) => x.userId === user.id);
    if (!p) return null;
    const s = p.invoiceSettings;
    const status =
      p.legal?.status
      ?? (s?.invoiceLegalStatus === 'AUTO_ENTREPRENEUR' ? 'AUTO_ENTREPRENEUR'
        : s?.invoiceLegalStatus === 'REGISTRE_COMMERCE' ? (s.invoiceRcType === 'PERSONNE_MORALE' ? 'COMPANY' : 'INDIVIDUAL_IFU')
        : null);
    return status ? { status, taxRegime: p.taxRegime ?? null } : null;
  }
  if (user.role === 'ENTREPRENEUR') {
    const v = ventureOf(data, user.id);
    return v ? { status: v.legal.status, taxRegime: v.legal.taxRegime ?? null } : null;
  }
  return null;
}

export type TaskState = 'DONE' | 'LATE' | 'DUE_SOON' | 'UPCOMING';

export interface TaxTaskView extends TaxTask {
  form: string | null;
  source: RuleSource;
  daysLeft: number;
  state: TaskState;
  doneAt: string | null;
  hasReceipt: boolean;
  /** Amounts from the user's factures (paid plans only), in DZD. */
  prefill: { turnover?: number; estimatedIfu?: number; vat?: number } | null;
}

export interface TaxCenterView {
  profile: TaxProfile | null;
  regime: TaxRegime | null;
  /** True when the status leaves the regime to the user (liberal professions). */
  needsRegime: boolean;
  prefillEnabled: boolean;
  tasks: TaxTaskView[];
}

const DUE_SOON_DAYS = 15;

function prefillFor(data: DbShape, userId: string, profile: TaxProfile, task: TaxTask): TaxTaskView['prefill'] {
  const invoices = invoicesFor(data, { type: 'FREELANCER', id: userId });
  if (task.obligation === 'G50') {
    const s = salesForMonth(invoices, task.period);
    return { turnover: s.ht, vat: s.tva };
  }
  const year = Number(task.period);
  if (task.obligation === 'G12_BIS') {
    const turnover = turnoverForYear(invoices, year);
    // The 0.5 % rate is the auto-entrepreneur one; other IFU rates depend on
    // the activity, so no estimate is shown for them.
    return profile.status === 'AUTO_ENTREPRENEUR'
      ? { turnover, estimatedIfu: Math.max(Math.round(turnover * TAX_FIGURES.aeIfuRate), TAX_FIGURES.aeMinimumIfu) }
      : { turnover };
  }
  // The forecast starts from last year's actual turnover.
  if (task.obligation === 'G12') return { turnover: turnoverForYear(invoices, year - 1) };
  if (task.obligation === 'G11' || task.obligation === 'G13' || task.obligation === 'G4') {
    return { turnover: turnoverForYear(invoices, year) };
  }
  return null;
}

export function taxCenterFor(data: DbShape, user: UserRecord, today: string): TaxCenterView {
  const profile = taxProfileOf(data, user);
  const regime = profile ? effectiveRegime(profile) : null;
  // Prefill reads factures, which only freelancers issue on Metwork.
  const prefillEnabled = user.role === 'FREELANCER' && entitlementsForUser(user)?.prefilledTaxAmounts === true;
  if (!profile) return { profile, regime, needsRegime: false, prefillEnabled, tasks: [] };

  const states = new Map(
    (data.taxTaskStates ?? []).filter((s) => s.userId === user.id).map((s) => [s.key, s]),
  );
  const tasks = tasksFor(profile, today).map((t): TaxTaskView => {
    const rule = OBLIGATION_RULES[t.obligation];
    const s = states.get(t.key);
    const daysLeft = daysUntil(t.dueDate, today);
    const state: TaskState = s?.doneAt ? 'DONE' : daysLeft < 0 ? 'LATE' : daysLeft <= DUE_SOON_DAYS ? 'DUE_SOON' : 'UPCOMING';
    return {
      ...t,
      form: rule.form,
      source: rule.source,
      daysLeft,
      state,
      doneAt: s?.doneAt ?? null,
      hasReceipt: Boolean(s?.receiptPublicId),
      prefill: prefillEnabled ? prefillFor(data, user.id, profile, t) : null,
    };
  });
  return {
    profile,
    regime,
    needsRegime: profile.status === 'LIBERAL_PROFESSION' && !profile.taxRegime,
    prefillEnabled,
    tasks,
  };
}

/**
 * True when `key` names a task this user really has — an obligation of their
 * situation, a well-formed period, within two years either side. Keeps the
 * state collection free of junk keys.
 */
export function isOwnTaskKey(profile: TaxProfile, key: string, today: string): key is string {
  const m = /^([A-Z0-9_]+):(\d{4})(?:-(\d{2}))?$/.exec(key);
  if (!m) return false;
  const id = m[1] as ObligationId;
  if (!obligationsFor(profile).includes(id)) return false;
  const monthly = OBLIGATION_RULES[id].cadence === 'MONTHLY';
  if (monthly !== (m[3] !== undefined)) return false;
  if (m[3] !== undefined && (Number(m[3]) < 1 || Number(m[3]) > 12)) return false;
  const year = Number(m[2]);
  const thisYear = Number(today.slice(0, 4));
  return year >= thisYear - 2 && year <= thisYear + 1;
}

function stateIn(d: DbShape, userId: string, key: string, now: string): TaxTaskStateRecord {
  if (!d.taxTaskStates) d.taxTaskStates = [];
  let s = d.taxTaskStates.find((x) => x.userId === userId && x.key === key);
  if (!s) {
    s = { userId, key, doneAt: null, receiptPublicId: null, remindersSent: [], updatedAt: now };
    d.taxTaskStates.push(s);
  }
  return s;
}

export type TaskWriteResult = { ok: true; state: TaxTaskStateRecord } | { ok: false; reason: 'NO_PROFILE' | 'UNKNOWN_TASK' };

/** Whether `key` is one of this user's tasks — checked before any upload. */
export async function checkTask(userId: string, key: string): Promise<{ ok: true } | { ok: false; reason: 'NO_PROFILE' | 'UNKNOWN_TASK' }> {
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  const profile = user ? taxProfileOf(data, user) : null;
  if (!profile) return { ok: false, reason: 'NO_PROFILE' };
  if (!isOwnTaskKey(profile, key, new Date().toISOString().slice(0, 10))) return { ok: false, reason: 'UNKNOWN_TASK' };
  return { ok: true };
}

/** Mark a task done (stops its reminders) or reopen it. */
export async function setTaskDone(userId: string, key: string, done: boolean): Promise<TaskWriteResult> {
  const check = await checkTask(userId, key);
  if (!check.ok) return check;
  const now = new Date().toISOString();
  const state = await db.update((d) => {
    const s = stateIn(d, userId, key, now);
    s.doneAt = done ? (s.doneAt ?? now) : null;
    s.updatedAt = now;
    return { ...s };
  });
  return { ok: true, state };
}

/**
 * Attach a receipt (already uploaded privately). Attaching one also marks the
 * task done. Returns the replaced asset so the caller can delete it.
 */
export async function attachReceipt(
  userId: string,
  key: string,
  publicId: string,
): Promise<(TaskWriteResult & { replaced?: string | null })> {
  const check = await checkTask(userId, key);
  if (!check.ok) return check;
  const now = new Date().toISOString();
  return db.update((d) => {
    const s = stateIn(d, userId, key, now);
    const replaced = s.receiptPublicId;
    s.receiptPublicId = publicId;
    s.doneAt = s.doneAt ?? now;
    s.updatedAt = now;
    return { ok: true as const, state: { ...s }, replaced };
  });
}

export function receiptOf(data: DbShape, userId: string, key: string): string | null {
  return data.taxTaskStates?.find((s) => s.userId === userId && s.key === key)?.receiptPublicId ?? null;
}

/** Set the tax regime the calendar uses (freelancer profile or venture). */
export async function setTaxRegime(user: Pick<UserRecord, 'id' | 'role'>, regime: TaxRegime): Promise<boolean> {
  const now = new Date().toISOString();
  return db.update((d) => {
    if (user.role === 'FREELANCER') {
      const p = d.freelancerProfiles?.find((x) => x.userId === user.id);
      if (!p) return false;
      p.taxRegime = regime;
      p.updatedAt = now;
      return true;
    }
    const v = (d.ventures ?? []).find((x) => x.ownerId === user.id);
    if (!v) return false;
    v.legal = { ...v.legal, taxRegime: regime };
    v.updatedAt = now;
    return true;
  });
}

/* ─────────────────────────── Reminders ─────────────────────────── */

export interface TaxReminderRunResult {
  sent: number;
  users: number;
}

const REMINDER_TITLE = { fr: 'Échéance fiscale', en: 'Tax deadline', ar: 'أجل ضريبي' } as const;

/**
 * Send the reminders due today: the first one (`firstReminderDays` before),
 * then J-7 and J-1, never for a task marked done. The offset is stamped in
 * the same update that selects it, so overlapping runs never double-send.
 */
export async function runTaxReminders(now = new Date()): Promise<TaxReminderRunResult> {
  const today = now.toISOString().slice(0, 10);
  const nowIso = now.toISOString();
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz').replace(/\/$/, '');

  const due = await db.update((d) => {
    const out: { user: UserRecord; task: TaxTask; daysLeft: number }[] = [];
    for (const user of d.users) {
      if (!isTaxAudience(user.role) || user.status !== 'ACTIVE') continue;
      const profile = taxProfileOf(d, user);
      if (!profile) continue;
      // Longest first-reminder window is 180 days (CASNOS payment).
      for (const task of tasksFor(profile, today, { lookBackDays: 0, horizonDays: 200 })) {
        const existing = d.taxTaskStates?.find((s) => s.userId === user.id && s.key === task.key);
        if (existing?.doneAt) continue;
        const offset = reminderDue(task, today, existing?.remindersSent ?? []);
        if (offset === null) continue;
        const s = stateIn(d, user.id, task.key, nowIso);
        s.remindersSent = [...s.remindersSent, offset];
        s.updatedAt = nowIso;
        out.push({ user: { ...user }, task, daysLeft: daysUntil(task.dueDate, today) });
      }
    }
    return out;
  });

  for (const { user, task, daysLeft } of due) {
    const lang = user.locale === 'ar' || user.locale === 'en' ? user.locale : 'fr';
    const url = `${base}/${lang}/dashboard/${user.role === 'FREELANCER' ? 'freelancer' : 'entrepreneur'}/taxes`;
    await sendTaxReminderNotice({
      fullName: user.fullName,
      email: user.email || null,
      phone: user.phone || null,
      locale: user.locale ?? null,
      obligation: task.obligation,
      period: task.period,
      dueDate: task.dueDate,
      daysLeft,
      url,
    });
    await createNotification({
      userId: user.id,
      type: 'GENERAL',
      title: REMINDER_TITLE[lang],
      body: `${OBLIGATION_RULES[task.obligation].form ?? task.obligation} · ${task.period} · ${task.dueDate}`,
      href: `/dashboard/${user.role === 'FREELANCER' ? 'freelancer' : 'entrepreneur'}/taxes`,
    });
  }
  return { sent: due.length, users: new Set(due.map((x) => x.user.id)).size };
}
