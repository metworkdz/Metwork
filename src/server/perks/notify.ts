/**
 * Low-stock admin notification for CODE_POOL perks.
 *
 * Mirrors the fire-and-forget admin-email pattern in
 * src/server/notifications/mock.ts (sendAdminOrderNotification & friends):
 * void-returning, resolves the same recipient chain, delegates transport to
 * the existing sendResendEmail primitive, and NEVER throws — a failed email
 * must never block or roll back the claim that triggered it.
 *
 * De-duplication is NOT handled here: claimPerk() stamps
 * perk.lowStockNotifiedAt inside the claim lock, so exactly one claim per
 * depletion cycle receives a LowStockInfo payload to forward here.
 */
import { sendResendEmail, layout } from '@/server/notifications/email';
import type { LowStockInfo } from './service';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lowStockEmailHtml(info: LowStockInfo, manageUrl: string): string {
  return layout(`
    <h2 style="margin:0 0 16px">⚠️ Stock faible — codes partenaires</h2>
    <p style="margin:0 0 12px">
      Le stock de codes du perk <strong>${escapeHtml(info.perkTitle)}</strong>
      (partenaire&nbsp;: <strong>${escapeHtml(info.partnerName)}</strong>) est passé sous le seuil configuré.
    </p>
    <table style="border-collapse:collapse;margin:0 0 16px">
      <tr>
        <td style="padding:4px 12px 4px 0;color:#6b7280">Codes restants</td>
        <td style="padding:4px 0"><strong>${info.remaining}</strong></td>
      </tr>
      <tr>
        <td style="padding:4px 12px 4px 0;color:#6b7280">Seuil d'alerte</td>
        <td style="padding:4px 0">${info.threshold}</td>
      </tr>
    </table>
    <p style="margin:0 0 12px">
      Ajoutez de nouveaux codes depuis la page d'administration pour réarmer cette alerte.
    </p>
    <p style="margin:0">
      <a href="${manageUrl}" style="color:#2563eb">Gérer les perks →</a>
    </p>
  `);
}

/**
 * Fire-and-forget: notify the admin inbox that a perk's code pool is low.
 * Errors are logged and swallowed.
 */
export function sendPerkLowStockNotification(info: LowStockInfo): void {
  const adminEmail = process.env.CONTACT_EMAIL ?? process.env.EMAIL_FROM ?? 'contact@metwork.dz';
  const manageUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/dashboard/admin/perks`;

  sendResendEmail({
    to: adminEmail,
    subject: `[Metwork] Stock faible — ${info.perkTitle} (${info.remaining} code${info.remaining !== 1 ? 's' : ''} restant${info.remaining !== 1 ? 's' : ''})`,
    html: lowStockEmailHtml(info, manageUrl),
  })
    .then((sent) => {
      // eslint-disable-next-line no-console
      console.log(
        `[perks] ADMIN LOW-STOCK NOTIF ${sent ? 'sent' : '(no Resend)'} → ${adminEmail} :: ${info.perkTitle} (${info.remaining}/${info.threshold})`,
      );
    })
    .catch((err: Error) =>
      // eslint-disable-next-line no-console
      console.error('[perks] Admin low-stock notification failed →', err.message),
    );
}
