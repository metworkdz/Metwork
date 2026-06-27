'use client';

/**
 * Admin Payments dashboard — segmented tabs (Users / Withdrawal requests) plus
 * the shared Add-bank-account and New-transfer modals. Owns the modal state so
 * both tabs can trigger a transfer. Segmented control is a Tailwind control (no
 * Tabs primitive needed); responsive via breakpoint classes only.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Users, ArrowDownToLine, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PayableUsersTable } from './payable-users-table';
import { WithdrawalRequestsTab } from './withdrawal-requests-tab';
import { BankAccountModal } from './bank-account-modal';
import { NewTransferModal, type TransferTarget } from './new-transfer-modal';
import type { BankAccountMasked, PayableTarget, PayoutTargetType, RequestRow } from './types';

type Tab = 'users' | 'requests';

interface BankTarget { type: PayoutTargetType; id: string; name: string; bankAccount: BankAccountMasked | null }

export function PaymentsDashboard() {
  const t = useTranslations('admin.payments');
  const [tab, setTab] = useState<Tab>('users');
  const [refreshKey, setRefreshKey] = useState(0);

  const [bankTarget, setBankTarget] = useState<BankTarget | null>(null);
  const [transfer, setTransfer] = useState<{ target: TransferTarget; prefillAmount?: number; withdrawalRequestId?: string | null } | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  function openTransferForTarget(p: PayableTarget) {
    setTransfer({
      target: { type: p.type, id: p.id, name: p.name, balance: p.balance, bankAccount: p.bankAccount },
      prefillAmount: p.balance >= 500 ? p.balance : undefined,
    });
  }

  function openTransferForRequest(r: RequestRow) {
    setTransfer({
      target: { type: r.targetType, id: r.targetId, name: r.name, balance: r.balance, bankAccount: r.bankAccount },
      prefillAmount: r.amount,
      withdrawalRequestId: r.id,
    });
  }

  function editBank(p: PayableTarget) {
    setBankTarget({ type: p.type, id: p.id, name: p.name, bankAccount: p.bankAccount });
  }

  return (
    <div className="space-y-5">
      {/* Segmented control + New transfer */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-full rounded-lg border bg-muted/40 p-1 sm:w-auto">
          <SegButton active={tab === 'users'} onClick={() => setTab('users')} icon={<Users className="size-4" />}>{t('tabs.users')}</SegButton>
          <SegButton active={tab === 'requests'} onClick={() => setTab('requests')} icon={<ArrowDownToLine className="size-4" />}>{t('tabs.requests')}</SegButton>
        </div>
        <Button variant="default" className="w-full sm:w-auto" onClick={() => setTab('users')}>
          <Plus className="size-4" /> {t('newTransfer')}
        </Button>
      </div>

      {tab === 'users' ? (
        <PayableUsersTable refreshKey={refreshKey} onEditBank={editBank} onSendTransfer={openTransferForTarget} />
      ) : (
        <WithdrawalRequestsTab refreshKey={refreshKey} onProcess={openTransferForRequest} />
      )}

      <BankAccountModal
        open={bankTarget !== null}
        onOpenChange={(o) => { if (!o) setBankTarget(null); }}
        target={bankTarget}
        onSaved={refresh}
      />

      <NewTransferModal
        open={transfer !== null}
        onOpenChange={(o) => { if (!o) setTransfer(null); }}
        target={transfer?.target ?? null}
        prefillAmount={transfer?.prefillAmount}
        withdrawalRequestId={transfer?.withdrawalRequestId ?? null}
        onSent={refresh}
        onNeedBankAccount={(tt) => {
          setTransfer(null);
          setBankTarget({ type: tt.type, id: tt.id, name: tt.name, bankAccount: tt.bankAccount });
        }}
      />
    </div>
  );
}

function SegButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition sm:flex-none',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}{children}
    </button>
  );
}
