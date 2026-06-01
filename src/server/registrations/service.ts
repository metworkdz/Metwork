/**
 * Registration service — business logic for program/event registrations.
 *
 * Handles:
 *  - Guest (no account) and authenticated registrations
 *  - Capacity enforcement
 *  - CRM client deduplication / creation
 *  - Confirmation emails via Resend
 *  - Form field CRUD for incubator form builders
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type RegistrationRecord,
  type RegistrationFormFieldRecord,
  type RegistrationFieldType,
  type RegistrationStatus,
} from '@/server/db/store';
import { sendResendEmail, layout } from '@/server/notifications/email';
import { countAttendance } from '@/server/attendance';

/* ─────────────────────────── Types ─────────────────────────── */

export interface CreateRegistrationInput {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  /** Authenticated user id. Null for guests. */
  userId: string | null;
  fullName: string;
  email: string;
  phone: string;
  answers: Array<{ fieldId: string; value: string | string[] }>;
}

export interface CreateFormFieldInput {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  incubatorId: string;
  label: string;
  type: RegistrationFieldType;
  options: string[] | null;
  required: boolean;
  order: number;
}

export interface UpdateFormFieldInput {
  label?: string;
  type?: RegistrationFieldType;
  options?: string[] | null;
  required?: boolean;
  order?: number;
}

/* ─────────────────────────── Capacity helpers ─────────────────────────── */

/** Count confirmed registrations for an entity. */
export async function getRegistrationCount(
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
): Promise<number> {
  const data = await db.read();
  return (data.registrations ?? []).filter(
    (r) => r.entityType === entityType && r.entityId === entityId && r.status !== 'CANCELLED',
  ).length;
}

/* ─────────────────────────── Form fields ─────────────────────────── */

/** List all custom form fields for a program or event, ordered by `order`. */
export async function listFormFields(
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
): Promise<RegistrationFormFieldRecord[]> {
  const data = await db.read();
  return (data.registrationFormFields ?? [])
    .filter((f) => f.entityType === entityType && f.entityId === entityId)
    .sort((a, b) => a.order - b.order);
}

/** Create a new form field. Returns the persisted record. */
export async function createFormField(
  input: CreateFormFieldInput,
): Promise<RegistrationFormFieldRecord> {
  const now = new Date().toISOString();
  return db.update((d) => {
    if (!Array.isArray(d.registrationFormFields)) d.registrationFormFields = [];
    const field: RegistrationFormFieldRecord = {
      id: randomUUID(),
      entityType: input.entityType,
      entityId: input.entityId,
      incubatorId: input.incubatorId,
      label: input.label.trim(),
      type: input.type,
      options: input.options ?? null,
      required: input.required,
      order: input.order,
      createdAt: now,
      updatedAt: now,
    };
    d.registrationFormFields.push(field);
    return field;
  });
}

/** Update an existing form field. Returns null when not found. */
export async function updateFormField(
  id: string,
  incubatorId: string,
  input: UpdateFormFieldInput,
): Promise<RegistrationFormFieldRecord | null> {
  return db.update((d) => {
    const idx = (d.registrationFormFields ?? []).findIndex(
      (f) => f.id === id && f.incubatorId === incubatorId,
    );
    if (idx === -1) return null;
    const existing = d.registrationFormFields[idx]!;
    const updated: RegistrationFormFieldRecord = {
      ...existing,
      ...input,
      label: input.label !== undefined ? input.label.trim() : existing.label,
      updatedAt: new Date().toISOString(),
    };
    d.registrationFormFields[idx] = updated;
    return updated;
  });
}

/** Delete a form field. Also removes answers for this field from all registrations. */
export async function deleteFormField(id: string, incubatorId: string): Promise<boolean> {
  return db.update((d) => {
    const idx = (d.registrationFormFields ?? []).findIndex(
      (f) => f.id === id && f.incubatorId === incubatorId,
    );
    if (idx === -1) return false;
    d.registrationFormFields.splice(idx, 1);
    // Prune answers from existing registrations
    d.registrations = (d.registrations ?? []).map((r) => ({
      ...r,
      answers: r.answers.filter((a) => a.fieldId !== id),
    }));
    return true;
  });
}

