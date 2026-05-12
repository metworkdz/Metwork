'use client';

/**
 * Network Pass check-in scanner for partner space reception desks.
 *
 * Workflow:
 *   1. Camera scans QR → component parses payload → POST validate
 *   2. If invalid, the error is shown in red and staff can try again
 *   3. If valid, the booking summary is shown with a green confirm button
 *   4. Staff confirms → POST record → visit is committed
 *
 * Fallback: a manual text input accepts the "MNP-YYYY-NNNNN" code when
 * the camera isn't available or the user's phone is dead.
 *
 * The component is purely a thin UI — all security checks live server-side
 * in src/server/network/checkin-service.ts. The component never trusts the
 * scanned payload; it always asks the server to validate.
 *
 * Expected backend routes (to be implemented separately):
 *   POST /api/network/checkin/validate  → { valid, error?, user?, bookingDetails?, visitId? }
 *   POST /api/network/checkin/record    → { success, visit?, error? }
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode, type Html5QrcodeCameraScanConfig } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Camera, CheckCircle2, AlertCircle, History, Keyboard } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// Types — mirrors the server response shape
// ─────────────────────────────────────────────────────────────────────────

interface ValidationResponse {
  valid: boolean;
  error?: string;
  visitId?: string;
  user?: { id: string; fullName: string; email: string };
  bookingDetails?: {
    bookingId: string;
    userEmail: string;
    userFullName: string;
    date: string;
    spaceId: string;
    spaceName: string;
  };
}

interface RecordResponse {
  success: boolean;
  visit?: {
    id: string;
    userId: string;
    checkedInAt: string;
    checkedInMethod: 'QR' | 'MANUAL';
  };
  error?: string;
}

interface RecentCheckIn {
  id: string;
  userFullName: string;
  checkedInAt: string;
  method: 'QR' | 'MANUAL';
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'invalid'; error: string }
  | { kind: 'valid'; data: ValidationResponse }
  | { kind: 'recording' }
  | { kind: 'recorded'; visitId: string };

interface Props {
  /** SpaceRecord.id of the partner space running the scanner. */
  spaceId: string;
  /** Staff member operating the scanner (audit trail). */
  staffUserId?: string;
  /** Optional: most recent check-ins to render below the scanner. */
  recentCheckIns?: RecentCheckIn[];
}

const QR_REGION_ID = 'network-pass-scanner-region';

// ─────────────────────────────────────────────────────────────────────────

