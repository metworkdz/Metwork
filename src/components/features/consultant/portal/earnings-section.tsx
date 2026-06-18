'use client';

/**
 * Earnings — mirrors the admin mentor-revenue page, scoped to this consultant:
 * consultations / gross / commission / net summary plus the ledger transaction
 * history. All values are display-only aggregations from the earnings endpoint.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { consultantService, type ConsultantEarnings } from '@/services/consultant.service';
import {
  CP_GREEN, EmptyBlock, ErrorBanner, SectionCard, SectionHeading, Spinner, StatTile, fmtDZD,
} from './shared';

const TYPE_KEY: Record<string, string> = {
  EARNING: 'typeEarning', COMMISSION: 'typeCommission', RELEASE: 'typeRelease',
  REVERSAL: 'typeReversal', PAYOUT: 'typePayout',
};

export function EarningsSection() {
  const t = useTranslations('consultantPortal.earnings');
  const [data, setData] = useState<ConsultantEarnings | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try { setFailed(false); setData(await consultantService.earnings()); }
    catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (failed) {
    return (
      <section>
        <SectionHeading title={t('heading')} />
        <SectionCard><ErrorBanner message={t('loadFailed')} /></SectionCard>
      </section>
    );
  }
  if (!data) {
    return (
      <section>
        <SectionHeading title={t('heading')} />
        <SectionCard><Spinner /></SectionCard>
      </section>
    );
  }

  const { summary, transactions } = data;

  return (
    <section className="space-y-4">
      <SectionHeading title={t('heading')} />

      {/* Summary mirror */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile label={t('consultations')} value={String(summary.consultations)} />
        <StatTile label={t('gross')} value={fmtDZD(summary.gross)} />
        <StatTile label={t('commission')} value={fmtDZD(summary.commission)} />
        <StatTile label={t('net')} value={fmtDZD(summary.net)} accent />
      </div>
      <p className="px-1 text-xs text-white/40">{t('summaryNote', { count: summary.consultations })}</p>

      {/* Transactions */}
      <div>
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-white/45">{t('transactionsHeading')}</p>
        <SectionCard className="p-2">
          {transactions.length === 0 ? (
            <div className="p-2"><EmptyBlock>{t('txnEmpty')}</EmptyBlock></div>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {transactions.map((tx) => (
                <li key={tx.id} className="flex items-center justify-between gap-3 px-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">{t(TYPE_KEY[tx.type] ?? 'typeEarning')}</p>
                    <p className="truncate text-[11px] text-white/40">{new Date(tx.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${tx.amount >= 0 ? '' : 'text-red-300'}`}
                    style={tx.amount >= 0 ? { color: CP_GREEN } : undefined}>
                    {tx.amount >= 0 ? '+' : '−'} {fmtDZD(Math.abs(tx.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </section>
  );
}

