/**
 * Messaging — THE service behind /api/messages and the inbox (Metwork 2.0
 * phase 6). Threads are attached to the work they are about: a venture, a
 * gig, a quote request; cofounder matches plug in through `validateContext`
 * in phase 8.
 *
 * Rules, all enforced here:
 *   - only active freelancers and entrepreneurs message each other;
 *   - a block, either way, stops new threads and new messages;
 *   - Free plans open threads with at most N new people a week
 *     (`entitlements.newContactsPerWeek`), replies are never limited;
 *   - a card (invoice, payment link) can only be one the sender owns, and is
 *     rendered from the live record;
 *   - the other person is alerted by WhatsApp + email at most once per
 *     thread every ALERT_EVERY_MIN while they have not read it.
 */
import { randomUUID } from 'node:crypto';
import { db, type MessageReportReason, type UserRecord } from '@/server/db/store';
import { entitlementsForUser } from '@/lib/entitlements';
import { memberBadgeFor, type MemberBadge } from '@/lib/member-badge';
import { publicVenture } from '@/server/ventures/service';
import { ownsInvoice } from '@/server/invoices/owner';
import { createNotification } from '@/server/notifications/create-notification';
import { sendNewMessageAlert } from '@/server/notifications/mock';
import {
  messagingRepo,
  type ContextType,
  type ConversationWithParticipants,
  type Message,
  type MessageAttachment,
} from '@/server/messaging/repo';

type Store = Awaited<ReturnType<typeof db.read>>;

export const MAX_BODY = 4000;
const PREVIEW_CHARS = 140;
const ALERT_EVERY_MIN = 30;
/** Read the thread this recently = in the app: no alert. */
const ACTIVE_MIN = 2;
const WEEK_MS = 7 * 86_400_000;
const MESSAGING_ROLES = new Set(['FREELANCER', 'ENTREPRENEUR']);

export function canMessage(user: Pick<UserRecord, 'role' | 'status'> | null | undefined): boolean {
  return Boolean(user && user.status === 'ACTIVE' && MESSAGING_ROLES.has(user.role));
}

/* ─────────────────────────── Views ─────────────────────────── */

export interface PersonView {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  badge: MemberBadge | null;
}

export interface ContextView {
  type: ContextType;
  id: string | null;
  /** What the thread is about, e.g. the venture name. */
  title: string | null;
}

export interface ThreadSummary {
  id: string;
  other: PersonView;
  context: ContextView;
  preview: string | null;
  lastMessageAt: string | null;
  lastFromMe: boolean;
  unread: boolean;
  muted: boolean;
  blocked: boolean;
}

export type AttachmentView =
  | { kind: 'INVOICE'; invoiceId: string; docKind: 'FACTURE' | 'PROFORMA' | 'DEVIS'; number: string; total: number; status: string }
  | { kind: 'PAYMENT_LINK'; linkId: string; title: string; amount: number; status: string; payPath: string }
  | { kind: 'ORDER'; orderId: string; number: string; title: string; total: number; status: string }
  | { kind: 'UNAVAILABLE' };

export interface MessageView {
  id: string;
  fromMe: boolean;
  body: string;
  attachment: AttachmentView | null;
  createdAt: string;
}

function person(data: Store, id: string): PersonView {
  const u = data.users.find((x) => x.id === id);
  return {
    id,
    name: u?.fullName ?? '—',
    avatarUrl: u?.avatarUrl ?? null,
    role: u?.role ?? 'UNKNOWN',
    badge: memberBadgeFor(u),
  };
}

function contextView(data: Store, type: ContextType, id: string | null): ContextView {
  if (type === 'VENTURE' && id) {
    return { type, id, title: (data.ventures ?? []).find((v) => v.id === id)?.name ?? null };
  }
  if (type === 'QUOTE_REQUEST' && id) {
    return { type, id, title: (data.quoteRequests ?? []).find((q) => q.id === id)?.title ?? null };
  }
  if (type === 'GIG_ORDER' && id) {
    return { type, id, title: (data.gigs ?? []).find((g) => g.id === id)?.title ?? null };
  }
  return { type, id, title: null };
}

