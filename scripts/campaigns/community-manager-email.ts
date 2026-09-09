/**
 * Marketing email — "Devenir un Community Manager" (29–30 sept. & 1er oct.).
 *
 * Built for real inboxes, which means table layout and inline styles only:
 * Gmail strips <style> blocks, Outlook ignores flexbox and most modern CSS,
 * and anything relying on them silently collapses into a single column of
 * unstyled text. Everything below is deliberately boring HTML for that reason.
 *
 * TYPEFACES. The platform uses Plus Jakarta Sans for display and Inter for
 * body (see `src/app/[locale]/layout.tsx`). Both are linked from Google Fonts
 * and named first in every font stack, so Apple Mail, iOS Mail and Samsung
 * Mail render the real thing. Gmail and Outlook strip webfonts outright and
 * will use the fallbacks — that is not fixable in email, so the stacks are
 * chosen to degrade to something close (Segoe UI / Roboto / Helvetica) rather
 * than to Times.
 *
 * Every figure is read from production at send time by the calling script, not
 * hardcoded here — a price or a seat count that drifts out of date in a
 * mailshot is worse than no mailshot.
 */

export interface CampaignFacts {
  registerUrl: string;
  /** Human dates, e.g. "29 – 30 septembre & 1er octobre". */
  dates: string;
  /** "09:00", or null when no start time is published. */
  startTime: string | null;
  city: string;
  trainerName: string;
  trainerTitle: string;
  onlinePrice: number;
  cashPrice: number;
  /** Deposit due online for a cash booking (integer DZD), or null. */
  deposit: number | null;
  seatsLeft: number;
  /** Human deadline, e.g. "28 septembre". */
  deadline: string;
  /** Absolute https URL of the poster. Omitted ⇒ the block is left out. */
  posterUrl?: string | null;
}

const GREEN = '#30a735';
const INK = '#0f1d14';
const MUTED = '#5c6b60';
const RULE = '#e2e7e2';
const PAPER = '#f4f6f3';

/** Headlines — the platform's display face. */
const DISPLAY =
  "'Plus Jakarta Sans','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** Body — the platform's text face. */
const BODY =
  "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const dzd = (n: number): string => `${n.toLocaleString('fr-DZ').replace(/ | /g, ' ')} DZD`;

/**
 * Serve the poster through Cloudinary's transform pipeline when it is hosted
 * there. The original upload is a 1.4 MB PNG at 2320px; `w_1200,f_auto,q_auto`
 * returns the same picture at ~126 KB, which matters a great deal on Algerian
 * mobile data. A URL from anywhere else is passed through untouched.
 */