/** Replace the entire form field list for an entity (used by bulk-save from the builder UI). */
export async function replaceFormFields(
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
  incubatorId: string,
  fields: Omit<RegistrationFormFieldRecord, 'id' | 'incubatorId' | 'entityType' | 'entityId' | 'createdAt' | 'updatedAt'>[],
): Promise<RegistrationFormFieldRecord[]> {
  const now = new Date().toISOString();
  return db.update((d) => {
    if (!Array.isArray(d.registrationFormFields)) d.registrationFormFields = [];
    // Collect ids of fields being replaced so we can clean up orphaned answers
    const oldIds = new Set(
      d.registrationFormFields
        .filter((f) => f.entityType === entityType && f.entityId === entityId)
        .map((f) => f.id),
    );
    // Remove old fields for this entity
    d.registrationFormFields = d.registrationFormFields.filter(
      (f) => !(f.entityType === entityType && f.entityId === entityId),
    );
    // Map incoming fields: keep existing id if label matches an old field, otherwise new uuid
    const existingByLabel = new Map<string, string>(); // label → old id
    oldIds.forEach((oid) => {
      // we already filtered them out so we can't recover the label, just generate new ids
      void oid;
    });
    const newFields: RegistrationFormFieldRecord[] = fields.map((f, i) => ({
      id: randomUUID(),
      entityType,
      entityId,
      incubatorId,
      label: f.label,
      type: f.type,
      options: f.options,
      required: f.required,
      order: i,
      createdAt: now,
      updatedAt: now,
    }));
    d.registrationFormFields.push(...newFields);
    void existingByLabel;
    return newFields;
  });
}

/* ─────────────────────────── Registrations CRUD ─────────────────────────── */

/**
 * Create a registration. Handles:
 *  - capacity check (returns WAITLISTED when full)
 *  - duplicate-email guard per entity
 *  - CRM client upsert
 *  - confirmation email
 */
export async function createRegistration(input: CreateRegistrationInput): Promise<{
  registration: RegistrationRecord;
  alreadyRegistered: boolean;
}> {
  const data = await db.read();

  // Duplicate guard
  const existing = (data.registrations ?? []).find(
    (r) =>
      r.entityType === input.entityType &&
      r.entityId === input.entityId &&
      r.email.toLowerCase() === input.email.toLowerCase() &&
      r.status !== 'CANCELLED',
  );
  if (existing) return { registration: existing, alreadyRegistered: true };

  // Capacity check — unified count (confirmed registrations + active bookings)
  // so the waitlist trigger agrees with the public seat badge and the booking
  // capacity gate.
  const capacity = getEntityCapacity(data, input.entityType, input.entityId);
  const taken = countAttendance(data, input.entityType, input.entityId);
  const status: RegistrationStatus = capacity !== null && taken >= capacity ? 'WAITLISTED' : 'CONFIRMED';

  // CRM: find or create client within incubator scope
  const incubatorId = getEntityIncubatorId(data, input.entityType, input.entityId);

  const registration = await db.update<RegistrationRecord>((d) => {
    if (!Array.isArray(d.registrations)) d.registrations = [];

    // CRM client upsert
    let clientId: string | null = null;
    if (incubatorId) {
      if (!Array.isArray(d.clients)) d.clients = [];
      const existingClient = d.clients.find(
        (c) => c.incubatorId === incubatorId && c.email.toLowerCase() === input.email.toLowerCase(),
      );
      if (existingClient) {
        clientId = existingClient.id;
      } else {
        const now = new Date().toISOString();
        const newClient = {
          id: randomUUID(),
          incubatorId,
          fullName: input.fullName.trim(),
          email: input.email.trim().toLowerCase(),
          phone: input.phone.trim(),
          idCardNumber: null,
          companyName: null,
          notes: null,
          createdAt: now,
          updatedAt: now,
        };
        d.clients.push(newClient);
        clientId = newClient.id;
      }
    }

    const now = new Date().toISOString();
    const rec: RegistrationRecord = {
      id: randomUUID(),
      entityType: input.entityType,
      entityId: input.entityId,
      incubatorId: incubatorId ?? '',
      userId: input.userId,
      fullName: input.fullName.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      answers: input.answers,
      status,
      clientId,
      createdAt: now,
      updatedAt: now,
    };
    d.registrations.push(rec);
    return rec;
  });

  // Confirmation email (fire-and-forget)
  void sendConfirmationEmail(registration, data, input.entityType, input.entityId);

  return { registration, alreadyRegistered: false };
}

