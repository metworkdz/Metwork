/**
 * Refund emails — en / fr / ar (Arabic renders RTL), one pattern for all four:
 *
 *   ACCOUNT_REQUEST  — guest: "your refund was accepted, tell us where to send it"
 *   ACCOUNT_RECEIVED — guest: "we have your account, the transfer is coming"
 *   WALLET_CREDITED  — registered client: refund landed in the Metwork wallet
 *   TRANSFER_SENT    — guest: the bank/CCP transfer has been sent
 *   DECLINED         — the request was not accepted
 *
 * Every send is awaited by its caller (an unawaited send is dropped when the
 * lambda freezes) and never throws, so a mail failure cannot undo a refund.
 */
import { button, h1, layout, normalizeEmailLang, p, sendResendEmail, type EmailLang } from './email';
import { recordE2eEmail } from './e2e-email-sink';

export type RefundEmailKind =
  | 'ACCOUNT_REQUEST'
  | 'ACCOUNT_RECEIVED'
  | 'WALLET_CREDITED'
  | 'TRANSFER_SENT'
  | 'DECLINED';

export interface RefundEmailInput {
  kind: RefundEmailKind;
  to: string;
  lang?: string | null;
  clientName: string;
  itemName: string;
  amount: number;
  /** ACCOUNT_REQUEST only: the personal link (contains the unhashed token). */
  accountUrl?: string;
  /** ACCOUNT_REQUEST only: ISO expiry of the link. */
  expiresAt?: string | null;
  /** DECLINED only. */
  reason?: string | null;
  /** TRANSFER_SENT only. */
  transferReference?: string | null;
  /** WALLET_CREDITED only: link to the wallet. */
  walletUrl?: string;
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const LOCALE: Record<EmailLang, string> = { en: 'en-GB', fr: 'fr-DZ', ar: 'ar-DZ' };

function money(amount: number, lang: EmailLang): string {
  return `${amount.toLocaleString(LOCALE[lang])} DZD`;
}

interface Copy {
  subject: string;
  title: string;
  body: string[];
  cta?: { href: string; label: string };
  note?: string;
}

function copyFor(input: RefundEmailInput, lang: EmailLang): Copy {
  const name = esc(input.clientName || '');
  const item = esc(input.itemName);
  const amt = `<strong>${money(input.amount, lang)}</strong>`;
  const amtPlain = money(input.amount, lang);
  const expires = input.expiresAt
    ? new Date(input.expiresAt).toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const ref = input.transferReference ? esc(input.transferReference) : null;
  const reason = input.reason ? esc(input.reason) : null;

  const T = {
    fr: {
      hi: `Bonjour ${name},`,
      ACCOUNT_REQUEST: {
        subject: `Votre remboursement de ${amtPlain}`,
        title: `Votre remboursement de ${amtPlain}`,
        body: [
          `Votre demande de remboursement pour « ${item} » a été acceptée.`,
          `Pour vous rembourser ${amt}, indiquez le compte bancaire ou CCP qui recevra le virement.`,
        ],
        label: 'Indiquer mon compte',
        note: `Ce lien est personnel${expires ? ` et valable jusqu'au ${expires}` : ''}. Ne le partagez pas. Le virement est effectué sous 3 à 5 jours ouvrés après réception de votre compte.`,
      },
      ACCOUNT_RECEIVED: {
        subject: `Compte reçu — remboursement de ${amtPlain}`,
        title: 'Nous avons bien reçu votre compte',
        body: [`Votre remboursement de ${amt} pour « ${item} » sera viré sous 3 à 5 jours ouvrés. Vous recevrez un email dès que le virement sera envoyé.`],
      },
      WALLET_CREDITED: {
        subject: `Remboursement de ${amtPlain} sur votre wallet`,
        title: 'Votre remboursement est arrivé',
        body: [
          `Votre remboursement pour « ${item} » est accepté : ${amt} ont été remis sur votre wallet Metwork.`,
          'Vous pouvez utiliser ce solde pour un prochain paiement ou le retirer vers votre compte bancaire ou CCP depuis votre wallet.',
        ],
        label: 'Ouvrir mon wallet',
      },
      TRANSFER_SENT: {
        subject: `Remboursement envoyé — ${amtPlain}`,
        title: 'Votre remboursement a été envoyé',
        body: [
          `Nous avons viré ${amt} sur le compte que vous avez indiqué, pour « ${item} ».`,
          ref ? `Référence du virement : <strong>${ref}</strong>.` : '',
          'Les fonds apparaissent généralement sous 3 jours ouvrés.',
        ],
      },
      DECLINED: {
        subject: `Demande de remboursement — ${item}`,
        title: 'Votre demande n’a pas été acceptée',
        body: [
          `Nous n’avons pas pu accepter votre demande de remboursement pour « ${item} ».`,
          reason ? `Motif : ${reason}` : '',
          'Pour toute question, répondez à cet email ou contactez notre support.',
        ],
      },
    },
    en: {
      hi: `Hi ${name},`,
      ACCOUNT_REQUEST: {
        subject: `Your refund of ${amtPlain}`,
        title: `Your refund of ${amtPlain}`,
        body: [
          `Your refund request for “${item}” was accepted.`,
          `To refund ${amt}, tell us which bank or CCP account should receive the transfer.`,
        ],
        label: 'Enter my account',
        note: `This link is personal${expires ? ` and valid until ${expires}` : ''}. Please don’t share it. The transfer is sent within 3 to 5 business days of receiving your account.`,
      },
      ACCOUNT_RECEIVED: {
        subject: `Account received — refund of ${amtPlain}`,
        title: 'We have your account',
        body: [`Your refund of ${amt} for “${item}” will be transferred within 3 to 5 business days. We’ll email you as soon as it is sent.`],
      },
      WALLET_CREDITED: {
        subject: `Refund of ${amtPlain} added to your wallet`,
        title: 'Your refund has arrived',
        body: [
          `Your refund for “${item}” was accepted: ${amt} was added to your Metwork wallet.`,
          'You can use the balance on a future payment, or withdraw it to your bank or CCP account from your wallet.',
        ],
        label: 'Open my wallet',
      },
      TRANSFER_SENT: {
        subject: `Refund sent — ${amtPlain}`,
        title: 'Your refund has been sent',
        body: [
          `We transferred ${amt} to the account you gave us, for “${item}”.`,
          ref ? `Transfer reference: <strong>${ref}</strong>.` : '',
          'The funds usually show up within 3 business days.',
        ],
      },
      DECLINED: {
        subject: `Refund request — ${item}`,
        title: 'Your request was not accepted',
        body: [
          `We couldn’t accept your refund request for “${item}”.`,
          reason ? `Reason: ${reason}` : '',
          'If you have questions, reply to this email or contact our support team.',
        ],
      },
    },
    ar: {
      hi: `مرحبًا ${name}،`,
      ACCOUNT_REQUEST: {
        subject: `استرجاع مبلغ ${amtPlain}`,
        title: `استرجاع مبلغ ${amtPlain}`,
        body: [
          `تمت الموافقة على طلب الاسترجاع الخاص بـ «${item}».`,
          `لاسترجاع ${amt}، يرجى إدخال الحساب البنكي أو حساب CCP الذي سيستقبل التحويل.`,
        ],
        label: 'إدخال حسابي',
        note: `هذا الرابط شخصي${expires ? ` وصالح حتى ${expires}` : ''}. يرجى عدم مشاركته. يتم التحويل خلال 3 إلى 5 أيام عمل بعد استلام حسابك.`,
      },
      ACCOUNT_RECEIVED: {
        subject: `تم استلام الحساب — استرجاع ${amtPlain}`,
        title: 'استلمنا حسابك',
        body: [`سيتم تحويل مبلغ ${amt} الخاص بـ «${item}» خلال 3 إلى 5 أيام عمل. سنراسلك فور إرسال التحويل.`],
      },
      WALLET_CREDITED: {
        subject: `تمت إضافة ${amtPlain} إلى محفظتك`,
        title: 'وصل مبلغ الاسترجاع',
        body: [
          `تمت الموافقة على استرجاع «${item}»، وأُضيف ${amt} إلى محفظتك في Metwork.`,
          'يمكنك استخدام الرصيد في دفعة قادمة أو سحبه إلى حسابك البنكي أو CCP من محفظتك.',
        ],
        label: 'فتح محفظتي',
      },
      TRANSFER_SENT: {
        subject: `تم إرسال الاسترجاع — ${amtPlain}`,
        title: 'تم إرسال مبلغ الاسترجاع',
        body: [
          `حوّلنا ${amt} إلى الحساب الذي زودتنا به مقابل «${item}».`,
          ref ? `مرجع التحويل: <strong>${ref}</strong>.` : '',
          'يظهر المبلغ عادةً خلال 3 أيام عمل.',
        ],
      },
      DECLINED: {
        subject: `طلب الاسترجاع — ${item}`,
        title: 'لم تتم الموافقة على طلبك',
        body: [
          `تعذّرت الموافقة على طلب الاسترجاع الخاص بـ «${item}».`,
          reason ? `السبب: ${reason}` : '',
          'لأي استفسار، رد على هذا البريد أو تواصل مع فريق الدعم.',
        ],
      },
    },
  }[lang];

  const k = T[input.kind] as { subject: string; title: string; body: string[]; label?: string; note?: string };
  const href = input.kind === 'ACCOUNT_REQUEST' ? input.accountUrl : input.kind === 'WALLET_CREDITED' ? input.walletUrl : undefined;
  return {
    subject: k.subject,
    title: k.title,
    body: [T.hi, ...k.body.filter(Boolean)],
    cta: href && k.label ? { href, label: k.label } : undefined,
    note: k.note,
  };
}

export function refundEmailHtml(input: RefundEmailInput): string {
  const lang = normalizeEmailLang(input.lang);
  const c = copyFor(input, lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return layout(
    `<div dir="${dir}">
      ${h1(c.title)}
      ${c.body.map((line) => p(line)).join('')}
      ${c.cta ? button(c.cta.href, esc(c.cta.label)) : ''}
      ${c.note ? p(`<span style="color:#71717a;font-size:13px;">${c.note}</span>`) : ''}
    </div>`,
    { lang: lang === 'en' ? 'en' : 'fr' },
  );
}

/** Send one refund email. Never throws. */
export async function sendRefundEmail(input: RefundEmailInput): Promise<boolean> {
  const lang = normalizeEmailLang(input.lang);
  recordE2eEmail(`refund-${input.kind.toLowerCase()}`, { to: input.to, amount: input.amount, lang });
  try {
    const sent = await sendResendEmail({
      to: input.to,
      subject: copyFor(input, lang).subject,
      html: refundEmailHtml(input),
    });
    if (!sent) {
      // eslint-disable-next-line no-console
      console.log(`[notify] EMAIL (refund/${input.kind}) → ${input.to} :: ${input.amount} DZD`);
    }
    return sent;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[refund] email failed (refund unaffected):', err instanceof Error ? err.message : err);
    return false;
  }
}