export function emailPosterUrl(url: string): string {
  const marker = '/image/upload/';
  const i = url.indexOf(marker);
  if (!url.includes('res.cloudinary.com') || i === -1) return url;
  const head = url.slice(0, i + marker.length);
  const tail = url.slice(i + marker.length);
  // Already transformed (a segment with Cloudinary options) — leave it alone.
  if (/^[a-z]_[^/]+\//.test(tail)) return url;
  return `${head}w_1200,f_auto,q_auto/${tail}`;
}

const LEARN = [
  ['Créer & optimiser vos pages', 'Facebook, Instagram, LinkedIn, TikTok'],
  ['Définir votre stratégie de contenu', 'ligne éditoriale, calendrier, formats qui performent'],
  ['Publicités Meta, TikTok & LinkedIn', 'ciblage, budget, lecture des résultats'],
  ['Gérer votre communauté au quotidien', 'réponses, modération, relation client'],
  ["L'IA au service du Community Manager", 'idées, rédaction, visuels — sans perdre votre voix'],
] as const;

/** One "✓ title — detail" row. */
function learnRow(title: string, detail: string): string {
  return `
    <tr>
      <td style="padding:0 0 14px;vertical-align:top;width:26px;">
        <div style="width:20px;height:20px;border-radius:10px;background:${GREEN};color:#ffffff;
                    font:700 12px/20px ${BODY};text-align:center;">&#10003;</div>
      </td>
      <td style="padding:0 0 14px;font:400 15px/1.5 ${BODY};color:${INK};">
        <strong style="color:${INK};font-weight:600;">${title}</strong><br />
        <span style="color:${MUTED};font-size:14px;">${detail}</span>
      </td>
    </tr>`;
}

export function communityManagerEmailHtml(f: CampaignFacts): string {
  const preheader =
    `${f.dates} à ${f.city} — 3 jours avec ${f.trainerName}. ` +
    `Plus que ${f.seatsLeft} place${f.seatsLeft > 1 ? 's' : ''}.`;

  // The poster is the message. It leads, and it is a link — people tap images.
  const poster = f.posterUrl
    ? `<tr><td style="padding:0;background:${PAPER};">
         <a href="${f.registerUrl}" style="display:block;text-decoration:none;">
           <img src="${emailPosterUrl(f.posterUrl)}"
                alt="Formation — Devenir un Community Manager, ${f.dates}, avec ${f.trainerName}"
                width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;
                                   outline:none;text-decoration:none;" />
         </a>
       </td></tr>`
    : '';

  const button = (label: string) => `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr><td style="border-radius:10px;background:${GREEN};">
        <a href="${f.registerUrl}"
           style="display:inline-block;padding:16px 34px;font:700 16px/1 ${DISPLAY};
                  color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
      </td></tr>
    </table>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>Formation — Devenir un Community Manager</title>
<!-- The platform's typefaces. Honoured by Apple Mail / iOS / Samsung Mail;
     Gmail and Outlook strip webfonts and use the fallback stacks. -->
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:${PAPER};">
  <!-- Preheader: the grey line next to the subject in the inbox. Hidden in the
       body itself, which is why it is followed by padding characters. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}
    &#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${RULE};border-radius:14px;overflow:hidden;">

        ${poster}

        <!-- Headline -->
        <tr><td style="padding:32px 32px 0;">
          <p style="margin:0 0 10px;font:700 12px/1 ${DISPLAY};letter-spacing:2px;color:${GREEN};">
            FORMATION · 3 JOURS
          </p>
          <h1 style="margin:0 0 12px;font:800 30px/1.2 ${DISPLAY};color:${INK};letter-spacing:-0.5px;">
            Devenir un Community&nbsp;Manager
          </h1>
          <p style="margin:0 0 20px;font:400 16px/1.6 ${BODY};color:${MUTED};">
            Gérer des réseaux sociaux qui performent vraiment, ça s'apprend.
            Trois jours pour passer de « je poste » à « je pilote ».
          </p>
        </td></tr>

        <!-- Logistics -->
        <tr><td style="padding:0 32px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="background:${PAPER};border-radius:10px;">
            <tr><td style="padding:16px 20px;font:400 15px/1.7 ${BODY};color:${INK};">
              <strong style="font-weight:600;">${f.dates}</strong>${
                f.startTime ? ` &middot; à partir de ${f.startTime}` : ''
              }<br />
              <span style="color:${MUTED};">${f.city} &middot; animée par ${f.trainerName}, ${f.trainerTitle}</span>
            </td></tr>
          </table>
        </td></tr>

        <!-- Programme -->
        <tr><td style="padding:0 32px 8px;">
          <h2 style="margin:0 0 16px;font:700 13px/1 ${DISPLAY};letter-spacing:1.5px;color:${INK};">
            CE QUE VOUS ALLEZ <span style="color:${GREEN};">APPRENDRE</span>
          </h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${LEARN.map(([t, d]) => learnRow(t, d)).join('')}
          </table>
        </td></tr>

        <!-- Price -->
        <tr><td style="padding:8px 32px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border:1px solid ${RULE};border-radius:10px;">
            <tr>
              <td width="50%" style="padding:16px 20px;border-right:1px solid ${RULE};text-align:center;">
                <div style="font:700 20px/1.2 ${DISPLAY};color:${GREEN};">${dzd(f.onlinePrice)}</div>
                <div style="font:400 13px/1.6 ${BODY};color:${MUTED};">en payant par carte</div>
              </td>
              <td width="50%" style="padding:16px 20px;text-align:center;">
                <div style="font:700 20px/1.2 ${DISPLAY};color:${INK};">${dzd(f.cashPrice)}</div>
                <div style="font:400 13px/1.6 ${BODY};color:${MUTED};">en espèces</div>
              </td>
            </tr>
            ${
              f.deposit
                ? `<tr><td colspan="2" style="padding:12px 20px;border-top:1px solid ${RULE};text-align:center;
                          font:400 13px/1.6 ${BODY};color:${MUTED};">
                     Vous préférez payer en espèces ? Réservez avec un acompte de
                     <strong style="color:${INK};font-weight:600;">${dzd(f.deposit)}</strong>, le reste sur place.
                   </td></tr>`
                : ''
            }
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:0 32px 10px;">${button('Je réserve ma place')}</td></tr>
        <tr><td style="padding:0 32px 28px;text-align:center;font:400 13px/1.6 ${BODY};color:${MUTED};">
          Il reste <strong style="color:${INK};font-weight:600;">${f.seatsLeft} place${
            f.seatsLeft > 1 ? 's' : ''
          }</strong> &middot; inscriptions jusqu'au ${f.deadline}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 32px;background:${PAPER};border-top:1px solid ${RULE};
                       font:400 12px/1.7 ${BODY};color:${MUTED};">
          Vous recevez cet email parce que vous faites partie du réseau Metwork.<br />
          <a href="${f.registerUrl}" style="color:${GREEN};">Voir la formation</a>
          &middot; <a href="https://metwork.dz" style="color:${GREEN};">metwork.dz</a>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Subject lines. The first is the one sent; the rest are alternates to try. */
export const SUBJECTS = [
  'Devenir Community Manager en 3 jours — 29 sept. à Oran',
  'Il reste quelques places : formation Community Manager',
  '3 jours pour maîtriser les réseaux sociaux (et la pub)',
] as const;
