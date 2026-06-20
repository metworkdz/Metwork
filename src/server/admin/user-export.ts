/**
 * Admin user export — shared filtering + row building for CSV and XLSX.
 *
 * The export never leaks more than the admin already sees in the Users table:
 * full name, email, phone, role, membership tier, status, created date, locale.
 * passwordHash and other sensitive fields are never included.
 */
import ExcelJS from 'exceljs';
import type { UserRecord, MembershipTier } from '@/server/db/store';
import type { UserRole, UserStatus } from '@/types/auth';

export interface UserExportFilters {
  role?: UserRole;
  status?: UserStatus;
  tier?: MembershipTier;
  /** Inclusive lower bound on createdAt (YYYY-MM-DD or ISO). */
  from?: string;
  /** Inclusive upper bound on createdAt (YYYY-MM-DD or ISO). */
  to?: string;
  /** Free-text search over name + email (mirrors the table search). */
  q?: string;
}

/** Resolve a user's effective Network Pass tier (defaults to EXPLORER). */
export function resolveTier(u: Pick<UserRecord, 'membershipTier'>): MembershipTier {
  return u.membershipTier ?? 'EXPLORER';
}

/** Apply the export filters. Bounds are interpreted on the calendar day. */
export function filterUsersForExport(
  users: UserRecord[],
  filters: UserExportFilters,
): UserRecord[] {
  const q = filters.q?.trim().toLowerCase();
  // Normalise the date range to day boundaries so "to" is inclusive.
  const fromMs = filters.from ? Date.parse(filters.from) : null;
  const toRaw = filters.to ? new Date(filters.to) : null;
  if (toRaw) toRaw.setUTCHours(23, 59, 59, 999);
  const toMs = toRaw ? toRaw.getTime() : null;

  return users.filter((u) => {
    if (filters.role && u.role !== filters.role) return false;
    if (filters.status && u.status !== filters.status) return false;
    if (filters.tier && resolveTier(u) !== filters.tier) return false;

    const createdMs = Date.parse(u.createdAt);
    if (fromMs !== null && !Number.isNaN(fromMs) && createdMs < fromMs) return false;
    if (toMs !== null && !Number.isNaN(toMs) && createdMs > toMs) return false;

    if (q) {
      const hay = `${u.fullName} ${u.email}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export interface UserExportRow {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  membershipTier: string;
  status: string;
  createdDate: string;
  locale: string;
}

const COLUMNS: Array<{ header: string; key: keyof UserExportRow; width: number }> = [
  { header: 'Full name',      key: 'fullName',       width: 28 },
  { header: 'Email',          key: 'email',          width: 30 },
  { header: 'Phone',          key: 'phone',          width: 18 },
  { header: 'Role',           key: 'role',           width: 14 },
  { header: 'Membership tier',key: 'membershipTier', width: 16 },
  { header: 'Status',         key: 'status',         width: 18 },
  { header: 'Created date',   key: 'createdDate',    width: 14 },
  { header: 'Locale',         key: 'locale',         width: 8 },
];

export function toExportRow(u: UserRecord): UserExportRow {
  return {
    fullName:       u.fullName,
    email:          u.email,
    phone:          u.phone ?? '',
    role:           u.role,
    membershipTier: resolveTier(u),
    status:         u.status,
    createdDate:    u.createdAt ? u.createdAt.slice(0, 10) : '',
    locale:         u.locale ?? '',
  };
}

/** Escape a single CSV field per RFC 4180. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildUsersCsv(users: UserRecord[]): string {
  const header = COLUMNS.map((c) => csvCell(c.header)).join(',');
  const lines = users.map((u) => {
    const row = toExportRow(u);
    return COLUMNS.map((c) => csvCell(String(row[c.key] ?? ''))).join(',');
  });
  // Prepend a UTF-8 BOM so Excel opens accented/Arabic names correctly.
  return '﻿' + [header, ...lines].join('\r\n');
}

export async function buildUsersXlsx(users: UserRecord[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Metwork';
  wb.created = new Date();
  const ws = wb.addWorksheet('Users');

  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };

  for (const u of users) {
    ws.addRow(toExportRow(u));
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
