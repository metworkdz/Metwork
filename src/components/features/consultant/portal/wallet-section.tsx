'use client';

/**
 * Wallet & withdrawals — shows pending/available balance, lets the consultant
 * request a payout (POST /api/consultant/withdrawals) and see request statuses,
 * and change their access PIN (PATCH /api/consultant/pin/change).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { KeyRound, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ApiClientError } from '@/lib/api-client';
import {
  consultantService, type ConsultantMe, type ConsultantWithdrawal,
} from '@/services/consultant.service';
import {
  BrandButton, CP_GREEN, EmptyBlock, ErrorBanner, Field, FlowSheet,
  SectionCard, SectionHeading, StatTile, cpInputClass, fmtDZD,
} from './shared';

export function WalletSection({ wallet, onChange }: { wallet: ConsultantMe['wallet']; onChange: () => Promise<void> }) {
  const t = useTranslations('consultantPortal.withdrawals');
  const tAccess = useTranslations('consultantPortal.access');
  const [items, setItems] = useState<ConsultantWithdrawal[] | null>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  const load = useCallback(async () => {
    try { setItems((await consultantService.withdrawals()).items); }
    catch { setItems([]); }
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
          onClose={() => setReqOpen(false)}
          onDone={async () => { await load(); await onChange(); }}
        />
      )}
      {pinOpen && <ChangePinSheet onClose={() => setPinOpen(false)} />}
    </section>
  );
}

function WithdrawSheet({ available, onClose, onDone }: { available: number; onClose: () => void; onDone: () => Promise<void> }) {
  const t = useTranslations('consultantPortal.withdrawals');
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await consultantService.requestWithdrawal({ amount: Number(amount), accountDetails: account.trim() });
      await onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiClientError ? (e.message || t('errorGeneric')) : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FlowSheet
      open onOpenChange={(o) => { if (!o) onClose(); }}
      title={t('requestHeading')}
      footer={
        <BrandButton onClick={submit} loading={busy} disabled={!amount || account.trim().length < 5} className="w-full">
          {t('request')}
        </BrandButton>
      }
    >
      <div className="space-y-4">
        <Field label={t('amountLabel')} htmlFor="cp-amt">
          <input id="cp-amt" type="number" inputMode="numeric" value={amount} dir="ltr"
            onChange={(e) => setAmount(e.target.value)} placeholder="5000" disabled={busy} className={cpInputClass} />
        </Field>
        <Field label={t('accountLabel')} htmlFor="cp-acct" hint={t('availableNote', { amount: fmtDZD(available) })}>
          <input id="cp-acct" value={account} onChange={(e) => setAccount(e.target.value)}
            placeholder={t('accountPlaceholder')} disabled={busy} className={cpInputClass} />
        </Field>
        {error && <ErrorBanner message={error} />}
      </div>
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
