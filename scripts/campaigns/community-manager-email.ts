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
 * Every figure — price, deposit, seats left, promo code and what is left of
 * it — is read from production at send time by the calling script, not
 * hardcoded here. A price or a seat count that drifts out of date in a
 * mailshot is worse than no mailshot, and a promo code that has expired or
 * run out is worse still: it turns an offer into an apology.
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
  /**
   * The code to advertise, or null for none. `remainingUses` is what is LEFT
   * — the cap minus the redemptions already spent — so the email never
   * promises places the code can no longer honour.
   */
  promo?: {
    code: string;
    percent: number;
    remainingUses: number | null;
    /** Human date the code stops working, e.g. "27 septembre", or null. */
    expires: string | null;
  } | null;
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

/**
 * "23 000 DZD", with every space non-breaking so a price never wraps in half.
 *
 * `fr-DZ` groups thousands with U+202F (a narrow no-break space). That byte is
 * legal UTF-8 and most clients draw it correctly, but a client whose fallback
 * font lacks the glyph draws a box in the middle of the price instead — so it
 * is converted to `&nbsp;`, which every mail client has understood for
 * decades. (The previous version of this line tried the same thing with a
 * regex whose special characters had been flattened to ASCII spaces somewhere
 * along the way, making it a no-op that replaced spaces with spaces.)
 *
 * The space before "DZD" stays BREAKABLE on purpose. Gluing it on made
 * "23 000 DZD" a single 120px token, and two of those side by side in the
 * price table set a floor the whole email could not shrink below on a phone.
 */
const dzd = (n: number): string =>
  `${n.toLocaleString('fr-DZ').replace(/[\u202f\u00a0\u2009 ]/g, '&nbsp;')} DZD`;

/**
 * What a promo code actually leaves to pay.
 *
 * This MUST match `validatePromoCodeSync` in `@/server/promo-codes/service`
 * — same percentage, same rounding — or the email quotes a price the checkout
 * then contradicts, which is the one mistake a price in a mailshot cannot
 * survive. `src/__tests__/campaign-email-promo.test.ts` holds the two together.
 */
export function discountedPrice(amount: number, percent: number): number {
  return Math.max(0, amount - Math.round(amount * (percent / 100)));
}

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

