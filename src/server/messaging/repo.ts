/**
 * Messaging storage. Chat is many small writes, so it does NOT live in the
 * JSONB store (every db.update rewrites the whole document): it lives in the
 * Postgres tables of `supabase/migrations/20261023000000_metwork2_foundation.sql`,
 * reached with the service-role key only (RLS on, no policies).
 *
 * One interface, two backends:
 *   - Supabase (production);
 *   - memory, persisted to `.local-messaging.json` under USE_LOCAL_DB=true,
 *     purely in memory under tests.
 * The service never knows which one it talks to.
 */
import { randomUUID } from 'node:crypto';
import type * as NodeFs from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const CONTEXT_TYPES = ['DIRECT', 'GIG_ORDER', 'QUOTE_REQUEST', 'COFOUNDER_MATCH', 'BOOKING', 'VENTURE'] as const;
export type ContextType = (typeof CONTEXT_TYPES)[number];

/** A card in a thread: ids only — rendered from the live record. */
export type MessageAttachment =
  | { kind: 'INVOICE'; invoiceId: string }
  | { kind: 'PAYMENT_LINK'; linkId: string }
  | { kind: 'ORDER'; orderId: string };

export interface Conversation {
  id: string;
  contextType: ContextType;
  contextId: string | null;
  createdBy: string;
  createdAt: string;
  lastMessageAt: string | null;
  lastSenderId: string | null;
  lastMessagePreview: string | null;
}

export interface Participant {
  conversationId: string;
  userId: string;
  joinedAt: string;
  lastReadAt: string | null;
  lastAlertedAt: string | null;
  muted: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachment: MessageAttachment | null;
  createdAt: string;
}

export interface ConversationWithParticipants extends Conversation {
  participants: Participant[];
}

export interface MessagingRepo {
  createConversation(input: { contextType: ContextType; contextId: string | null; createdBy: string; userIds: [string, string] }): Promise<Conversation>;
  /** The thread between exactly these two users about this object, if any. */
  findConversation(contextType: ContextType, contextId: string | null, a: string, b: string): Promise<Conversation | null>;
  getConversation(id: string): Promise<ConversationWithParticipants | null>;
  /** The user's threads, most recent first. */
  conversationsFor(userId: string, limit: number): Promise<ConversationWithParticipants[]>;
  /** Users this one already has a thread with (for the weekly new-contact limit). */
  contactsOf(userId: string): Promise<Set<string>>;
  /** Threads this user opened since `since`, with the other participant. */
  openedSince(userId: string, since: string): Promise<{ conversationId: string; otherId: string }[]>;
  addMessage(input: { conversationId: string; senderId: string; body: string; attachment: MessageAttachment | null; preview: string }): Promise<Message>;
  /** Oldest first. `after` for polling, `before` for scrolling back. */
  messages(conversationId: string, opts: { after?: string; before?: string; limit: number }): Promise<Message[]>;
  updateParticipant(conversationId: string, userId: string, patch: Partial<Pick<Participant, 'lastReadAt' | 'lastAlertedAt' | 'muted'>>): Promise<void>;
  block(blockerId: string, blockedId: string): Promise<void>;
  unblock(blockerId: string, blockedId: string): Promise<void>;
  /** True when either user blocked the other. */
  isBlockedEitherWay(a: string, b: string): Promise<boolean>;
  blockedBy(userId: string): Promise<Set<string>>;
  /** Erase a user's messaging data (account deletion). */
  deleteUser(userId: string): Promise<void>;
}

/** Thrown when the tables are missing (migration not applied) or unreachable. */
export class MessagingUnavailableError extends Error {}

/* ─────────────────────────── Memory backend ─────────────────────────── */

interface MemoryState {
  conversations: Conversation[];
  participants: Participant[];
  messages: Message[];
  blocks: { blockerId: string; blockedId: string; createdAt: string }[];
}

const emptyState = (): MemoryState => ({ conversations: [], participants: [], messages: [], blocks: [] });

