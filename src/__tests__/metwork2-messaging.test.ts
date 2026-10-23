/**
 * Metwork 2.0 phase 6 — messaging: who may write to whom, blocks, the Free
 * weekly new-contact limit, cards, unread state, alert throttling, reports.
 * Runs on the in-memory messaging backend (the Postgres one is the same
 * interface).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db/store';
import { createMemoryRepo, setMessagingRepoForTests } from '@/server/messaging/repo';

const alerts = vi.hoisted(() => ({ send: vi.fn(async (_alert: Record<string, unknown>) => undefined) }));
vi.mock('@/server/notifications/mock', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/server/notifications/mock')),
  sendNewMessageAlert: alerts.send,
}));

const { inbox, reportConversation, sendMessage, setBlocked, setMuted, sharedInvoice, startConversation, thread, unreadThreads } =
  await import('@/server/messaging/service');

const T0 = '2026-10-01T10:00:00.000Z';
const FUTURE = '2030-01-01T00:00:00.000Z';
const repo = createMemoryRepo();

function user(id: string, role: string, extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: `User ${id}`, phone: '+213550000001', city: 'alger', role, status: 'ACTIVE',
    passwordHash: 'x', phoneVerified: true, emailVerified: true, membershipCode: null, membershipTier: 'EXPLORER',
    avatarUrl: null, locale: 'fr', createdAt: T0, updatedAt: T0, ...extra,
  } as never;
}

const FOUNDER = { membershipCode: 'STARTUP', membershipTier: 'FOUNDER', membershipExpiresAt: FUTURE };
const venture = (id: string, ownerId: string) => ({ id, ownerId, name: `Venture ${id}`, slug: id, isPublic: true, legal: { status: 'COMPANY' } }) as never;

beforeEach(async () => {
  repo.reset();
  setMessagingRepoForTests(repo);
  alerts.send.mockClear();
  await db.update((d) => {
    d.users = [
      user('fl-1', 'FREELANCER'),
      user('en-1', 'ENTREPRENEUR', FOUNDER),
      user('en-2', 'ENTREPRENEUR'),
      user('inv-1', 'INVESTOR'),
      user('admin-1', 'ADMIN'),
      ...Array.from({ length: 11 }, (_, i) => user(`f-${i}`, 'ENTREPRENEUR', FOUNDER)),
    ];
    d.ventures = [venture('v1', 'en-1'), ...Array.from({ length: 11 }, (_, i) => venture(`vf-${i}`, `f-${i}`)), venture('v-free', 'en-2')];
    d.invoices = [];
    d.paymentLinks = [];
    d.messageReports = [];
    d.notifications = [];
  });
});

const start = (fromId: string, toId = 'en-1', contextId = 'v1', body = 'Salam, votre projet m’intéresse') =>
  startConversation({ fromId, toId, contextType: 'VENTURE', contextId, body });

describe('opening a thread', () => {
  it('opens one thread per venture and reuses it', async () => {
    const a = await start('fl-1');
    const b = await start('fl-1', 'en-1', 'v1', 'Encore moi');
    expect(a.ok && b.ok && a.value.conversationId === b.value.conversationId).toBe(true);
    const list = await inbox('en-1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ other: { id: 'fl-1' }, context: { type: 'VENTURE', title: 'Venture v1' }, unread: true, preview: 'Encore moi' });
  });

  it('only about a public venture, written to its owner', async () => {
    expect(await start('fl-1', 'en-2', 'v1')).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    // en-2 is on Free: the venture page is not public.
    expect(await start('fl-1', 'en-2', 'v-free')).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    expect(await start('en-1', 'en-1', 'v1')).toMatchObject({ ok: false, reason: 'NOT_ALLOWED' });
  });

  it('is for freelancers and entrepreneurs only', async () => {
    expect(await start('inv-1')).toMatchObject({ ok: false, reason: 'NOT_ALLOWED' });
    await db.update((d) => { d.users.find((u) => u.id === 'fl-1')!.status = 'SUSPENDED'; });
    expect(await start('fl-1')).toMatchObject({ ok: false, reason: 'NOT_ALLOWED' });
  });

  it('caps new contacts per week on Free, not replies or known contacts', async () => {
    for (let i = 0; i < 10; i++) expect(await start('fl-1', `f-${i}`, `vf-${i}`)).toMatchObject({ ok: true });
    expect(await start('fl-1', 'f-10', 'vf-10')).toMatchObject({ ok: false, reason: 'CONTACT_LIMIT', limit: 10 });
    // Writing again to someone already in the inbox is fine.
    expect(await start('fl-1', 'f-0', 'vf-0', 'Relance')).toMatchObject({ ok: true });
    await db.update((d) => {
      Object.assign(d.users.find((u) => u.id === 'fl-1')!, { membershipCode: 'FREELANCER_PREMIUM', membershipTier: 'FOUNDER', membershipExpiresAt: FUTURE });
    });
    expect(await start('fl-1', 'f-10', 'vf-10')).toMatchObject({ ok: true });
  });
});

describe('a thread', () => {
  it('is private to its two participants and tracks unread', async () => {
    const r = await start('fl-1');
    const id = r.ok ? r.value.conversationId : '';
    expect(await unreadThreads('en-1')).toBe(1);
    expect(await thread('en-2', id)).toBeNull();
    expect(await sendMessage({ userId: 'en-2', conversationId: id, body: 'intrus', attachment: null })).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
    const t = await thread('en-1', id);
    expect(t!.messages.map((m) => [m.fromMe, m.body])).toEqual([[false, 'Salam, votre projet m’intéresse']]);
    expect(await unreadThreads('en-1')).toBe(0);
    await new Promise((r) => setTimeout(r, 5)); // a later reply, not the same millisecond
    await sendMessage({ userId: 'en-1', conversationId: id, body: 'Avec plaisir', attachment: null });
    expect(await unreadThreads('fl-1')).toBe(1);
    expect(await unreadThreads('en-1')).toBe(0);
  });

  it('stops both ways when either side blocks', async () => {
    const r = await start('fl-1');
    const id = r.ok ? r.value.conversationId : '';
    expect(await setBlocked('en-1', id, true)).toBe(true);
    expect(await sendMessage({ userId: 'fl-1', conversationId: id, body: 'allo ?', attachment: null })).toMatchObject({ ok: false, reason: 'BLOCKED' });
    expect(await start('fl-1')).toMatchObject({ ok: false, reason: 'BLOCKED' });
    expect((await inbox('en-1'))[0]!.blocked).toBe(true);
    await setBlocked('en-1', id, false);
    expect((await sendMessage({ userId: 'fl-1', conversationId: id, body: 'allo ?', attachment: null })).ok).toBe(true);
  });

  it('shares only the sender\'s own documents and live links', async () => {
    await db.update((d) => {
      d.invoices = [
        { id: 'inv-own', freelancerId: 'fl-1', kind: 'DEVIS', number: 'D-2026-001', status: 'ISSUED', totals: { ht: 100, tva: 0, ttc: 100, timbre: 0, net: 100 }, createdAt: T0, issuedAt: T0 } as never,
        { id: 'inv-other', freelancerId: 'fl-9', kind: 'FACTURE', number: 'F-1', status: 'ISSUED', totals: { ht: 1, tva: 0, ttc: 1, timbre: 0, net: 1 }, createdAt: T0, issuedAt: T0 } as never,
      ];
      d.paymentLinks = [{ id: 'pl-1', freelancerId: 'fl-1', serviceName: 'Logo', amount: 45_000, slug: 'abc', status: 'ACTIVE' } as never];
    });
    const r = await start('fl-1');
    const id = r.ok ? r.value.conversationId : '';
    expect(await sendMessage({ userId: 'fl-1', conversationId: id, body: '', attachment: { kind: 'INVOICE', invoiceId: 'inv-other' } })).toMatchObject({ ok: false, reason: 'INVALID_ATTACHMENT' });
    const sent = await sendMessage({ userId: 'fl-1', conversationId: id, body: '', attachment: { kind: 'INVOICE', invoiceId: 'inv-own' } });
    expect(sent.ok && sent.value.attachment).toMatchObject({ kind: 'INVOICE', number: 'D-2026-001', docKind: 'DEVIS' });
    const link = await sendMessage({ userId: 'fl-1', conversationId: id, body: '', attachment: { kind: 'PAYMENT_LINK', linkId: 'pl-1' } });
    expect(link.ok && link.value.attachment).toMatchObject({ kind: 'PAYMENT_LINK', amount: 45_000, payPath: '/pay/abc' });
    // The recipient may open the PDF of what was shared, nobody else.
    expect((await sharedInvoice('en-1', id, 'inv-own'))?.id).toBe('inv-own');
    expect(await sharedInvoice('en-2', id, 'inv-own')).toBeNull();
    expect(await sharedInvoice('en-1', id, 'inv-other')).toBeNull();
  });

  it('alerts once per window, never when muted', async () => {
    const r = await start('fl-1');
    const id = r.ok ? r.value.conversationId : '';
    expect(alerts.send).toHaveBeenCalledTimes(1);
    expect(alerts.send.mock.calls[0]![0]).toMatchObject({ senderName: 'User fl-1' });
    expect(JSON.stringify(alerts.send.mock.calls[0]![0])).not.toContain('projet');
    await sendMessage({ userId: 'fl-1', conversationId: id, body: 'deux', attachment: null });
    expect(alerts.send).toHaveBeenCalledTimes(1);
    await setMuted('fl-1', id, true);
    await sendMessage({ userId: 'en-1', conversationId: id, body: 'réponse', attachment: null });
    expect(alerts.send).toHaveBeenCalledTimes(1);
  });

  it('freezes the last messages in a report for the admins', async () => {
    const r = await start('fl-1');
    const id = r.ok ? r.value.conversationId : '';
    expect(await reportConversation({ userId: 'en-1', conversationId: id, reason: 'SPAM', note: null })).toBe(true);
    expect(await reportConversation({ userId: 'en-2', conversationId: id, reason: 'SPAM', note: null })).toBe(false);
    const d = await db.read();
    expect(d.messageReports![0]).toMatchObject({ reporterId: 'en-1', reportedId: 'fl-1', status: 'OPEN', snapshot: [{ senderId: 'fl-1', body: 'Salam, votre projet m’intéresse' }] });
    expect(d.notifications.some((n) => n.userId === 'admin-1')).toBe(true);
  });

  it('erases everything of a deleted account', async () => {
    await start('fl-1');
    await repo.deleteUser('fl-1');
    expect(await inbox('en-1')).toEqual([]);
  });
});