/** Where an opt-out request lands. Also the Reply-To on the send. */
export const UNSUBSCRIBE_MAILBOX = 'contact@metwork.dz';

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
    `Plus que ${f.seatsLeft} place${f.seatsLeft > 1 ? 's' : ''}.` +
    (f.promo ? ` Code ${f.promo.code} : −${f.promo.percent} %.` : '');

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

  // The code, and what it leaves to pay on each rail. A percentage alone makes
  // the reader do arithmetic; the resulting number is the persuasive part.
  const promoLimits = f.promo
    ? [
        f.promo.remainingUses == null
          ? null
          : f.promo.remainingUses === 1
            ? 'valable pour une seule inscription'
            : `valable pour les ${f.promo.remainingUses} premières inscriptions`,
        f.promo.expires ? `jusqu'au ${f.promo.expires}` : null,
      ].filter(Boolean)
    : [];

  const promoBlock = f.promo
    ? `<tr><td style="padding:0 24px 24px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                style="border:2px dashed ${GREEN};border-radius:10px;background:#f1f9f2;">
           <tr><td style="padding:18px 20px;text-align:center;">
             <div style="font:600 11px/1 ${BODY};letter-spacing:2px;color:${MUTED};">CODE PROMO</div>
             <div style="margin:8px 0 8px;font:800 26px/1.1 ${DISPLAY};letter-spacing:3px;color:${GREEN};">
               ${f.promo.code}
             </div>
             <div style="font:400 14px/1.6 ${BODY};color:${INK};">
               <strong style="font-weight:600;">&minus;${f.promo.percent}&nbsp;%</strong> &agrave; l'inscription :
               <strong style="font-weight:600;">${dzd(discountedPrice(f.onlinePrice, f.promo.percent))}</strong> par carte${
                 f.cashPrice !== f.onlinePrice
                   ? ` &middot; <strong style="font-weight:600;">${dzd(
                       discountedPrice(f.cashPrice, f.promo.percent),
                     )}</strong> en esp&egrave;ces`
                   : ''
               }
             </div>
             ${
               promoLimits.length
                 ? `<div style="margin-top:8px;font:400 12px/1.6 ${BODY};color:${MUTED};">${promoLimits.join(
                     ' &middot; ',
                   )}</div>`
                 : ''
             }
           </td></tr>
         </table>
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
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <!-- width:100% + max-width, NOT width:600px + max-width:100%.
           The outer table's layout is auto, so a 600px-wide child makes the
           containing cell 600px wide too — and a max-width of 100% OF THAT is
           600px, which caps nothing. The card then never shrank, and a 375px
           phone got the whole email zoomed out to fit. Outlook ignores
           max-width, hence the conditional 600px cage around it. -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${RULE};border-radius:14px;overflow:hidden;">

        ${poster}

        <!-- Headline -->
        <tr><td style="padding:28px 24px 0;">
          <p style="margin:0 0 10px;font:700 12px/1 ${DISPLAY};letter-spacing:2px;color:${GREEN};">
            FORMATION · 3 JOURS
          </p>
          <h1 style="margin:0 0 12px;font:800 30px/1.2 ${DISPLAY};color:${INK};letter-spacing:-0.5px;">
            Devenir un Community Manager
          </h1>
          <p style="margin:0 0 20px;font:400 16px/1.6 ${BODY};color:${MUTED};">
            Gérer des réseaux sociaux qui performent vraiment, ça s'apprend.
            Trois jours pour passer de « je poste » à « je pilote ».
          </p>
        </td></tr>

        <!-- Logistics -->
        <tr><td style="padding:0 24px 24px;">
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
        <tr><td style="padding:0 24px 8px;">
          <h2 style="margin:0 0 16px;font:700 13px/1 ${DISPLAY};letter-spacing:1.5px;color:${INK};">
            CE QUE VOUS ALLEZ <span style="color:${GREEN};">APPRENDRE</span>
          </h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${LEARN.map(([t, d]) => learnRow(t, d)).join('')}
          </table>
        </td></tr>

        <!-- Price -->
        <tr><td style="padding:8px 24px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border:1px solid ${RULE};border-radius:10px;">
            <tr>
              <td width="50%" style="padding:16px 12px;border-right:1px solid ${RULE};text-align:center;">
                <div style="font:700 20px/1.2 ${DISPLAY};color:${GREEN};">${dzd(f.onlinePrice)}</div>
                <div style="font:400 13px/1.6 ${BODY};color:${MUTED};">en payant par carte</div>
              </td>
              <td width="50%" style="padding:16px 12px;text-align:center;">
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

        ${promoBlock}

        <!-- CTA -->
        <tr><td style="padding:0 24px 10px;">${button('Je réserve ma place')}</td></tr>
        <tr><td style="padding:0 24px 28px;text-align:center;font:400 13px/1.6 ${BODY};color:${MUTED};">
          Il reste <strong style="color:${INK};font-weight:600;">${f.seatsLeft} place${
            f.seatsLeft > 1 ? 's' : ''
          }</strong> &middot; inscriptions jusqu'au ${f.deadline}
        </td></tr>

        <!-- Footer.
             The opt-out is not decoration. Without a visible way to leave,
             the people who want out press "Report spam" instead, and that
             verdict follows the DOMAIN — it would start pushing Metwork's OTP
             codes and booking confirmations into spam folders too. One
             marketing send is not worth the transactional mail. -->
        <tr><td style="padding:20px 24px;background:${PAPER};border-top:1px solid ${RULE};
                       font:400 12px/1.7 ${BODY};color:${MUTED};">
          Vous recevez cet email parce que vous faites partie du réseau Metwork.<br />
          <a href="${f.registerUrl}" style="color:${GREEN};">Voir la formation</a>
          &middot; <a href="https://metwork.dz" style="color:${GREEN};">metwork.dz</a>
          &middot; <a href="mailto:${UNSUBSCRIBE_MAILBOX}?subject=Desabonnement&body=Merci%20de%20me%20retirer%20de%20la%20liste."
                      style="color:${MUTED};text-decoration:underline;">Se désabonner</a><br />
          <span style="color:${MUTED};">Une question ? Répondez simplement à cet email.</span>
        </td></tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * The plain-text half of the message.
 *
 * Not a formality: a bulk HTML email with no text/plain alternative is one of
 * the oldest spam heuristics there is, and it is the version shown by
 * text-only clients, by accessibility tooling, and in the preview pane of
 * anything that refuses to load remote content. It has to say everything the
 * HTML says, including how to leave the list.
 */
export function communityManagerEmailText(f: CampaignFacts): string {
  const plain = (n: number) => `${n.toLocaleString('fr-DZ').replace(/[\u202f\u00a0\u2009]/g, ' ')} DZD`;
  const lines = [
    'FORMATION · 3 JOURS',
    'Devenir un Community Manager',
    '',
    "Gérer des réseaux sociaux qui performent vraiment, ça s'apprend.",
    'Trois jours pour passer de « je poste » à « je pilote ».',
    '',
    `${f.dates}${f.startTime ? ` · à partir de ${f.startTime}` : ''}`,
    `${f.city} · animée par ${f.trainerName}, ${f.trainerTitle}`,
    '',
    'CE QUE VOUS ALLEZ APPRENDRE',
    ...LEARN.map(([t, d]) => `  - ${t} (${d})`),
    '',
    `Tarif : ${plain(f.onlinePrice)} en payant par carte, ${plain(f.cashPrice)} en espèces.`,
    ...(f.deposit
      ? [`Vous préférez payer en espèces ? Réservez avec un acompte de ${plain(f.deposit)}, le reste sur place.`]
      : []),
    ...(f.promo
      ? [
          '',
          `CODE PROMO ${f.promo.code} — ${f.promo.percent} % de réduction :`,
          `  ${plain(discountedPrice(f.onlinePrice, f.promo.percent))} par carte` +
            (f.cashPrice !== f.onlinePrice
              ? `, ${plain(discountedPrice(f.cashPrice, f.promo.percent))} en espèces`
              : ''),
          ...(f.promo.remainingUses != null || f.promo.expires
            ? [
                '  (' +
                  [
                    f.promo.remainingUses == null
                      ? null
                      : f.promo.remainingUses === 1
                        ? 'valable pour une seule inscription'
                        : `valable pour les ${f.promo.remainingUses} premières inscriptions`,
                    f.promo.expires ? `jusqu'au ${f.promo.expires}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') +
                  ')',
              ]
            : []),
        ]
      : []),
    '',
    `Je réserve ma place : ${f.registerUrl}`,
    `Il reste ${f.seatsLeft} place${f.seatsLeft > 1 ? 's' : ''} · inscriptions jusqu'au ${f.deadline}`,
    '',
    '—',
    'Vous recevez cet email parce que vous faites partie du réseau Metwork.',
    `Pour ne plus recevoir nos emails, répondez « désabonnement » ou écrivez à ${UNSUBSCRIBE_MAILBOX}.`,
    'metwork.dz',
  ];
  return lines.join('\n');
}

/** Subject lines. The first is the one sent; the rest are alternates to try. */
export const SUBJECTS = [
  'Formation: Devenir un community manager - Inscription',
  'Devenir Community Manager en 3 jours — 29 sept. à Oran',
  'Il reste quelques places : formation Community Manager',
  '3 jours pour maîtriser les réseaux sociaux (et la pub)',
] as const;
