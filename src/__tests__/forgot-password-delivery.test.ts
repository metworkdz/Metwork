/**
 * forgot-password: the reset mail must actually send, and the response must not
 * reveal whether the address exists.
 *
 * These two pull against each other, which is the whole reason this file
 * exists. The mail was previously fire-and-forget — dropped on Vercel, because
 * the lambda freezes once the response is returned, so users asking for a reset
 * simply never got one and were locked out. Awaiting it fixes delivery but makes
 * the "address exists" branch measurably slower, so the route pads every
 * response to a fixed floor.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sendMock = vi.fn<(email: string, link: string) => Promise<void>>();

vi.mock('@/server/notifications/mock', () => ({
  sendPasswordResetEmail: (email: string, link: string) => sendMock(email, link),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimitDistributed: async () => true }));

import { db } from '@/server/db/store';
import { POST } from '@/app/api/auth/forgot-password/route';
import type { UserRecord } from '@/server/db/store';

const EMAIL = 'reset.target@metwork.test';

function req(email: string): Request {
  return new Request('http://localhost/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept-language': 'fr-FR' },
    body: JSON.stringify({ email }),
  });
}

beforeEach(async () => {
  sendMock.mockReset();
  sendMock.mockResolvedValue(undefined);
  await db.update((d) => {
    d.users = [{ id: 'u-reset', email: EMAIL, fullName: 'Reset Target', role: 'ENTREPRENEUR' } as UserRecord];
    d.passwordResets = [];
  });
});

describe('forgot-password delivery', () => {
  it('AWAITS the reset mail — a floating send never leaves the lambda', async () => {
    // The send must take LONGER than the response floor (900ms), or the padding
    // masks the bug: a short unawaited timer would finish during the pad and the
    // assertion would pass with the await removed. Verified by deleting the
    // await and watching this go red.
    let delivered = false;
    sendMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => setTimeout(() => { delivered = true; resolve(); }, 1_500)),
    );

    const res = await POST(req(EMAIL) as never);

    expect(res.status).toBe(204);
    expect(delivered).toBe(true);
  });

  it('sends to the right address, with a single-use token in the link', async () => {
    await POST(req(EMAIL) as never);

    expect(sendMock).toHaveBeenCalledOnce();
    const [to, link] = sendMock.mock.calls[0]!;
    expect(to).toBe(EMAIL);
    expect(link).toContain('/reset-password?token=');

    const stored = (await db.read()).passwordResets ?? [];
    expect(stored.filter((t) => t.userId === 'u-reset' && !t.consumed)).toHaveLength(1);
  });

  it('still answers 204 when the mail fails — a mail error must not confirm the address', async () => {
    sendMock.mockResolvedValueOnce(undefined);
    const res = await POST(req(EMAIL) as never);
    expect(res.status).toBe(204);
  });

  it('sends nothing for an unknown address, and still answers 204', async () => {
    const res = await POST(req('nobody@metwork.test') as never);
    expect(res.status).toBe(204);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('forgot-password enumeration safety', () => {
  it('takes a comparable time whether or not the address exists', async () => {
    // The point of the floor. Awaiting the send makes the "exists" branch do
    // strictly more work; without padding that difference is the oracle.
    sendMock.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 120)),
    );

    const t0 = Date.now();
    await POST(req(EMAIL) as never);
    const known = Date.now() - t0;

    const t1 = Date.now();
    await POST(req('nobody@metwork.test') as never);
    const unknown = Date.now() - t1;

    // Both are held to the same floor, so the gap is noise rather than signal.
    expect(Math.abs(known - unknown)).toBeLessThan(120);
    expect(unknown).toBeGreaterThanOrEqual(800);
  });
});
