'use client';

/**
 * Wallet & withdrawals — shows pending/available balance, lets the consultant
 * manage their payout account (bank RIB / CCP RIP), request a payout
 * (POST /api/consultant/withdrawals — account-gated, method-aware) and see
 * request statuses, and change their access PIN (PATCH /api/consultant/pin/change).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, KeyRound, Landmark, Mail, Pencil, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ApiClientError } from '@/lib/api-client';
import {
  consultantService, type ConsultantMe, type ConsultantPayoutAccount, type ConsultantWithdrawal,
} from '@/services/consultant.service';
import {
  isValidAccountNumber, methodForAccountType, accountTypeForMethod, type WithdrawalMethod,
} from '@/components/features/wallet/payout-account';
import {
  BrandButton, CP_GREEN, EmptyBlock, ErrorBanner, Field, FlowSheet,
  SectionCard, SectionHeading, StatTile, cpInputClass, fmtDZD,
} from './shared';

export function WalletSection({ wallet, onChange }: { wallet: ConsultantMe['wallet']; onChange: () => Promise<void> }) {
  const t = useTranslations('consultantPortal.withdrawals');
  const tAccess = useTranslations('consultantPortal.access');
  const [items, setItems] = useState<ConsultantWithdrawal[] | null>(null);
  const [account, setAccount] = useState<ConsultantPayoutAccount | null>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  const load = useCallback(async () => {
    try { setItems((await consultantService.withdrawals()).items); }
    catch { setItems([]); }
    try { setAccount((await consultantService.payoutAccount()).payoutAccount); }
    catch { /* summary row falls back to "add" */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-4">
      <SectionHeading
        title={t('walletHeading')}
        action={
          <button type="button" onClick={() => setPinOpen(true)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-white/15 px-3 text-xs text-white/80 hover:bg-white/[0.06]">
            <KeyRound className="size-3.5" /> {tAccess('changeHeading')}
          </button>
        }
      />

      {/* Balances */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile label={t('pendingLabel')} value={fmtDZD(wallet.pendingBalance)} />
        <StatTile label={t('availableLabel')} value={fmtDZD(wallet.availableBalance)} accent />
      </div>

      {/* Payout account on file */}
      <SectionCard className="flex items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-3">
          {account?.accountType === 'ccp'
            ? <Mail className="size-4 shrink-0 text-white/50" />
            : <Landmark className="size-4 shrink-0 text-white/50" />}
          {account ? (
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">
                {account.accountType === 'bank' ? t('accountBank') : t('accountCcp')}
              </p>
              <p className="truncate text-[11px] text-white/45">
                {account.holderName}
                {' · '}
                <span dir="ltr" className="tabular-nums">{account.accountNumber}</span>
              </p>
            </div>
          ) : (
            <p className="text-xs text-white/50">{t('accountNone')}</p>
          )}
        </div>
        <button type="button" onClick={() => setAccountOpen(true)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/15 px-3 text-xs text-white/80 hover:bg-white/[0.06]">
          <Pencil className="size-3.5" /> {account ? t('accountEdit') : t('accountAdd')}
        </button>
      </SectionCard>

      <BrandButton onClick={() => setReqOpen(true)} className="w-full">
        <Wallet className="size-4" /> {t('requestHeading')}
      </BrandButton>

      {/* History */}
      <div>
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-white/45">{t('historyHeading')}</p>
        <SectionCard className="p-2">
          {items === null ? null : items.length === 0 ? (
            <div className="p-2"><EmptyBlock>{t('empty')}</EmptyBlock></div>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {items.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 px-2 py-2.5">
                  <div>
                    <p className="text-sm font-medium tabular-nums text-white">{fmtDZD(w.amount)}</p>
                    <p className="text-[11px] text-white/40">{new Date(w.createdAt).toLocaleDateString()}</p>
                  </div>
                  <Badge variant={w.status === 'APPROVED' ? 'success' : w.status === 'REJECTED' ? 'danger' : 'warning'}>
                    {t(`status${w.status[0]}${w.status.slice(1).toLowerCase()}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {reqOpen && (
        <WithdrawSheet
          available={wallet.availableBalance}
          account={account}
          onAccountSaved={setAccount}
          onClose={() => setReqOpen(false)}
          onDone={async () => { await load(); await onChange(); }}
        />
      )}
      {accountOpen && (
        <PayoutAccountSheet
          initial={account}
          onSaved={(a) => { setAccount(a); setAccountOpen(false); }}
          onClose={() => setAccountOpen(false)}
        />
      )}
      {pinOpen && <ChangePinSheet onClose={() => setPinOpen(false)} />}
    </section>
  );
}

/* ─────────────────────────── Payout account form (shared body) ─────────────────────────── */

function PayoutAccountForm({
  initial, onSaved, renderSubmit,
}: {
  initial: ConsultantPayoutAccount | null;
  onSaved: (account: ConsultantPayoutAccount) => void;
  renderSubmit: (busy: boolean, submit: () => void, valid: boolean) => React.ReactNode;
}) {
  const t = useTranslations('consultantPortal.withdrawals');
  const [type, setType] = useState<ConsultantPayoutAccount['accountType']>(initial?.accountType ?? 'bank');
  const [holder, setHolder] = useState(initial?.holderName ?? '');
  const [number, setNumber] = useState(initial?.accountNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = isValidAccountNumber(number) && holder.trim().length >= 2;

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = await consultantService.savePayoutAccount({
        accountType: type,
        accountNumber: number.replace(/\s+/g, ''),
        holderName: holder.trim(),
      });
      onSaved(res.payoutAccount);
    } catch (e) {
      setError(e instanceof ApiClientError && e.code === 'INVALID_ACCOUNT_NUMBER'
        ? t('accountNumberInvalid')
        : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Account type — segmented control */}
      <div role="radiogroup" aria-label={t('accountTypeLabel')} className="grid grid-cols-2 gap-1 rounded-2xl border border-white/12 bg-white/[0.045] p-1">
        {(['bank', 'ccp'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={type === v}
            onClick={() => setType(v)}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
              type === v ? 'bg-white/[0.1] text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            {v === 'bank' ? <Landmark className="size-4" /> : <Mail className="size-4" />}
            {v === 'bank' ? t('accountBank') : t('accountCcp')}
          </button>
        ))}
      </div>

      <Field label={t('accountHolderLabel')} htmlFor="cp-pa-holder">
        <input id="cp-pa-holder" value={holder} disabled={busy}
          onChange={(e) => setHolder(e.target.value)} className={cpInputClass} />
      </Field>

      <Field
        label={type === 'bank' ? t('accountNumberLabelBank') : t('accountNumberLabelCcp')}
        hint={number.length > 0 && !isValidAccountNumber(number) ? t('accountNumberInvalid') : undefined}
        htmlFor="cp-pa-number"
      >
        <input id="cp-pa-number" dir="ltr" inputMode="numeric" value={number} disabled={busy}
          onChange={(e) => setNumber(e.target.value.replace(/[^\d\s]/g, ''))}
          placeholder="00799999000123456789" className={`${cpInputClass} tabular-nums`} />
      </Field>

      {error && <ErrorBanner message={error} />}
      {renderSubmit(busy, submit, valid)}
    </div>
  );
}

function PayoutAccountSheet({
  initial, onSaved, onClose,
}: {
  initial: ConsultantPayoutAccount | null;
  onSaved: (account: ConsultantPayoutAccount) => void;
  onClose: () => void;
}) {
  const t = useTranslations('consultantPortal.withdrawals');
  return (
    <FlowSheet open onOpenChange={(o) => { if (!o) onClose(); }} title={initial ? t('accountEditTitle') : t('accountAddTitle')}>
      <PayoutAccountForm
        initial={initial}
        onSaved={onSaved}
        renderSubmit={(busy, submit, valid) => (
          <BrandButton onClick={submit} loading={busy} disabled={!valid} className="w-full">
            {t('accountSave')}
          </BrandButton>
        )}
      />
    </FlowSheet>
  );
}

/* ─────────────────────────── Withdraw sheet (account-gated) ─────────────────────────── */

const CP_MIN_WITHDRAWAL = 500;

function WithdrawSheet({
  available, account, onAccountSaved, onClose, onDone,
}: {
  available: number;
  account: ConsultantPayoutAccount | null;
  onAccountSaved: (account: ConsultantPayoutAccount) => void;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('consultantPortal.withdrawals');
  // Account step comes FIRST when nothing is on file yet.
  const [step, setStep] = useState<'account' | 'withdraw' | 'done'>(account ? 'withdraw' : 'account');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<WithdrawalMethod>(account ? methodForAccountType(account.accountType) : 'cheque');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(amount);
  const amountOk =
    Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= CP_MIN_WITHDRAWAL && parsed <= available;

  async function submit() {
    setBusy(true); setError(null);
    try {
      await consultantService.requestWithdrawal({ amount: parsed, method });
      await onDone();
      setStep('done');
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(
          e.code === 'INSUFFICIENT_FUNDS' ? t('errorInsufficient')
          : e.code === 'NO_PAYOUT_ACCOUNT' ? t('errorNoAccount')
          : e.code === 'BELOW_MINIMUM' ? t('errorBelowMinimum')
          : (e.message || t('errorGeneric')),
        );
      } else setError(t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  const title =
    step === 'account' ? (account ? t('accountEditTitle') : t('accountAddTitle')) : t('requestHeading');

  return (
    <FlowSheet
      open onOpenChange={(o) => { if (!o) onClose(); }}
      title={title}
      footer={step === 'withdraw' ? (
        <BrandButton onClick={submit} loading={busy} disabled={!amountOk} className="w-full">
          {t('request')}
        </BrandButton>
      ) : undefined}
    >
      {step === 'account' && (
        <PayoutAccountForm
          initial={account}
          onSaved={(a) => {
            onAccountSaved(a);
            setMethod(methodForAccountType(a.accountType));
            setStep('withdraw');
          }}
          renderSubmit={(busy2, submit2, valid) => (
            <BrandButton onClick={submit2} loading={busy2} disabled={!valid} className="w-full">
              {t('accountSave')}
            </BrandButton>
          )}
        />
      )}

      {step === 'withdraw' && (
        <div className="space-y-4">
          <Field label={t('amountLabel')} hint={t('availableNote', { amount: fmtDZD(available) })} htmlFor="cp-amt">
            <input id="cp-amt" type="number" inputMode="numeric" value={amount} dir="ltr"
              min={CP_MIN_WITHDRAWAL} max={available} step={1}
              onChange={(e) => setAmount(e.target.value)} placeholder="5000" disabled={busy}
              className={`${cpInputClass} tabular-nums`} />
          </Field>
          {amount.length > 0 && Number.isFinite(parsed) && parsed > available && (
            <p className="text-xs text-red-400">{t('errorExceedsBalance')}</p>
          )}

          <div role="radiogroup" aria-label={t('methodLabel')} className="space-y-2">
            <p className="text-xs font-medium text-white/60">{t('methodLabel')}</p>
            {(['bank_transfer', 'ccp', 'cheque'] as const).map((m) => {
              const requiredType = accountTypeForMethod(m);
              const enabled = requiredType === null || account?.accountType === requiredType;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  disabled={!enabled}
                  onClick={() => setMethod(m)}
                  className={`flex w-full items-center justify-between gap-2 rounded-2xl border p-3 text-start text-sm transition ${
                    method === m && enabled
                      ? 'border-[#30a735]/60 bg-[#30a735]/10 font-medium text-white'
                      : 'border-white/12 text-white/70 hover:bg-white/[0.05]'
                  } ${!enabled ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <span>{t(`method.${m}`)}</span>
                  {!enabled && requiredType && (
                    <span className="text-[11px] text-white/40">
                      {requiredType === 'bank' ? t('methodNeedsBank') : t('methodNeedsCcp')}
                    </span>
                  )}
                  {enabled && method === m && <CheckCircle2 className="size-4 shrink-0" style={{ color: CP_GREEN }} />}
                </button>
              );
            })}
            <button type="button" onClick={() => setStep('account')}
              className="text-xs font-medium text-white/60 underline-offset-2 hover:text-white hover:underline">
              {account ? t('accountEdit') : t('accountAdd')}
            </button>
          </div>

          {error && <ErrorBanner message={error} />}
        </div>
      )}

      {step === 'done' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="size-10" style={{ color: CP_GREEN }} />
          <p className="text-base font-semibold text-white">{t('doneTitle')}</p>
          <p className="max-w-[36ch] text-sm text-white/60">{t('doneBody')}</p>
          <BrandButton onClick={onClose} className="mt-2 w-full">{t('doneClose')}</BrandButton>
        </div>
      )}
    </FlowSheet>
  );
}