function attachmentView(data: Store, senderId: string, a: MessageAttachment | null): AttachmentView | null {
  if (!a) return null;
  if (a.kind === 'ORDER') {
    const o = (data.serviceOrders ?? []).find((x) => x.id === a.orderId && (x.entrepreneurId === senderId || x.freelancerId === senderId));
    if (!o) return { kind: 'UNAVAILABLE' };
    return { kind: 'ORDER', orderId: o.id, number: o.number, title: o.title, total: o.total, status: o.status };
  }
  if (a.kind === 'INVOICE') {
    const inv = (data.invoices ?? []).find((i) => i.id === a.invoiceId && ownsInvoice(i, { type: 'FREELANCER', id: senderId }));
    if (!inv) return { kind: 'UNAVAILABLE' };
    return { kind: 'INVOICE', invoiceId: inv.id, docKind: inv.kind ?? 'FACTURE', number: inv.number, total: inv.totals.net, status: inv.status };
  }
  const link = (data.paymentLinks ?? []).find((l) => l.id === a.linkId && l.freelancerId === senderId);
  if (!link) return { kind: 'UNAVAILABLE' };
  return { kind: 'PAYMENT_LINK', linkId: link.id, title: link.serviceName, amount: link.amount, status: link.status, payPath: `/pay/${link.slug}` };
}

const preview = (body: string, a: MessageAttachment | null) =>
  (body.trim() || (a ? ({ INVOICE: '📄', PAYMENT_LINK: '🔗', ORDER: '📦' } as const)[a.kind] : '')).replace(/\s+/g, ' ').slice(0, PREVIEW_CHARS);

/* ─────────────────────────── Context rules ─────────────────────────── */

/**
 * Who a thread about this object can be opened with. Each later phase adds
 * its context here (gig orders, quote requests, cofounder matches).
 */
function validateContext(data: Store, fromId: string, toId: string, type: ContextType, id: string | null): boolean {
  switch (type) {
    case 'VENTURE': {
      // Write to the founder about their public venture page.
      const v = id ? (data.ventures ?? []).find((x) => x.id === id) : undefined;
      return Boolean(v && v.ownerId === toId && v.ownerId !== fromId && publicVenture(data, v));
    }
    case 'QUOTE_REQUEST': {
      // Opened by `hiring/quotes` for the request it just recorded.
      const q = id ? (data.quoteRequests ?? []).find((x) => x.id === id) : undefined;
      return Boolean(q && q.entrepreneurId === fromId && q.freelancerId === toId);
    }
    case 'GIG_ORDER': {
      // A question about a live gig, to the freelancer who sells it.
      const g = id ? (data.gigs ?? []).find((x) => x.id === id) : undefined;
      return Boolean(g && g.isActive && g.freelancerId === toId && g.freelancerId !== fromId);
    }
    default:
      return false;
  }
}

/* ─────────────────────────── Commands ─────────────────────────── */

export type MessagingError =
  | 'NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'BLOCKED'
  | 'CONTACT_LIMIT'
  | 'INVALID_ATTACHMENT'
  | 'EMPTY';

export type Result<T> = { ok: true; value: T } | { ok: false; reason: MessagingError; limit?: number };

function checkAttachment(data: Store, senderId: string, a: MessageAttachment | null, recipientId?: string): boolean {
  if (!a) return true;
  if (a.kind === 'ORDER') {
    // An order card goes only between the two parties of that order.
    const o = (data.serviceOrders ?? []).find((x) => x.id === a.orderId);
    const parties = o ? [o.entrepreneurId, o.freelancerId] : [];
    return parties.includes(senderId) && (!recipientId || parties.includes(recipientId));
  }
  if (a.kind === 'INVOICE') {
    const inv = (data.invoices ?? []).find((i) => i.id === a.invoiceId);
    return Boolean(inv && inv.status !== 'CANCELLED' && ownsInvoice(inv, { type: 'FREELANCER', id: senderId }));
  }
  const link = (data.paymentLinks ?? []).find((l) => l.id === a.linkId);
  return Boolean(link && link.freelancerId === senderId && link.status === 'ACTIVE');
}

