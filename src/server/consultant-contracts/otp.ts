/**
 * Contract-signing OTP policy.
 *
 * There is exactly ONE OTP implementation on this platform — `@/server/auth/otp`
 * — and this module does not fork it. Generation, HMAC hashing, expiry and the
 * per-code attempt counter all stay there; contract codes simply live under
 * their own key namespace, the same way consultant sign-in (`mentor:`) and
 * phone verification (`mentor-phone:`) already do. A contract code therefore
 * can never invalidate, or be satisfied by, a login code.
 *
 * What the shared module has no concept of — and what this module adds — is
 * the *send-side* policy: a rolling resend cap, an escalating minimum interval
 * between sends, and a cooldown after the attempt counter is exhausted. That
 * state lives on the contract record (`ConsultantContractOtpState`).
 *
 * Everything below the wrapper pair is PURE: no DB, no clock of its own (`now`
 * is always passed in). That is what makes the lockout and throttle rules
 * unit-testable without fabricating database state, and it is why the record
 * mutations live in `service.ts` rather than here — `service.ts` owns the
 * single `updateContract()` write gateway, so an import in that direction
 * would be circular.
 */
import { issueOtp, verifyOtp, type OtpVerifyResult } from '@/server/auth/otp';
import type { ConsultantContractOtpState } from '@/server/db/store';

/* ─────────────────── Policy constants ─────────────────── */

/**
 * Code lifetime. Deliberately half the 10-minute account default: the
 * consultant is signing in one sitting with the page already open, so a
 * shorter window costs them nothing and narrows the interception surface on a
 * document that carries their bank details.
 */
export const CONTRACT_OTP_TTL_MINUTES = 5;

/** Wrong codes accepted against a single issued code before lockout. */
export const CONTRACT_OTP_MAX_ATTEMPTS = 5;

/** How long a contract is frozen after the attempt counter is exhausted. */
export const CONTRACT_OTP_LOCKOUT_MS = 30 * 60_000;

/** Sends allowed inside one rolling window. */
export const CONTRACT_OTP_MAX_SENDS = 3;

/** Length of the rolling send window. */
export const CONTRACT_OTP_WINDOW_MS = 60 * 60_000;

/**
 * Minimum gap before the Nth send of a window, indexed by how many sends have
 * already happened in it. The escalation is the "backoff": a consultant who
 * genuinely missed the first SMS waits 30 s, someone hammering resend waits
 * progressively longer, and the rolling cap stops them at three either way.
 */
const SEND_BACKOFF_MS: readonly number[] = [0, 30_000, 120_000];

/** Required gap before the send that follows `sendCount` prior sends. */
function backoffFor(sendCount: number): number {
  const clamped = Math.min(Math.max(sendCount, 0), SEND_BACKOFF_MS.length - 1);
  return SEND_BACKOFF_MS[clamped] ?? 0;
}

/* ─────────────────── Key namespace ─────────────────── */

const OTP_KEY_PREFIX = 'contract-sign:';

/**
 * The shared-OTP-table key for one contract.
 *
 * Keyed by CONTRACT id, not consultant id: a consultant who is sent a
 * replacement contract while an old one is still pending must not have the two
 * signing codes collide, since `issueOtp` invalidates prior codes under the
 * same key.
 */
export function contractOtpKey(contractId: string): string {
  return OTP_KEY_PREFIX + contractId;
}

/* ─────────────────── Shared-module wrappers ─────────────────── */

/** Issue a 5-minute signing code. Returns the plaintext for delivery only. */
export async function issueContractOtp(contractId: string): Promise<{ code: string; expiresAt: string }> {
  return issueOtp(contractOtpKey(contractId), { ttlMinutes: CONTRACT_OTP_TTL_MINUTES });
}

/** Verify a signing code. Consumes it on success; increments attempts either way. */
export async function verifyContractOtp(contractId: string, code: string): Promise<OtpVerifyResult> {
  return verifyOtp(contractOtpKey(contractId), code);
}

/* ─────────────────── Pure policy ─────────────────── */

