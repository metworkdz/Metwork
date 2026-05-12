'use client';

/**
 * User-facing component — enter a partner membership promo code.
 *
 * Validates the code against the server in real-time (debounced).
 * On success, calls `onApplied` with the discount percentage and tier.
 * On "Apply" button press, calls the `/api/partner-promo/apply` endpoint.
 *
 * Usage:
 *   <PromoCodeInput
 *     onApplied={(pct, tier) => {
 *       // update UI to show discounted price / redirect to dashboard
 *     }}
 *   />
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type MembershipTier = 'BUILDER' | 'FOUNDER';

interface ValidateResponse {
  valid: boolean;
  discountPercentage?: number;
  membershipTier?: MembershipTier;
  error?: string;
}

interface ApplyResponse {
  success: boolean;
  membership?: { id: string; plan: string; expiresAt: string | null };
  discountPercentage?: number;
  error?: { message: string };
}

interface Props {
  /** Called when the code is successfully applied to the user's account. */
  onApplied?: (discountPercentage: number, tier: MembershipTier) => void;
  /** Optional: disable input (e.g. after a code is applied). */
  disabled?: boolean;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'valid'; pct: number; tier: MembershipTier }
  | { kind: 'invalid'; error: string }
  | { kind: 'applying' }
  | { kind: 'applied'; pct: number; tier: MembershipTier };

const DEBOUNCE_MS = 600;

export function PromoCodeInput({ onApplied, disabled = false }: Props) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validate = useCallback(async (value: string) => {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed || trimmed.length < 5) {
      setStatus({ kind: 'idle' });
      return;
    }

    setStatus({ kind: 'validating' });

    try {
      const res = await fetch('/api/partner-promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const json: ValidateResponse = await res.json();

      if (json.valid && json.discountPercentage && json.membershipTier) {
        setStatus({ kind: 'valid', pct: json.discountPercentage, tier: json.membershipTier });
      } else {
        setStatus({ kind: 'invalid', error: json.error ?? 'Invalid code' });
      }
    } catch {
      setStatus({ kind: 'invalid', error: 'Could not validate — check your connection' });
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!code.trim()) {
      setStatus({ kind: 'idle' });
      return;
    }
    debounceRef.current = setTimeout(() => void validate(code), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [code, validate]);

  const apply = useCallback(async () => {
    if (status.kind !== 'valid') return;
    const { pct, tier } = status;
    setStatus({ kind: 'applying' });

    try {
      const res = await fetch('/api/partner-promo/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      const json: ApplyResponse = await res.json();

      if (json.success) {
        setStatus({ kind: 'applied', pct, tier });
        onApplied?.(pct, tier);
      } else {
        setStatus({
          kind: 'invalid',
          error: json.error?.message ?? 'Could not apply code',
        });
      }
    } catch {
      setStatus({ kind: 'invalid', error: 'Network error — please retry' });
    }
  }, [status, code, onApplied]);

  const isApplied = status.kind === 'applied';

  return (
    <div className="space-y-3">
      <Label htmlFor="promo-code-input">Partner promo code</Label>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id="promo-code-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="PPT-ORAN-2026-XXXXXX"
            autoCapitalize="characters"
            autoComplete="off"
            className="font-mono pr-8 uppercase"
            disabled={disabled || isApplied || status.kind === 'applying'}
          />
          {/* Inline status icon */}
          {status.kind === 'validating' && (
            <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />
          )}
          {status.kind === 'valid' && (
            <CheckCircle2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-green-600" />
          )}
          {status.kind === 'invalid' && (
            <AlertCircle className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-red-500" />
          )}
          {isApplied && (
            <CheckCircle2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-green-600" />
          )}
        </div>

        <Button
          onClick={apply}
          disabled={disabled || status.kind !== 'valid' || isApplied}
          variant={isApplied ? 'outline' : 'default'}
          className={isApplied ? 'pointer-events-none' : ''}
        >
          {status.kind === 'applying' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isApplied ? (
            'Applied ✓'
          ) : (
            'Apply'
          )}
        </Button>
      </div>

      {/* Feedback messages */}
      {status.kind === 'valid' && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
          <span>
            <strong>{status.pct}% off</strong> — {status.tier === 'FOUNDER' ? 'Founder' : 'Builder'} membership
          </span>
        </div>
      )}
      {status.kind === 'invalid' && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {status.error}
        </div>
      )}
      {isApplied && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
          <span>
            Your <strong>{status.tier === 'FOUNDER' ? 'Founder' : 'Builder'}</strong> membership is now active at a <strong>{status.pct}% discount</strong>!
          </span>
        </div>
      )}
    </div>
  );
}