/** Start a thread about an object (or continue the existing one) with a first message. */
export async function startConversation(input: {
  fromId: string;
  toId: string;
  contextType: ContextType;
  contextId: string | null;
  body: string;
  /** A card sent with the first message (e.g. the order a gig order opens with). */
  attachment?: MessageAttachment | null;
}): Promise<Result<{ conversationId: string }>> {
  const body = input.body.trim();
  const attachment = input.attachment ?? null;
  if (!body && !attachment) return { ok: false, reason: 'EMPTY' };
  const data = await db.read();
  const from = data.users.find((u) => u.id === input.fromId);
  const to = data.users.find((u) => u.id === input.toId);
  if (!canMessage(from) || !canMessage(to) || input.fromId === input.toId) return { ok: false, reason: 'NOT_ALLOWED' };
  if (!validateContext(data, input.fromId, input.toId, input.contextType, input.contextId)) return { ok: false, reason: 'NOT_FOUND' };

  if (!checkAttachment(data, input.fromId, attachment, input.toId)) return { ok: false, reason: 'INVALID_ATTACHMENT' };
  const repo = messagingRepo();
  if (await repo.isBlockedEitherWay(input.fromId, input.toId)) return { ok: false, reason: 'BLOCKED' };

  let conv = await repo.findConversation(input.contextType, input.contextId, input.fromId, input.toId);
  if (!conv) {
    // Someone already in the user's threads is not a new contact.
    const known = await repo.contactsOf(input.fromId);
    if (!known.has(input.toId)) {
      // null = unlimited (paid plans) — never `?? 0` here.
      const ent = entitlementsForUser(from!);
      const limit = ent ? ent.newContactsPerWeek : 0;
      if (limit !== null) {
        const opened = await repo.openedSince(input.fromId, new Date(Date.now() - WEEK_MS).toISOString());
        if (new Set(opened.map((o) => o.otherId)).size >= limit) return { ok: false, reason: 'CONTACT_LIMIT', limit };
      }
    }
    conv = await repo.createConversation({
      contextType: input.contextType,
      contextId: input.contextId,
      createdBy: input.fromId,
      userIds: [input.fromId, input.toId],
    });
  }
  const sent = await deliver(data, conv.id, input.fromId, input.toId, body, attachment);
  return sent.ok ? { ok: true, value: { conversationId: conv.id } } : sent;
}

/** Reply in a thread the user belongs to. */
export async function sendMessage(input: {
  userId: string;
  conversationId: string;
  body: string;
  attachment: MessageAttachment | null;
}): Promise<Result<MessageView>> {
  const body = input.body.trim();
  if (!body && !input.attachment) return { ok: false, reason: 'EMPTY' };
  const data = await db.read();
  const me = data.users.find((u) => u.id === input.userId);
  if (!canMessage(me)) return { ok: false, reason: 'NOT_ALLOWED' };
  const repo = messagingRepo();
  const conv = await repo.getConversation(input.conversationId);
  const other = conv?.participants.find((p) => p.userId !== input.userId);
  if (!conv || !other || !conv.participants.some((p) => p.userId === input.userId)) return { ok: false, reason: 'NOT_FOUND' };
  if (!canMessage(data.users.find((u) => u.id === other.userId))) return { ok: false, reason: 'NOT_ALLOWED' };
  if (await repo.isBlockedEitherWay(input.userId, other.userId)) return { ok: false, reason: 'BLOCKED' };
  if (!checkAttachment(data, input.userId, input.attachment, other.userId)) return { ok: false, reason: 'INVALID_ATTACHMENT' };
  const sent = await deliver(data, conv.id, input.userId, other.userId, body, input.attachment, conv);
  // A devis sent in a quote thread answers the request.
  if (sent.ok && conv.contextType === 'QUOTE_REQUEST' && input.attachment?.kind === 'INVOICE') {
    await db.update((d) => {
      const q = d.quoteRequests?.find((x) => x.id === conv.contextId && x.freelancerId === input.userId);
      if (q && q.status === 'OPEN') { q.status = 'ANSWERED'; q.updatedAt = new Date().toISOString(); }
    });
  }
  return sent;
}

async function deliver(
  data: Store,
  conversationId: string,
  senderId: string,
  recipientId: string,
  body: string,
  attachment: MessageAttachment | null,
  conv?: ConversationWithParticipants,
): Promise<Result<MessageView>> {
  const repo = messagingRepo();
  const m = await repo.addMessage({ conversationId, senderId, body, attachment, preview: preview(body, attachment) });
  // The sender has read everything up to their own message.
  await repo.updateParticipant(conversationId, senderId, { lastReadAt: m.createdAt });
  await alertRecipient(data, conv ?? (await repo.getConversation(conversationId))!, senderId, recipientId, m);
  return { ok: true, value: toView(data, senderId, m) };
}