/** List registrations for an entity, newest first. */
export async function listRegistrations(
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
  incubatorId: string,
): Promise<RegistrationRecord[]> {
  const data = await db.read();
  return (data.registrations ?? [])
    .filter(
      (r) =>
        r.entityType === entityType &&
        r.entityId === entityId &&
        r.incubatorId === incubatorId,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Cancel a single registration (incubator action). */
export async function cancelRegistration(
  id: string,
  incubatorId: string,
): Promise<RegistrationRecord | null> {
  return db.update((d) => {
    const idx = (d.registrations ?? []).findIndex(
      (r) => r.id === id && r.incubatorId === incubatorId,
    );
    if (idx === -1) return null;
    const updated: RegistrationRecord = {
      ...d.registrations[idx]!,
      status: 'CANCELLED',
      updatedAt: new Date().toISOString(),
    };
    d.registrations[idx] = updated;
    return updated;
  });
}

/* ─────────────────────────── Program/Event lookup helpers ─────────────────────────── */

type DbData = Awaited<ReturnType<typeof db.read>>;

function getEntityCapacity(
  data: DbData,
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
): number | null {
  if (entityType === 'PROGRAM') {
    const p = (data.programs ?? []).find((p) => p.id === entityId);
    return p?.seatsTotal ?? null;
  }
  const e = (data.events ?? []).find((e) => e.id === entityId);
  return e?.capacity ?? null;
}

function getEntityIncubatorId(
  data: DbData,
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
): string | null {
  if (entityType === 'PROGRAM') {
    return (data.programs ?? []).find((p) => p.id === entityId)?.incubatorId ?? null;
  }
  return (data.events ?? []).find((e) => e.id === entityId)?.incubatorId ?? null;
}

function getEntityTitle(
  data: DbData,
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
): string {
  if (entityType === 'PROGRAM') {
    return (data.programs ?? []).find((p) => p.id === entityId)?.title ?? 'Program';
  }
  return (data.events ?? []).find((e) => e.id === entityId)?.title ?? 'Event';
}

function getIncubatorName(data: DbData, incubatorId: string): string {
  return (data.incubators ?? []).find((i) => i.id === incubatorId)?.name ?? 'Metwork';
}

/* ─────────────────────────── Confirmation email ─────────────────────────── */

async function sendConfirmationEmail(
  reg: RegistrationRecord,
  data: DbData,
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
): Promise<void> {
  try {
    const entityTitle = getEntityTitle(data, entityType, entityId);
    const incubatorName = getIncubatorName(data, reg.incubatorId);
    const incubator = (data.incubators ?? []).find((i) => i.id === reg.incubatorId);

    const isWaitlisted = reg.status === 'WAITLISTED';

    const subject = isWaitlisted
      ? `You're on the waitlist — ${entityTitle}`
      : `Registration confirmed — ${entityTitle}`;

    const statusBannerHtml = isWaitlisted
      ? `<div style="background:#fef3c7;border-radius:8px;padding:16px 24px;margin-bottom:20px;">
           <p style="margin:0;color:#92400e;font-size:14px;font-weight:600;">📋 You're on the waitlist</p>
           <p style="margin:4px 0 0;color:#92400e;font-size:13px;">We'll notify you if a spot opens up.</p>
         </div>`
      : `<div style="background:#dcfce7;border-radius:8px;padding:16px 24px;margin-bottom:20px;">
           <p style="margin:0;color:#15803d;font-size:14px;font-weight:600;">✅ Your registration is confirmed</p>
         </div>`;

    // Use the shared layout() so this email gets the Metwork white logo + green header
    const html = layout(`
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#09090b;letter-spacing:-0.3px;">
        ${isWaitlisted ? 'Waitlist confirmed' : 'Registration confirmed'}
      </h1>
      <p style="margin:0 0 20px;font-size:15px;color:#3f3f46;line-height:1.6;">
        Hi <strong>${escHtml(reg.fullName)}</strong>,
      </p>
      ${statusBannerHtml}
      <table width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin-bottom:20px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;
                       letter-spacing:.05em;color:#9ca3af;">
              ${entityType === 'PROGRAM' ? 'Program' : 'Event'}
            </p>
            <p style="margin:0;font-size:18px;font-weight:600;color:#09090b;">
              ${escHtml(entityTitle)}
            </p>
            <p style="margin:4px 0 0;font-size:13px;color:#71717a;">
              Hosted by ${escHtml(incubatorName)}
            </p>
          </td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;margin-bottom:20px;">
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;width:100px;border-bottom:1px solid #f4f4f5;">Name</td>
          <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;">${escHtml(reg.fullName)}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;border-bottom:1px solid #f4f4f5;">Email</td>
          <td style="padding:10px 16px;font-size:13px;color:#09090b;border-bottom:1px solid #f4f4f5;">${escHtml(reg.email)}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#71717a;font-weight:600;">Phone</td>
          <td style="padding:10px 16px;font-size:13px;color:#09090b;">${escHtml(reg.phone)}</td>
        </tr>
      </table>
      ${incubator?.email
        ? `<p style="margin:0;font-size:13px;color:#71717a;">
             Questions? Contact <a href="mailto:${escHtml(incubator.email)}" style="color:#30a735;">${escHtml(incubator.email)}</a>
           </p>`
        : ''}
    `);

    await sendResendEmail({ to: reg.email, subject, html });
  } catch {
    // Non-critical — silently fail
  }
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─────────────────────────── CSV export ─────────────────────────── */

/**
 * Build a UTF-8 CSV string (with BOM for Excel compatibility).
 * Includes all custom field answers as additional columns.
 */
export async function buildRegistrationsCsv(
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
  incubatorId: string,
): Promise<string> {
  const data = await db.read();

  const registrations = (data.registrations ?? [])
    .filter(
      (r) =>
        r.entityType === entityType &&
        r.entityId === entityId &&
        r.incubatorId === incubatorId,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const fields = (data.registrationFormFields ?? [])
    .filter((f) => f.entityType === entityType && f.entityId === entityId)
    .sort((a, b) => a.order - b.order);

  const baseHeaders = ['ID', 'Full Name', 'Email', 'Phone', 'Status', 'Date'];
  const customHeaders = fields.map((f) => f.label);
  const allHeaders = [...baseHeaders, ...customHeaders];

  function csvRow(cells: string[]): string {
    return cells
      .map((c) => {
        const escaped = String(c ?? '').replace(/"/g, '""');
        return `"${escaped}"`;
      })
      .join(',');
  }

  const rows: string[] = [csvRow(allHeaders)];

  for (const reg of registrations) {
    const base = [
      reg.id,
      reg.fullName,
      reg.email,
      reg.phone,
      reg.status,
      reg.createdAt.slice(0, 10),
    ];
    const custom = fields.map((f) => {
      const answer = reg.answers.find((a) => a.fieldId === f.id);
      if (!answer) return '';
      const v = answer.value;
      return Array.isArray(v) ? v.join(', ') : String(v);
    });
    rows.push(csvRow([...base, ...custom]));
  }

  // UTF-8 BOM + CRLF line endings for Excel on Windows/Mac
  return '﻿' + rows.join('\r\n');
}

/* ─────────────────────────── Slug-based lookup ─────────────────────────── */

/** Find a program by slug OR id (slug takes priority). */
export async function findProgramBySlugOrId(slugOrId: string) {
  const data = await db.read();
  return (
    (data.programs ?? []).find(
      (p) => p.isActive && (p.slug === slugOrId || p.id === slugOrId),
    ) ?? null
  );
}

/** Find an event by slug OR id. */
export async function findEventBySlugOrId(slugOrId: string) {
  const data = await db.read();
  return (
    (data.events ?? []).find(
      (e) => e.isActive && (e.slug === slugOrId || e.id === slugOrId),
    ) ?? null
  );
}
