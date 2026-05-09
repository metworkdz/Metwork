'use client';

/**
 * Reusable promo code input field used across all booking/payment forms.
 *
 * Usage:
 *   <PromoCodeInput originalAmount={total} onApplied={setPromoResult} />
 *
 * The parent receives PromoResult on success and can use finalAmount
 * to decide whether to skip checkout (finalAmount === 0) or adjust the price.
 */
import { useState } from 'react';
import { Tag, CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PromoResult {
  code:           string;
  discountAmount: number;
  finalAmount:    number;
  discountType:   string;
  discountValue:  number;
}

interface PromoCodeInputProps {
  /** The amount before any discount, in integer DZD */
  originalAmount: number;
  /** Called when a valid code is applied */
  onApplied: (result: PromoResult | null) => void;
  disabled?: boolean;
}

export function PromoCodeInput({ originalAmount, onApplied, disabled }: PromoCodeInputProps) {
  const [code,     setCode]     = useState('');
  const [loading,  setLoading]  = useState(false);
  const [applied,  setApplied]  = useState<PromoResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function applyCode() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/promo-codes/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed, originalAmount }),
      });
      const data = await res.json() as {
        valid: boolean;
        error?: string;
        code?: string;
        discountAmount?: number;
        finalAmount?: number;
        discountType?: string;
        discountValue?: number;
      };

      if (!data.valid) {
        setErrorMsg(data.error ?? 'Invalid promo code');
        setApplied(null);
        onApplied(null);
        return;
      }

      const result: PromoResult = {
        code:           data.code!,
        discountAmount: data.discountAmount!,
        finalAmount:    data.finalAmount!,
        discountType:   data.discountType!,
        discountValue:  data.discountValue!,
      };
      setApplied(result);
      onApplied(result);
    } catch {
      setErrorMsg('Could not validate promo code');
    } finally {
      setLoading(false);
    }
  }

  function remove() {
    setApplied(null);
    setCode('');
    setErrorMsg(null);
    onApplied(null);
  }

  if (applied) {
    return (
      <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
        <span className="inline-flex items-center gap-1.5 text-emerald-800">
          <CheckCircle2 className="size-4 shrink-0" />
          <span className="font-medium">{applied.code}</span>
          <span className="text-emerald-700">
            {applied.discountType === 'PERCENTAGE'
              ? `(${applied.discountValue}% off)`
              : `(−${applied.discountAmount.toLocaleString()} DZD)`}
          </span>
        </span>
        <button
          type="button"
          onClick={remove}
          disabled={disabled}
          className="text-emerald-700 hover:text-emerald-900 disabled:opacity-40"
          aria-label="Remove promo code"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={code}
            onChange={(e) => { setCode(e.target.value); setErrorMsg(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyCode(); } }}
            placeholder="Promo code"
            className="ps-8 uppercase"
            disabled={disabled || loading}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('shrink-0 self-stretch')}
          onClick={applyCode}
          disabled={!code.trim() || disabled || loading}
          loading={loading}
        >
          Apply
        </Button>
      </div>
      {errorMsg && (
        <p className="text-xs text-destructive">{errorMsg}</p>
      )}
    </div>
  );
}
