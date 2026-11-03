'use client';

/**
 * Arriving through a referral link (`?ref=CODE` on any Academy page): hand the
 * code to the server, which keeps it in an HttpOnly cookie for the checkout.
 * Renders nothing.
 */
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export function ReferralCapture() {
  const params = useSearchParams();
  const code = params.get('ref');
  useEffect(() => {
    if (!code || !/^[A-Za-z2-9]{8}$/.test(code)) return;
    void fetch('/api/academy/referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.toUpperCase() }),
    }).catch(() => { /* a lost referral is not worth an error */ });
  }, [code]);
  return null;
}
