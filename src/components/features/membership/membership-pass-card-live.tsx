'use client';

/**
 * MembershipPassCardLive
 *
 * Client wrapper for <MembershipPassCard /> that fetches the user's
 * current Network Pass check-in QR from /api/network/pass/qr on mount.
 *
 * Responsibilities:
 *   - Initial fetch + loading state
 *   - "Refresh QR" handler — re-issues a fresh code via POST
 *   - Graceful "no upcoming booking" empty state, so the card still
 *     shows tier badge, credits, and visits.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  MembershipPassCard,
  type PassRecentVisit,
} from './membership-pass-card';
import type { SessionUser } from '@/types/auth';

interface Props {
  user: SessionUser;
  creditsRemaining: number;
  creditsMax: number;
  expiresOn: string;
  recentVisits?: PassRecentVisit[];
}

interface QrOk {
  hasPass: true;
  qrCodeDataUrl: string;
  checkInCode: string;
  expiresAt: string;
  bookingId: string;
  bookingDate: string;
  spaceId: string;
  spaceName: string;
}
interface QrNone {
  hasPass: false;
  reason: string;
  message: string;
}
type QrResponse = QrOk | QrNone;

export function MembershipPassCardLive({
  user,
  creditsRemaining,
  creditsMax,
  expiresOn,
  recentVisits,
}: Props) {
  const [qr, setQr] = useState<QrOk | null>(null);
  const [noPassMessage, setNoPassMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (method: 'GET' | 'POST') => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/network/pass/qr', {
        method,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as QrResponse;
      if (data.hasPass) {
        setQr(data);
        setNoPassMessage(null);
      } else {
        setQr(null);
        setNoPassMessage(data.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load QR');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('GET');
  }, [load]);

  const handleRefresh = useCallback(async () => {
    await load('POST');
  }, [load]);

  return (
    <div className="space-y-3">
      <MembershipPassCard
        user={user}
        creditsRemaining={creditsRemaining}
        creditsMax={creditsMax}
        expiresOn={expiresOn}
        qrCodeDataUrl={qr?.qrCodeDataUrl ?? null}
        checkInCode={qr?.checkInCode ?? null}
        recentVisits={recentVisits}
        onRefreshQr={handleRefresh}
      />
      {loading && !qr && (
        <p className="text-center text-xs text-muted-foreground">Loading check-in QR…</p>
      )}
      {!loading && !qr && noPassMessage && (
        <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          {noPassMessage}
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-center text-xs text-destructive">
          {error}
        </p>
      )}
      {qr && (
        <p className="text-center text-[11px] text-muted-foreground">
          Booked at {qr.spaceName} · valid {new Date(qr.bookingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </p>
      )}
    </div>
  );
}