async function alertRecipient(data: Store, conv: ConversationWithParticipants, senderId: string, recipientId: string, m: Message) {
  const p = conv.participants.find((x) => x.userId === recipientId);
  if (!p || p.muted) return;
  // At most one alert per thread per window, and none while they are in it.
  const quietSince = new Date(Date.now() - ALERT_EVERY_MIN * 60_000).toISOString();
  const activeSince = new Date(Date.now() - ACTIVE_MIN * 60_000).toISOString();
  if (p.lastAlertedAt && p.lastAlertedAt > quietSince) return;
  if (p.lastReadAt && p.lastReadAt > activeSince) return;
  const to = data.users.find((u) => u.id === recipientId);
  const from = data.users.find((u) => u.id === senderId);
  if (!to || !from) return;
  await messagingRepo().updateParticipant(conv.id, recipientId, { lastAlertedAt: m.createdAt });
  const lang = to.locale === 'ar' || to.locale === 'en' ? to.locale : 'fr';
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz').replace(/\/$/, '');
  const path = `/dashboard/${to.role === 'FREELANCER' ? 'freelancer' : 'entrepreneur'}/messages?c=${conv.id}`;
  await Promise.allSettled([
    // No message text in the alert: it may be read on a shared phone.
    sendNewMessageAlert({ fullName: to.fullName, email: to.email || null, phone: to.phone || null, locale: to.locale ?? null, senderName: from.fullName, url: `${base}/${lang}${path}` }),
    createNotification({ userId: to.id, type: 'GENERAL', title: from.fullName, body: preview(m.body, m.attachment), href: path }),
  ]);
}

function toView(data: Store, viewerId: string, m: Message): MessageView {
  return { id: m.id, fromMe: m.senderId === viewerId, body: m.body, attachment: attachmentView(data, m.senderId, m.attachment), createdAt: m.createdAt };
}

/* ─────────────────────────── Queries ─────────────────────────── */

export async function inbox(userId: string): Promise<ThreadSummary[]> {
  const data = await db.read();
  const repo = messagingRepo();
  const [convs, blocked] = await Promise.all([repo.conversationsFor(userId, 100), repo.blockedBy(userId)]);
  return convs.flatMap((c): ThreadSummary[] => {
    const mine = c.participants.find((p) => p.userId === userId);
    const other = c.participants.find((p) => p.userId !== userId);
    if (!mine || !other) return [];
    return [{
      id: c.id,
      other: person(data, other.userId),
      context: contextView(data, c.contextType, c.contextId),
      preview: c.lastMessagePreview,
      lastMessageAt: c.lastMessageAt,
      lastFromMe: c.lastSenderId === userId,
      unread: isUnread(c, userId),
      muted: mine.muted,
      blocked: blocked.has(other.userId),
    }];
  });
}

function isUnread(c: ConversationWithParticipants, userId: string): boolean {
  const mine = c.participants.find((p) => p.userId === userId);
  return Boolean(c.lastMessageAt && c.lastSenderId !== userId && (!mine?.lastReadAt || mine.lastReadAt < c.lastMessageAt));
}

/** Threads with something unread — the nav badge. */
export async function unreadThreads(userId: string): Promise<number> {
  const convs = await messagingRepo().conversationsFor(userId, 100);
  return convs.filter((c) => isUnread(c, userId)).length;
}

export interface ThreadView {
  summary: ThreadSummary;
  messages: MessageView[];
  /** More messages exist before the first one returned. */
  hasMore: boolean;
}

/**
 * Messages of one thread. With `after`: only newer ones (polling). With
 * `before`: an older page. Reading the newest page marks the thread read.
 */
export async function thread(userId: string, conversationId: string, opts: { after?: string; before?: string } = {}): Promise<ThreadView | null> {
  const repo = messagingRepo();
  const conv = await repo.getConversation(conversationId);
  if (!conv || !conv.participants.some((p) => p.userId === userId)) return null;
  const limit = 50;
  const msgs = await repo.messages(conversationId, { after: opts.after, before: opts.before, limit: limit + 1 });
  const hasMore = !opts.after && msgs.length > limit;
  const page = hasMore ? msgs.slice(1) : msgs;
  if (!opts.before && conv.lastMessageAt && isUnread(conv, userId)) {
    await repo.updateParticipant(conversationId, userId, { lastReadAt: conv.lastMessageAt });
    const me = conv.participants.find((p) => p.userId === userId)!;
    me.lastReadAt = conv.lastMessageAt;
  }
  const data = await db.read();
  const summary = (await inbox(userId)).find((s) => s.id === conversationId);
  if (!summary) return null;
  return { summary, messages: page.map((m) => toView(data, userId, m)), hasMore };
}