export function SpaceCheckInScanner({ spaceId, staffUserId, recentCheckIns = [] }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [manualCode, setManualCode] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<string>(''); // debounce repeated frames

  // ─── Validation handlers ──────────────────────────────────────────────

  const validateQr = useCallback(async (qrData: string) => {
    // Debounce — scanner fires many frames per second
    if (lastScanRef.current === qrData) return;
    lastScanRef.current = qrData;

    setPhase({ kind: 'validating' });
    try {
      const res = await fetch('/api/network/checkin/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, qrData, method: 'QR' }),
      });
      const json: ValidationResponse = await res.json();
      if (json.valid) {
        setPhase({ kind: 'valid', data: json });
      } else {
        setPhase({ kind: 'invalid', error: json.error ?? 'Validation failed' });
      }
    } catch (err) {
      setPhase({ kind: 'invalid', error: 'Network error — please try again' });
    }
  }, [spaceId]);

  const validateManual = useCallback(async () => {
    const code = manualCode.trim().toUpperCase();
    if (!code) return;
    setPhase({ kind: 'validating' });
    try {
      const res = await fetch('/api/network/checkin/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, bookingNumber: code, method: 'MANUAL' }),
      });
      const json: ValidationResponse = await res.json();
      if (json.valid) {
        setPhase({ kind: 'valid', data: json });
      } else {
        setPhase({ kind: 'invalid', error: json.error ?? 'Validation failed' });
      }
    } catch {
      setPhase({ kind: 'invalid', error: 'Network error — please try again' });
    }
  }, [spaceId, manualCode]);

  const recordCheckIn = useCallback(async () => {
    if (phase.kind !== 'valid' || !phase.data.visitId || !phase.data.user) return;
    setPhase({ kind: 'recording' });
    try {
      const res = await fetch('/api/network/checkin/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: phase.data.visitId,
          spaceId,
          userId: phase.data.user.id,
          method: mode === 'camera' ? 'QR' : 'MANUAL',
          checkedInBy: staffUserId ?? null,
        }),
      });
      const json: RecordResponse = await res.json();
      if (json.success && json.visit) {
        setPhase({ kind: 'recorded', visitId: json.visit.id });
      } else {
        setPhase({ kind: 'invalid', error: json.error ?? 'Could not record check-in' });
      }
    } catch {
      setPhase({ kind: 'invalid', error: 'Network error — please retry' });
    }
  }, [phase, spaceId, mode, staffUserId]);

  const reset = useCallback(() => {
    setPhase({ kind: 'idle' });
    setManualCode('');
    lastScanRef.current = '';
  }, []);

  // ─── Camera lifecycle ─────────────────────────────────────────────────

  useEffect(() => {
    if (mode !== 'camera' || phase.kind !== 'idle') return;

    const scanner = new Html5Qrcode(QR_REGION_ID, /* verbose */ false);
    scannerRef.current = scanner;

    const config: Html5QrcodeCameraScanConfig = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
    };

    let cancelled = false;
    scanner
      .start(
        { facingMode: 'environment' },
        config,
        (decodedText) => {
          if (cancelled) return;
          void validateQr(decodedText);
        },
        // ignore per-frame decode errors (camera sees no QR → noisy)
        () => undefined,
      )
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[scanner] Camera start failed', err);
        setMode('manual');
      });

    return () => {
      cancelled = true;
      scanner.stop().catch(() => undefined);
      scanner.clear();
      scannerRef.current = null;
    };
  }, [mode, phase.kind, validateQr]);

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button
          variant={mode === 'camera' ? 'default' : 'outline'}
          size="sm"
          onClick={() => { reset(); setMode('camera'); }}
        >
          <Camera className="mr-2 h-4 w-4" />
          Scan QR
        </Button>
        <Button
          variant={mode === 'manual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => { reset(); setMode('manual'); }}
        >
          <Keyboard className="mr-2 h-4 w-4" />
          Enter code
        </Button>
      </div>

      {/* Scanner / manual input */}
      <Card className="p-6">
        {mode === 'camera' && phase.kind === 'idle' && (
          <div className="space-y-4">
            <Label>Point the camera at the user&apos;s QR code</Label>
            <div
              id={QR_REGION_ID}
              className="mx-auto h-[300px] w-[300px] overflow-hidden rounded-lg border bg-black"
            />
          </div>
        )}

        {mode === 'manual' && phase.kind === 'idle' && (
          <div className="space-y-4">
            <Label htmlFor="checkin-code">Check-in code</Label>
            <Input
              id="checkin-code"
              placeholder="MNP-2026-00145"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void validateManual(); }}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              className="text-lg font-mono"
            />
            <Button onClick={validateManual} disabled={!manualCode.trim()}>
              Validate
            </Button>
          </div>
        )}

        {phase.kind === 'validating' && (
          <div className="py-8 text-center text-sm text-zinc-500">
            Validating…
          </div>
        )}

        {phase.kind === 'invalid' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div>
                <div className="font-semibold text-red-900">Check-in rejected</div>
                <div className="text-sm text-red-700">{phase.error}</div>
              </div>
            </div>
            <Button variant="outline" onClick={reset}>Try again</Button>
          </div>
        )}

        {phase.kind === 'valid' && phase.data.bookingDetails && phase.data.user && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
              <div className="flex-1">
                <div className="font-semibold text-green-900">Valid check-in</div>
                <div className="mt-2 space-y-1 text-sm text-green-900">
                  <div><strong>Name:</strong> {phase.data.user.fullName}</div>
                  <div><strong>Email:</strong> {phase.data.user.email}</div>
                  <div><strong>Space:</strong> {phase.data.bookingDetails.spaceName}</div>
                  <div><strong>Date:</strong> {phase.data.bookingDetails.date}</div>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={recordCheckIn} className="flex-1">
                Confirm check-in
              </Button>
              <Button variant="outline" onClick={reset}>Cancel</Button>
            </div>
          </div>
        )}

        {phase.kind === 'recording' && (
          <div className="py-8 text-center text-sm text-zinc-500">
            Recording check-in…
          </div>
        )}

        {phase.kind === 'recorded' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
              <div>
                <div className="font-semibold text-green-900">Checked in!</div>
                <div className="text-sm text-green-700">Visit ID: {phase.visitId.slice(0, 8)}…</div>
              </div>
            </div>
            <Button onClick={reset} className="w-full">Scan next visitor</Button>
          </div>
        )}
      </Card>

      {/* Recent check-ins panel */}
      {recentCheckIns.length > 0 && (
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <History className="h-4 w-4 text-zinc-500" />
            <h3 className="text-sm font-semibold">Recent check-ins today</h3>
          </div>
          <ul className="space-y-2">
            {recentCheckIns.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between rounded-lg border border-zinc-100 px-3 py-2 text-sm"
              >
                <span>{v.userFullName}</span>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Badge variant="outline">{v.method}</Badge>
                  <span>{new Date(v.checkedInAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
