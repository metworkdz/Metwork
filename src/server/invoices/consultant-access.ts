/**
 * The gate on every consultant invoicing route.
 *
 * Two conditions, in one place so six routes cannot drift apart: a valid
 * consultant session, and an APPROVED profile. Approval is the line (owner
 * decision 2026-10-02) — not a signed contract. The contract covers Metwork's
 * commission on platform bookings; an invoice is between the consultant and
 * their own client, and gating it on the contract would stop someone billing a
 * client who has nothing to do with the platform.
 */
import type { MentorRecord } from '@/server/db/store';
import { db } from '@/server/db/store';
import { jsonError } from '@/server/http/json';
import { isMentorApproved } from '@/lib/mentor-approval';
import { requireConsultant } from '@/server/mentors/access';
import type { InvoiceOwner } from '@/server/invoices/owner';

export type ConsultantInvoiceGuard =
  | { ok: true; owner: InvoiceOwner; mentor: MentorRecord }
  | { ok: false; response: Response };

export async function requireInvoicingConsultant(): Promise<ConsultantInvoiceGuard> {
  const guard = await requireConsultant();
  if (!guard.ok) return { ok: false, response: guard.response };

  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === guard.mentorId);
  if (!mentor) {
    return { ok: false, response: jsonError(404, 'NOT_FOUND', 'Consultant not found') };
  }
  if (!isMentorApproved(mentor)) {
    return {
      ok: false,
      response: jsonError(
        403,
        'NOT_APPROVED',
        'Votre profil doit être approuvé avant de pouvoir émettre des documents',
      ),
    };
  }

  return { ok: true, owner: { type: 'CONSULTANT', id: mentor.id }, mentor };
}