/** Send-state for a contract that has never had a code sent. */
export function initialOtpState(): ConsultantContractOtpState {
  return {
    maxAttempts: CONTRACT_OTP_MAX_ATTEMPTS,
    lockedUntil: null,
    sendCount: 0,
    lastSentAt: null,
    windowStartedAt: null,
  };
}

export type OtpSendDecision =
  | { allowed: true }
  | { allowed: false; reason: 'LOCKED' | 'TOO_MANY_SENDS' | 'TOO_SOON'; retryAfterMs: number };

/** True while `lockedUntil` is in the future. */
export function isLockedOut(state: ConsultantContractOtpState | null, now: number): boolean {
  if (!state?.lockedUntil) return false;
  return new Date(state.lockedUntil).getTime() > now;
}

/**
 * Whether the rolling send window has elapsed and `sendCount` should restart.
 * A null `windowStartedAt` means no send has happened yet — also a fresh window.
 */
function windowHasExpired(state: ConsultantContractOtpState, now: number): boolean {
  if (!state.windowStartedAt) return true;
  return now - new Date(state.windowStartedAt).getTime() >= CONTRACT_OTP_WINDOW_MS;
}

/**
 * May a code be sent right now?
 *
 * Three gates, checked in order of severity: an active lockout, the rolling
 * per-window cap, then the escalating minimum interval. Each refusal carries
 * `retryAfterMs` so the caller can tell the consultant when to try again rather
 * than leaving them guessing.
 */
export function evaluateSendPolicy(
  state: ConsultantContractOtpState | null,
  now: number,
): OtpSendDecision {
  if (!state) return { allowed: true };

  if (isLockedOut(state, now)) {
    return {
      allowed: false,
      reason: 'LOCKED',
      retryAfterMs: new Date(state.lockedUntil!).getTime() - now,
    };
  }

  // A lapsed window resets the counter, so both gates below see a clean slate.
  if (windowHasExpired(state, now)) return { allowed: true };

  if (state.sendCount >= CONTRACT_OTP_MAX_SENDS) {
    const windowEnds = new Date(state.windowStartedAt!).getTime() + CONTRACT_OTP_WINDOW_MS;
    return { allowed: false, reason: 'TOO_MANY_SENDS', retryAfterMs: Math.max(0, windowEnds - now) };
  }

  const requiredGap = backoffFor(state.sendCount);
  if (state.lastSentAt && requiredGap > 0) {
    const elapsed = now - new Date(state.lastSentAt).getTime();
    if (elapsed < requiredGap) {
      return { allowed: false, reason: 'TOO_SOON', retryAfterMs: requiredGap - elapsed };
    }
  }

  return { allowed: true };
}

/**
 * The state to persist after a successful send. Starts a new window when the
 * previous one lapsed, otherwise increments within it. Any prior lockout is
 * cleared — `evaluateSendPolicy` has already refused if one were still active,
 * so reaching here means it has expired.
 */
export function nextStateAfterSend(
  state: ConsultantContractOtpState | null,
  now: number,
): ConsultantContractOtpState {
  const nowIso = new Date(now).toISOString();
  const base = state ?? initialOtpState();
  const freshWindow = windowHasExpired(base, now);
  return {
    ...base,
    maxAttempts: CONTRACT_OTP_MAX_ATTEMPTS,
    lockedUntil: null,
    sendCount: freshWindow ? 1 : base.sendCount + 1,
    windowStartedAt: freshWindow ? nowIso : base.windowStartedAt,
    lastSentAt: nowIso,
  };
}

/**
 * The state to persist when the shared module reports the attempt counter
 * exhausted. The contract is frozen for `CONTRACT_OTP_LOCKOUT_MS`; the window
 * counters are left untouched so a lockout cannot be used to reset the
 * resend cap.
 */
export function nextStateAfterLockout(
  state: ConsultantContractOtpState | null,
  now: number,
): ConsultantContractOtpState {
  return {
    ...(state ?? initialOtpState()),
    lockedUntil: new Date(now + CONTRACT_OTP_LOCKOUT_MS).toISOString(),
  };
}