export function createMemoryRepo(persistPath?: string): MessagingRepo & { reset(): void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- dev-only file backend, kept out of client bundles
  const fs = persistPath ? (require('node:fs') as typeof NodeFs) : null;
  let s: MemoryState = emptyState();
  // File mode re-reads before every operation: in dev, each route bundle has
  // its own copy of this module, so a cached state would overwrite the others'.
  const load = () => {
    if (!fs || !persistPath || !fs.existsSync(persistPath)) return;
    try { s = { ...emptyState(), ...(JSON.parse(fs.readFileSync(persistPath, 'utf8')) as MemoryState) }; } catch { /* keep current */ }
  };
  const save = () => { if (fs && persistPath) fs.writeFileSync(persistPath, JSON.stringify(s), 'utf8'); };
  const withParts = (c: Conversation): ConversationWithParticipants => ({
    ...c,
    participants: s.participants.filter((p) => p.conversationId === c.id).map((p) => ({ ...p })),
  });
  const now = () => new Date().toISOString();

  return {
    reset() { s = emptyState(); save(); },
    async createConversation({ contextType, contextId, createdBy, userIds }) {
      load();
      const at = now();
      const c: Conversation = { id: randomUUID(), contextType, contextId, createdBy, createdAt: at, lastMessageAt: null, lastSenderId: null, lastMessagePreview: null };
      s.conversations.push(c);
      for (const userId of userIds) s.participants.push({ conversationId: c.id, userId, joinedAt: at, lastReadAt: null, lastAlertedAt: null, muted: false });
      save();
      return { ...c };
    },
    async findConversation(contextType, contextId, a, b) {
      load();
      const c = s.conversations.find((x) => {
        if (x.contextType !== contextType || x.contextId !== contextId) return false;
        const ids = s.participants.filter((p) => p.conversationId === x.id).map((p) => p.userId);
        return ids.length === 2 && ids.includes(a) && ids.includes(b);
      });
      return c ? { ...c } : null;
    },
    async getConversation(id) {
      load();
      const c = s.conversations.find((x) => x.id === id);
      return c ? withParts(c) : null;
    },
    async conversationsFor(userId, limit) {
      load();
      const ids = new Set(s.participants.filter((p) => p.userId === userId).map((p) => p.conversationId));
      return s.conversations
        .filter((c) => ids.has(c.id))
        .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))
        .slice(0, limit)
        .map(withParts);
    },
    async contactsOf(userId) {
      load();
      const ids = new Set(s.participants.filter((p) => p.userId === userId).map((p) => p.conversationId));
      return new Set(s.participants.filter((p) => ids.has(p.conversationId) && p.userId !== userId).map((p) => p.userId));
    },
    async openedSince(userId, since) {
      load();
      return s.conversations
        .filter((c) => c.createdBy === userId && c.createdAt >= since)
        .map((c) => ({ conversationId: c.id, otherId: s.participants.find((p) => p.conversationId === c.id && p.userId !== userId)?.userId ?? '' }));
    },
    async addMessage({ conversationId, senderId, body, attachment, preview }) {
      load();
      const m: Message = { id: randomUUID(), conversationId, senderId, body, attachment, createdAt: now() };
      s.messages.push(m);
      const c = s.conversations.find((x) => x.id === conversationId);
      if (c) { c.lastMessageAt = m.createdAt; c.lastSenderId = senderId; c.lastMessagePreview = preview; }
      save();
      return { ...m };
    },
    async messages(conversationId, { after, before, limit }) {
      load();
      const all = s.messages.filter((m) => m.conversationId === conversationId && (!after || m.createdAt > after) && (!before || m.createdAt < before));
      // Newest `limit`, returned oldest first.
      return (after ? all.slice(0, limit) : all.slice(-limit)).map((m) => ({ ...m }));
    },
    async updateParticipant(conversationId, userId, patch) {
      load();
      const p = s.participants.find((x) => x.conversationId === conversationId && x.userId === userId);
      if (p) { Object.assign(p, patch); save(); }
    },
    async block(blockerId, blockedId) {
      load();
      if (!s.blocks.some((b) => b.blockerId === blockerId && b.blockedId === blockedId)) {
        s.blocks.push({ blockerId, blockedId, createdAt: now() });
        save();
      }
    },
    async unblock(blockerId, blockedId) {
      load();
      s.blocks = s.blocks.filter((b) => !(b.blockerId === blockerId && b.blockedId === blockedId));
      save();
    },
    async isBlockedEitherWay(a, b) {
      load();
      return s.blocks.some((x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a));
    },
    async blockedBy(userId) {
      load();
      return new Set(s.blocks.filter((b) => b.blockerId === userId).map((b) => b.blockedId));
    },
    async deleteUser(userId) {
      load();
      const convIds = new Set(s.participants.filter((p) => p.userId === userId).map((p) => p.conversationId));
      s.conversations = s.conversations.filter((c) => !convIds.has(c.id));
      s.participants = s.participants.filter((p) => !convIds.has(p.conversationId));
      s.messages = s.messages.filter((m) => !convIds.has(m.conversationId));
      s.blocks = s.blocks.filter((b) => b.blockerId !== userId && b.blockedId !== userId);
      save();
    },
  };
}

