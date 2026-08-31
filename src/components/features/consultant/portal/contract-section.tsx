'use client';

/**
 * Commission contract section.
 *
 * Three states, one component:
 *  • nothing to show      — an empty block,
 *  • awaiting signature   — read the contract, draw, confirm with a code,
 *  • signed               — the terms, plus a link to the stored PDF.
 *
 * The contract BODY is French and is never translated: it is the legal
 * instrument itself, rendered verbatim from the frozen snapshot. The chrome
 * around it — headings, buttons, errors — goes through next-intl like the rest
 * of the portal, so an Arabic-locale consultant is not dropped onto an
 * untranslated island.
 *
 * Every term shown here is DISPLAY ONLY. The commission rate, payout route and
 * phone are read server-side from the frozen record when the signature is
 * finalised, so editing them in devtools changes what this screen renders and
 * nothing about what gets signed.
 */
import { useCallback, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Download, FileText, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { ApiClientError } from '@/lib/api-client';
import { consultantService, type ConsultantContract } from '@/services/consultant.service';
import { SignaturePad, type SignaturePadHandle } from './signature-pad';
import { OtpCodeInput } from './otp-code-input';
import {
  BrandButton,
  CP_GREEN_TEXT,
  CP_GREEN_TINT,
  CP_LIGHT_BORDER,
  CP_LIGHT_MUTED,
  CP_LIGHT_SURFACE_MUTED,
  EmptyBlock,
  ErrorBanner,
  GhostButton,
  SectionCard,
  SectionHeading,
  Spinner,
} from './shared';
import { stripSignatureMarker } from '@/server/consultant-contracts/variables';

type Step = 'read' | 'sign' | 'code';

export function ContractSection({
  contracts,
  loading,
  onChanged,
}: {
  contracts: ConsultantContract[];
  loading: boolean;
  /** Re-fetch after a successful signature so the banner and tab agree. */
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations('consultantPortal.contract');

  const pending = contracts.find((c) => c.status === 'PENDING_SIGNATURE') ?? null;
  const signed = contracts.filter((c) => c.status === 'SIGNED');

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner tone="dark" />
      </div>
    );
  }

  if (!pending && signed.length === 0) {
    return (
      <>
        <SectionHeading title={t('title')} subtitle={t('subtitle')} />
        <EmptyBlock>{t('empty')}</EmptyBlock>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeading title={t('title')} subtitle={t('subtitle')} />
      {pending && <PendingContract contract={pending} onSigned={onChanged} />}
      {signed.map((contract) => (
        <SignedContract key={contract.id} contract={contract} />
      ))}
    </div>
  );
}

/* ─────────────────── Terms (shared by both states) ─────────────────── */

function pct(rate: number): string {
  return `${(Math.round(rate * 1000) / 10).toString()} %`;
}

/**
 * The frozen terms, shown with a padlock.
 *
 * The lock is not decoration: these values were captured when the contract was
 * issued and are deliberately not editable, so the UI says so rather than
 * letting the consultant wonder why their profile edits are not reflected.
 */
function LockedTerms({ contract }: { contract: ConsultantContract }) {
  const t = useTranslations('consultantPortal.contract');

  const rows: Array<[string, string]> = [
    [t('terms.commission'), pct(contract.commissionRate)],
    [t('terms.yourShare'), pct(1 - contract.commissionRate)],
    [t('terms.payoutMethod'), t(`payoutMethod.${contract.payoutMethod}`)],
  ];
  if (contract.payoutDetails) rows.push([t('terms.payoutDetails'), contract.payoutDetails]);
  rows.push([t('terms.signerPhone'), contract.signerPhoneSnapshot]);

  return (
    <div className="rounded-2xl p-3" style={{ background: CP_LIGHT_SURFACE_MUTED }}>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium" style={{ color: CP_LIGHT_MUTED }}>
        <Lock className="size-3" />
        {t('terms.lockedNote')}
      </p>
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-xs" style={{ color: CP_LIGHT_MUTED }}>{label}</dt>
            <dd className="text-end text-[13px] font-semibold text-[#0D0D0D]">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The contract body, verbatim French, read-only. */
function ContractBody({ body }: { body: string }) {
  // The signature-block marker is a layout instruction for the PDF, not text —
  // the consultant must never read a raw {{signature_block}} in what is
  // presented to them as the final contract.
  const text = stripSignatureMarker(body);
  return (
    <div
      // Always LTR: the document is French even when the portal is Arabic.
      dir="ltr"
      lang="fr"
      className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-2xl border p-3.5 text-[13px] leading-relaxed text-[#26262b]"
      style={{ borderColor: CP_LIGHT_BORDER }}
    >
      {text}
    </div>
  );
}

/* ─────────────────── Awaiting signature ─────────────────── */

function PendingContract({
  contract,
  onSigned,
}: {
  contract: ConsultantContract;
  onSigned: () => void | Promise<void>;
}) {
  const t = useTranslations('consultantPortal.contract');
  const padRef = useRef<SignaturePadHandle | null>(null);

  const [step, setStep] = useState<Step>('read');
  const [hasSignature, setHasSignature] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Held across the OTP step — the canvas unmounts when the step changes. */
  const signatureRef = useRef<string | null>(null);

  const describeError = useCallback(
    (e: unknown): string => {
      if (!(e instanceof ApiClientError)) return t('errors.generic');
      switch (e.code) {
        case 'INVALID_OTP': return t('errors.invalidCode');
        case 'OTP_EXPIRED': return t('errors.expiredCode');
        case 'OTP_LOCKED': return t('errors.locked');
        case 'OTP_THROTTLED': {
          const seconds = Number((e.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 0);
          return seconds > 0 ? t('errors.waitSeconds', { seconds }) : t('errors.throttled');
        }
        case 'RATE_LIMITED': return t('errors.throttled');
        case 'DELIVERY_FAILED': return t('errors.deliveryFailed');
        case 'BAD_SIGNATURE': return t('errors.badSignature');
        case 'NOT_PENDING': return t('errors.notPending');
        case 'SIGN_FAILED': return t('errors.signFailed');
        case 'UNAVAILABLE': return t('errors.unavailable');
        // Deliberately NOT `e.message`: server messages are English-only and
        // written for logs, so falling back to one would drop an untranslated
        // string into a French or Arabic portal.
        default: return t('errors.generic');
      }
    },
    [t],
  );

  /** Capture the drawing, then ask for a code. */
  async function requestCode(channel?: 'whatsapp' | 'sms') {
    setError(null);
    setNotice(null);

    if (step !== 'code') {
      const drawn = padRef.current?.toDataUrl() ?? null;
      if (!drawn) { setError(t('errors.badSignature')); return; }
      signatureRef.current = drawn;
    }

    setBusy(true);
    try {
      const res = await consultantService.sendContractOtp(contract.id, channel);
      setStep('code');
      setCode('');
      setNotice(t(res.channel === 'sms' ? 'codeSentSms' : 'codeSentWhatsApp', { phone: contract.signerPhoneSnapshot }));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const signature = signatureRef.current;
    if (!signature) { setStep('sign'); setError(t('errors.badSignature')); return; }

    setBusy(true);
    setError(null);
    try {
      await consultantService.signContract(contract.id, { signatureImagePng: signature, code });
      // Clear the drawing from memory once it is safely on the server.
      signatureRef.current = null;
      await onSigned();
    } catch (e) {
      setError(describeError(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: CP_GREEN_TINT }}>
          <FileText className="size-[18px]" style={{ color: CP_GREEN_TEXT }} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[#0D0D0D]">{t('pendingTitle')}</h3>
          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: CP_LIGHT_MUTED }}>{t('pendingBody')}</p>
        </div>
      </div>

      {step === 'read' && (
        <>
          <ContractBody body={contract.contentSnapshot} />
          <LockedTerms contract={contract} />
          <BrandButton tone="light" className="w-full" onClick={() => { setStep('sign'); setError(null); }}>
            {t('startSigning')}
          </BrandButton>
        </>
      )}

      {step === 'sign' && (
        <>
          <LockedTerms contract={contract} />
          <SignaturePad ref={padRef} onChange={setHasSignature} disabled={busy} />
          {error && <ErrorBanner message={error} tone="light" />}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <BrandButton
              tone="light"
              className="w-full sm:flex-1"
              loading={busy}
              disabled={!hasSignature || contract.locked}
              onClick={() => void requestCode()}
            >
              {t('continueToCode')}
            </BrandButton>
            <GhostButton tone="light" className="w-full sm:flex-1" onClick={() => setStep('read')} disabled={busy}>
              {t('back')}
            </GhostButton>
          </div>
          {contract.locked && <p className="text-xs text-red-600">{t('errors.locked')}</p>}
        </>
      )}

      {step === 'code' && (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-2xl p-3" style={{ background: CP_LIGHT_SURFACE_MUTED }}>
            <ShieldCheck className="mt-0.5 size-4 shrink-0" style={{ color: CP_GREEN_TEXT }} />
            <p className="text-xs leading-relaxed" style={{ color: CP_LIGHT_MUTED }}>
              {notice ?? t('codeSentWhatsApp', { phone: contract.signerPhoneSnapshot })}
            </p>
          </div>

          <OtpCodeInput
            value={code}
            onChange={setCode}
            disabled={busy}
            tone="light"
            idPrefix="contract-otp"
            label={t('codeLabel')}
          />

          {error && <ErrorBanner message={error} tone="light" />}

          <BrandButton
            tone="light"
            className="w-full"
            loading={busy}
            disabled={code.length !== 6}
            onClick={() => void submit()}
          >
            {t('confirmSignature')}
          </BrandButton>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
            <button
              type="button"
              onClick={() => void requestCode('whatsapp')}
              disabled={busy}
              className="font-medium underline-offset-2 hover:underline disabled:opacity-50"
              style={{ color: CP_GREEN_TEXT }}
            >
              {t('resendWhatsApp')}
            </button>
            <button
              type="button"
              onClick={() => void requestCode('sms')}
              disabled={busy}
              className="font-medium underline-offset-2 hover:underline disabled:opacity-50"
              style={{ color: CP_LIGHT_MUTED }}
            >
              {t('resendSms')}
            </button>
            <button
              type="button"
              onClick={() => { setStep('sign'); setError(null); }}
              disabled={busy}
              className="font-medium underline-offset-2 hover:underline disabled:opacity-50"
              style={{ color: CP_LIGHT_MUTED }}
            >
              {t('redraw')}
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────────────── Signed ─────────────────── */

function SignedContract({ contract }: { contract: ConsultantContract }) {
  const t = useTranslations('consultantPortal.contract');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signedOn = contract.signedAt
    ? new Date(contract.signedAt).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-GB', {
        day: '2-digit', month: 'long', year: 'numeric',
      })
    : '';

  /**
   * Fetch a fresh link at click time rather than reusing the one from the list
   * response — signed Cloudinary links expire within minutes, so a page left
   * open would otherwise hand the consultant a dead link.
   */
  async function openPdf() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await consultantService.contractPdfUrl(contract.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(t('errors.pdfUnavailable'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: CP_GREEN_TINT }}>
          <CheckCircle2 className="size-[18px]" style={{ color: CP_GREEN_TEXT }} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[#0D0D0D]">{t('signedTitle')}</h3>
          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: CP_LIGHT_MUTED }}>
            {t('signedBody', { date: signedOn })}
          </p>
        </div>
      </div>

      <LockedTerms contract={contract} />

      {error && <ErrorBanner message={error} tone="light" />}

      <GhostButton tone="light" className="w-full" onClick={() => void openPdf()} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {t('downloadPdf')}
      </GhostButton>
    </SectionCard>
  );
}
