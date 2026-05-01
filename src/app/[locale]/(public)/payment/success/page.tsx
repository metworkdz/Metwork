'use client';

/**
 * /payment/success?topUpId={id}
 *
 * Landing page after a SlickPay hosted-checkout redirect.
 * Calls /api/payments/status to verify and credit the wallet —
 * the status route is idempotent so refreshing is safe.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2, Wallet } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Phase = 'verifying' | 'success' | 'pending' | 'error';

interface StatusResponse {
  completed: 0 | 1;
  status: string;
  topUpId: string;
  balance?: number | null;
}

function formatDZD(amount: number) {
  return new Intl.NumberFormat('fr-DZ', {
    style: 'currency',
    currency: 'DZD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function PaymentSuccessPage() {
  const searchParams = useSearchParams();
  const topUpId = searchParams.get('topUpId');

  const [phase, setPhase] = useState<Phase>('verifying');
  const [balance, setBalance] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!topUpId) {
      setPhase('error');
      return;
    }

    let cancelled = false;

    async function verify() {
      try {
        const res = await fetch(`/api/payments/status?id=${encodeURIComponent(topUpId!)}`, {
          credentials: 'include',
        });

        if (cancelled) return;

        if (res.status === 401) {
          setPhase('error');
          return;
        }

        if (!res.ok) {
          setPhase('error');
          return;
        }

        const data = (await res.json()) as StatusResponse;

        if (data.completed === 1) {
          setBalance(data.balance ?? null);
          setPhase('success');
        } else {
          setPhase('pending');
        }
      } catch {
        if (!cancelled) setPhase('error');
      }
    }

    void verify();
    return () => { cancelled = true; };
  // Re-run when user hits "Check again"
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topUpId, retryCount]);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardContent className="p-8 text-center">
          {phase === 'verifying' && <VerifyingState />}
          {phase === 'success' && <SuccessState balance={balance} />}
          {phase === 'pending' && (
            <PendingState onRetry={() => {
              setPhase('verifying');
              setRetryCount((c) => c + 1);
            }} />
          )}
          {phase === 'error' && <ErrorState />}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────── States ─────────────────────────── */

function VerifyingState() {
  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary-50">
          <Loader2 className="size-7 animate-spin text-primary-600" />
        </div>
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Verifying payment…</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Confirming your transaction with SlickPay. This takes just a moment.
        </p>
      </div>
    </div>
  );
}

function SuccessState({ balance }: { balance: number | null }) {
  return (
    <div className="space-y-5">
      <div className="flex justify-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-50">
          <CheckCircle2 className="size-8 text-emerald-600" />
        </div>
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Payment confirmed!
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your wallet has been credited successfully.
        </p>
        {balance !== null && (
          <div className={cn(
            'mt-4 rounded-lg border border-emerald-200 bg-emerald-50 py-3 px-4',
          )}>
            <p className="text-xs font-medium text-emerald-700">New balance</p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums text-emerald-800">
              {formatDZD(balance)}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 pt-1">
        <Button asChild className="w-full">
          <Link href="/dashboard/entrepreneur/wallet">
            <Wallet className="size-4" />
            Go to wallet
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="w-full text-muted-foreground">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}

function PendingState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex justify-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-amber-50">
          <Loader2 className="size-7 text-amber-500" />
        </div>
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Payment pending</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your payment hasn&apos;t been confirmed yet. This can take up to a minute.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button onClick={onRetry} className="w-full">
          Check again
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/dashboard/entrepreneur/wallet">Go to wallet</Link>
        </Button>
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="space-y-5">
      <div className="flex justify-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
          <XCircle className="size-7 text-destructive" />
        </div>
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Verification failed</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We couldn&apos;t verify your payment. If your card was charged, contact support.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button asChild className="w-full">
          <Link href="/dashboard/entrepreneur/wallet">Go to wallet</Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="w-full text-muted-foreground">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