/* ─────────────────────────── Supabase backend ─────────────────────────── */

type Row = Record<string, unknown>;

const toConversation = (r: Row): Conversation => ({
  id: r.id as string,
  contextType: r.context_type as ContextType,
  contextId: (r.context_id as string | null) ?? null,
  createdBy: r.created_by as string,
  createdAt: r.created_at as string,
  lastMessageAt: (r.last_message_at as string | null) ?? null,
  lastSenderId: (r.last_sender_id as string | null) ?? null,
  lastMessagePreview: (r.last_message_preview as string | null) ?? null,
});
const toParticipant = (r: Row): Participant => ({
  conversationId: r.conversation_id as string,
  userId: r.user_id as string,
  joinedAt: r.joined_at as string,
  lastReadAt: (r.last_read_at as string | null) ?? null,
  lastAlertedAt: (r.last_alerted_at as string | null) ?? null,
  muted: Boolean(r.muted),
});
const toMessage = (r: Row): Message => ({
  id: r.id as string,
  conversationId: r.conversation_id as string,
  senderId: r.sender_id as string,
  body: r.body as string,
  attachment: (r.attachment as MessageAttachment | null) ?? null,
  createdAt: r.created_at as string,
});

/** Ids go into PostgREST `or()` filter strings: refuse anything but plain id characters. */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new MessagingUnavailableError('Invalid id');
  return id;
}

function check<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) {
    // 42P01 = undefined table: the migration was not applied.
    throw new MessagingUnavailableError(`${res.error.code ?? ''} ${res.error.message}`.trim());
  }
  return res.data as T;
}

