'use client';

/**
 * Admin Payments page — three tabs:
 *   Incoming     money collected through Metwork (cards + wallets), with what
 *                Metwork earned and what it owes partners.
 *   Refunds      the refund queue (accept, send the guest's transfer, reject).
 *   Withdrawals  the manual withdrawal queue (unchanged).
 * `?tab=refunds` deep-links from the notification an admin receives.
 */
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { WithdrawalRequestsTab } from './withdrawal-requests-tab';
import { IncomingPaymentsTab } from './incoming-payments-tab';
import { RefundsTab } from './refunds-tab';

type Tab = 'incoming' | 'refunds' | 'withdrawals';

export function PaymentsDashboard() {
  const t = useTranslations('refunds.admin');
  const initial = useSearchParams().get('tab');
  const [tab, setTab] = useState<Tab>(initial === 'refunds' || initial === 'withdrawals' ? initial : 'incoming');

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'incoming', label: t('tabIncoming') },
    { id: 'refunds', label: t('tabRefunds') },
    { id: 'withdrawals', label: t('tabWithdrawals') },
  ];

  return (
    <div className="space-y-5">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={cn(
              'whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors',
              tab === x.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {x.label}
          </button>
        ))}
      </div>
      {tab === 'incoming' && <IncomingPaymentsTab onOpenRefunds={() => setTab('refunds')} />}
      {tab === 'refunds' && <RefundsTab />}
      {tab === 'withdrawals' && <WithdrawalRequestsTab />}
    </div>
  );
}