function ChangePinSheet({ onClose }: { onClose: () => void }) {
  const t = useTranslations('consultantPortal.access');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await consultantService.changePin({ currentPin: currentPin.trim(), newPin: newPin.trim() });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.code === 'WRONG_PIN' ? t('wrongPin')
          : e.code === 'INVALID_PIN_FORMAT' ? t('invalidFormat')
          : e.code === 'RATE_LIMITED' ? t('rateLimited') : t('errorGeneric'));
      } else setError(t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FlowSheet
      open onOpenChange={(o) => { if (!o) onClose(); }}
      title={t('changeHeading')}
      footer={done ? undefined : (
        <BrandButton onClick={submit} loading={busy} disabled={currentPin.length < 4 || newPin.length < 4} className="w-full">
          {t('changeCta')}
        </BrandButton>
      )}
    >
      {done ? (
        <p className="py-6 text-center text-sm" style={{ color: CP_GREEN }}>{t('changed')}</p>
      ) : (
        <div className="space-y-4">
          <Field label={t('currentPinLabel')} htmlFor="cp-cur-pin">
            <input id="cp-cur-pin" inputMode="numeric" dir="ltr" value={currentPin} disabled={busy}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${cpInputClass} text-center tracking-[0.3em]`} />
          </Field>
          <Field label={t('newPinLabel')} hint={t('invalidFormat')} htmlFor="cp-new-pin">
            <input id="cp-new-pin" inputMode="numeric" dir="ltr" value={newPin} disabled={busy}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`${cpInputClass} text-center tracking-[0.3em]`} />
          </Field>
          {error && <ErrorBanner message={error} />}
        </div>
      )}
    </FlowSheet>
  );
}