export function createSupabaseRepo(client: SupabaseClient): MessagingRepo {
  const participantsOf = async (ids: string[]): Promise<Participant[]> => {
    if (!ids.length) return [];
    return check(await client.from('conversation_participants').select('*').in('conversation_id', ids)).map(toParticipant);
  };

  return {
    async createConversation({ contextType, contextId, createdBy, userIds }) {
      const c = toConversation(check(await client.from('conversations')
        .insert({ context_type: contextType, context_id: contextId, created_by: createdBy })
        .select('*').single()) as Row);
      check(await client.from('conversation_participants').insert(userIds.map((user_id) => ({ conversation_id: c.id, user_id }))));
      return c;
    },
    async findConversation(contextType, contextId, a, b) {
      const mine = check(await client.from('conversation_participants').select('conversation_id').eq('user_id', a)) as Row[];
      const ids = mine.map((r) => r.conversation_id as string);
      if (!ids.length) return null;
      let q = client.from('conversations').select('*').in('id', ids).eq('context_type', contextType);
      q = contextId === null ? q.is('context_id', null) : q.eq('context_id', contextId);
      const candidates = (check(await q) as Row[]).map(toConversation);
      if (!candidates.length) return null;
      const parts = await participantsOf(candidates.map((c) => c.id));
      return candidates.find((c) => {
        const users = parts.filter((p) => p.conversationId === c.id).map((p) => p.userId);
        return users.length === 2 && users.includes(b);
      }) ?? null;
    },
    async getConversation(id) {
      const rows = check(await client.from('conversations').select('*').eq('id', id)) as Row[];
      if (!rows[0]) return null;
      return { ...toConversation(rows[0]), participants: await participantsOf([id]) };
    },
    async conversationsFor(userId, limit) {
      const mine = check(await client.from('conversation_participants').select('conversation_id').eq('user_id', userId)) as Row[];
      const ids = mine.map((r) => r.conversation_id as string);
      if (!ids.length) return [];
      const convs = (check(await client.from('conversations').select('*').in('id', ids)
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(limit)) as Row[]).map(toConversation);
      const parts = await participantsOf(convs.map((c) => c.id));
      return convs.map((c) => ({ ...c, participants: parts.filter((p) => p.conversationId === c.id) }));
    },
    async contactsOf(userId) {
      const mine = check(await client.from('conversation_participants').select('conversation_id').eq('user_id', userId)) as Row[];
      const parts = await participantsOf(mine.map((r) => r.conversation_id as string));
      return new Set(parts.filter((p) => p.userId !== userId).map((p) => p.userId));
    },
    async openedSince(userId, since) {
      const convs = check(await client.from('conversations').select('id').eq('created_by', userId).gte('created_at', since)) as Row[];
      const parts = await participantsOf(convs.map((c) => c.id as string));
      return convs.map((c) => ({ conversationId: c.id as string, otherId: parts.find((p) => p.conversationId === c.id && p.userId !== userId)?.userId ?? '' }));
    },
    async addMessage({ conversationId, senderId, body, attachment, preview }) {
      const m = toMessage(check(await client.from('messages')
        .insert({ conversation_id: conversationId, sender_id: senderId, body, attachment })
        .select('*').single()) as Row);
      check(await client.from('conversations')
        .update({ last_message_at: m.createdAt, last_sender_id: senderId, last_message_preview: preview })
        .eq('id', conversationId));
      return m;
    },
    async messages(conversationId, { after, before, limit }) {
      let q = client.from('messages').select('*').eq('conversation_id', conversationId).is('deleted_at', null);
      if (after) q = q.gt('created_at', after);
      if (before) q = q.lt('created_at', before);
      const rows = (check(await q.order('created_at', { ascending: !!after }).limit(limit)) as Row[]).map(toMessage);
      return after ? rows : rows.reverse();
    },
    async updateParticipant(conversationId, userId, patch) {
      const row: Row = {};
      if (patch.lastReadAt !== undefined) row.last_read_at = patch.lastReadAt;
      if (patch.lastAlertedAt !== undefined) row.last_alerted_at = patch.lastAlertedAt;
      if (patch.muted !== undefined) row.muted = patch.muted;
      check(await client.from('conversation_participants').update(row).eq('conversation_id', conversationId).eq('user_id', userId));
    },
    async block(blockerId, blockedId) {
      check(await client.from('user_blocks').upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id' }));
    },
    async unblock(blockerId, blockedId) {
      check(await client.from('user_blocks').delete().eq('blocker_id', blockerId).eq('blocked_id', blockedId));
    },
    async isBlockedEitherWay(a, b) {
      const rows = check(await client.from('user_blocks').select('blocker_id')
        .or(`and(blocker_id.eq.${safeId(a)},blocked_id.eq.${safeId(b)}),and(blocker_id.eq.${safeId(b)},blocked_id.eq.${safeId(a)})`)) as Row[];
      return rows.length > 0;
    },
    async blockedBy(userId) {
      const rows = check(await client.from('user_blocks').select('blocked_id').eq('blocker_id', userId)) as Row[];
      return new Set(rows.map((r) => r.blocked_id as string));
    },
    async deleteUser(userId) {
      const mine = check(await client.from('conversation_participants').select('conversation_id').eq('user_id', userId)) as Row[];
      const ids = mine.map((r) => r.conversation_id as string);
      // Cascades remove participants and messages.
      if (ids.length) check(await client.from('conversations').delete().in('id', ids));
      check(await client.from('user_blocks').delete().or(`blocker_id.eq.${safeId(userId)},blocked_id.eq.${safeId(userId)}`));
    },
  };
}

/* ─────────────────────────── Selection ─────────────────────────── */

let repo: MessagingRepo | null = null;

export function messagingRepo(): MessagingRepo {
  if (repo) return repo;
  if (process.env.NODE_ENV === 'test') repo = createMemoryRepo();
  else if (process.env.USE_LOCAL_DB === 'true') repo = createMemoryRepo(process.env.LOCAL_MESSAGING_PATH ?? '.local-messaging.json');
  else {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new MessagingUnavailableError('Supabase is not configured');
    repo = createSupabaseRepo(createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    }));
  }
  return repo;
}

/** Tests only. */
export function setMessagingRepoForTests(r: MessagingRepo | null): void {
  repo = r;
}
