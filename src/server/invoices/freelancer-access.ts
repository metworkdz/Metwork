/**
 * The gate on every freelancer invoicing / client / payment-link route, and
 * the freelancer side of the letterhead settings.
 *
 * Freelancers need no approval to invoice — an invoice is between them and
 * their own client. The legal gate (`issuerLegalGate`) still refuses a
 * document without a name, registration number and NIF, exactly as for
 * consultants and incubators.
 */
import { db } from '@/server/db/store';
import { requireApiRole } from '@/server/auth/api-guards';
import { applyInvoiceSettingsPatch, type ConsultantInvoiceSettings } from '@/server/invoices/consultant-settings';
import { emptyProfile } from '@/server/freelancers/service';
import { findIssuer, invoicesFor, issuerLegalGate, peekNextSeqFor, type InvoiceOwner } from '@/server/invoices/owner';
import type { SessionUser } from '@/types/auth';
import { jsonError } from '@/server/http/json';
import { entitlementsForUser, withinLimit } from '@/lib/entitlements';

export type FreelancerInvoiceGuard =
  | { ok: true; owner: InvoiceOwner; user: SessionUser }
  | { ok: false; response: Response };

export async function requireInvoicingFreelancer(): Promise<FreelancerInvoiceGuard> {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return { ok: false, response: guard.response };
  await ensureFreelancerProfile(guard.user.id);
  return { ok: true, owner: { type: 'FREELANCER', id: guard.user.id }, user: guard.user };
}

/**
 * The issuer record is the profile (it holds the counters), so it must exist
 * before a first document. Created empty, once.
 */
async function ensureFreelancerProfile(userId: string): Promise<void> {
  const data = await db.read();
  if (data.freelancerProfiles?.some((p) => p.userId === userId)) return;
  const now = new Date().toISOString();
  await db.update((d) => {
    if (!Array.isArray(d.freelancerProfiles)) d.freelancerProfiles = [];
    if (!d.freelancerProfiles.some((p) => p.userId === userId)) d.freelancerProfiles.push(emptyProfile(userId, now));
  });
}

/**
 * Patch the freelancer letterhead. A registration number left empty is
 * pre-filled from an APPROVED business document — the same number the
 * automatic review already read and checked.
 */
export async function updateFreelancerInvoiceSettings(userId: string, patch: ConsultantInvoiceSettings): Promise<boolean> {
  return db.update((d) => {
    const p = d.freelancerProfiles?.find((x) => x.userId === userId);
    if (!p) return false;
    const settings = { ...(p.invoiceSettings ?? {}) };
    applyInvoiceSettingsPatch(settings, patch);
    if (!settings.invoiceRegNumber && p.legal?.review.state === 'APPROVED' && p.legal.extracted?.documentNumber) {
      settings.invoiceRegNumber = p.legal.extracted.documentNumber;
      settings.invoiceLegalStatus ??= p.legal.documentKind === 'AUTO_ENTREPRENEUR_CARD' ? 'AUTO_ENTREPRENEUR' : 'REGISTRE_COMMERCE';
    }
    p.invoiceSettings = settings;
    p.updatedAt = new Date().toISOString();
    return true;
  });
}

export type FreelancerQuota = 'document' | 'client' | 'paymentLink';

/**
 * The Free-plan limits, enforced where the thing is created. Returns the 403
 * to send, or null when the freelancer may go ahead. Limits come from the one
 * entitlements table; Premium is unlimited.
 *
 *   document     — invoices, proformas and devis created this calendar month (UTC)
 *   client       — clients in the book
 *   paymentLink  — payment links currently ACTIVE (paid or cancelled ones free a slot)
 */
export async function freelancerQuotaRefusal(userId: string, quota: FreelancerQuota): Promise<Response | null> {
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  const ent = user ? entitlementsForUser(user) : null;
  if (!ent || ent.audience !== 'FREELANCER') return null;
  const limit =
    quota === 'document' ? ent.invoicesPerMonth : quota === 'client' ? ent.clients : ent.activePaymentLinks;
  if (limit === null) return null;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const used =
    quota === 'document'
      ? (data.invoices ?? []).filter((i) => i.freelancerId === userId && new Date(i.createdAt) >= monthStart).length
      : quota === 'client'
        ? (data.clients ?? []).filter((c) => c.freelancerId === userId).length
        : (data.paymentLinks ?? []).filter((l) => l.freelancerId === userId && l.status === 'ACTIVE').length;
  if (withinLimit(limit, used)) return null;
  return jsonError(403, 'PLAN_LIMIT_REACHED', 'Free plan limit reached — upgrade to Premium for unlimited use', { limit, used });
}

/** Everything the freelancer invoicing pages need from the store, in one read. */
export function freelancerInvoicingContext(data: Awaited<ReturnType<typeof db.read>>, userId: string) {
  const owner: InvoiceOwner = { type: 'FREELANCER', id: userId };
  const issuer = findIssuer(data, owner);
  const year = new Date().getUTCFullYear();
  return {
    owner,
    issuer: issuer?.profile ?? null,
    legalComplete: issuer ? issuerLegalGate(issuer.profile, 'ESPECE', owner).ok : false,
    hasBankRib: !!issuer?.profile.bankRib,
    hasStamp: !!issuer?.profile.stampUrl,
    year,
    nextSeq: issuer ? peekNextSeqFor(issuer.counterHolder, year) : { FACTURE: 1, PROFORMA: 1, DEVIS: 1 },
    invoices: invoicesFor(data, owner),
  };
}