/* ─────────────────────────── Safety ─────────────────────────── */

async function otherOf(userId: string, conversationId: string): Promise<string | null> {
  const conv = await messagingRepo().getConversation(conversationId);
  if (!conv || !conv.participants.some((p) => p.userId === userId)) return null;
  return conv.participants.find((p) => p.userId !== userId)?.userId ?? null;
}

export async function setBlocked(userId: string, conversationId: string, blocked: boolean): Promise<boolean> {
  const other = await otherOf(userId, conversationId);
  if (!other) return false;
  if (blocked) await messagingRepo().block(userId, other);
  else await messagingRepo().unblock(userId, other);
  return true;
}

export async function setMuted(userId: string, conversationId: string, muted: boolean): Promise<boolean> {
  if (!(await otherOf(userId, conversationId))) return false;
  await messagingRepo().updateParticipant(conversationId, userId, { muted });
  return true;
}

/** Report a thread: freezes its last messages for the admin queue. */
export async function reportConversation(input: {
  userId: string;
  conversationId: string;
  reason: MessageReportReason;
  note: string | null;
}): Promise<boolean> {
  const other = await otherOf(input.userId, input.conversationId);
  if (!other) return false;
  const msgs = await messagingRepo().messages(input.conversationId, { limit: 30 });
  const now = new Date().toISOString();
  const admins = await db.update((d) => {
    if (!d.messageReports) d.messageReports = [];
    d.messageReports.push({
      id: randomUUID(),
      conversationId: input.conversationId,
      reporterId: input.userId,
      reportedId: other,
      reason: input.reason,
      note: input.note,
      snapshot: msgs.map((m) => ({ senderId: m.senderId, body: m.body, createdAt: m.createdAt })),
      status: 'OPEN',
      resolvedBy: null,
      resolvedAt: null,
      createdAt: now,
    });
    return d.users.filter((u) => u.role === 'ADMIN' && u.status === 'ACTIVE').map((u) => u.id);
  });
  await Promise.allSettled(admins.map((id) => createNotification({
    userId: id, type: 'GENERAL', title: 'Signalement de conversation', body: input.reason, href: '/dashboard/admin/message-reports',
  })));
  return true;
}

/* ─────────────────────────── Cards ─────────────────────────── */

/**
 * An invoice shared in a thread, for the PDF download: only a participant of
 * that thread, only an invoice really sent there, only while its sender
 * still owns it.
 */
export async function sharedInvoice(userId: string, conversationId: string, invoiceId: string) {
  const repo = messagingRepo();
  const conv = await repo.getConversation(conversationId);
  if (!conv || !conv.participants.some((p) => p.userId === userId)) return null;
  const msgs = await repo.messages(conversationId, { limit: 1000 });
  const sentBy = msgs.find((m) => m.attachment?.kind === 'INVOICE' && m.attachment.invoiceId === invoiceId)?.senderId;
  if (!sentBy) return null;
  const data = await db.read();
  return (data.invoices ?? []).find((i) => i.id === invoiceId && ownsInvoice(i, { type: 'FREELANCER', id: sentBy })) ?? null;
}

/** What a freelancer can share in a thread: recent documents and active payment links. */
export async function attachables(userId: string) {
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  if (user?.role !== 'FREELANCER') return { invoices: [], links: [] };
  const invoices = (data.invoices ?? [])
    .filter((i) => i.status !== 'CANCELLED' && ownsInvoice(i, { type: 'FREELANCER', id: userId }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30)
    .map((i) => ({ id: i.id, docKind: i.kind ?? 'FACTURE', number: i.number, total: i.totals.net, client: i.clientSnapshot?.name ?? null }));
  const links = (data.paymentLinks ?? [])
    .filter((l) => l.freelancerId === userId && l.status === 'ACTIVE')
    .slice(0, 30)
    .map((l) => ({ id: l.id, title: l.serviceName, amount: l.amount }));
  return { invoices, links };
}
