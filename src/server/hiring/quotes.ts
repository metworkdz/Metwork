/**
 * Quote requests from the hiring tab. A request is a record (for the monthly
 * limit and the freelancer's list) plus a conversation of type QUOTE_REQUEST,
 * where the freelancer answers with a devis card.
 *
 * Validation runs before anything is written; the record is removed again if
 * the conversation cannot be opened (block, new-contact limit), so a refused
 * request never counts against the quota.
 */
import { randomUUID } from 'node:crypto';
import { db, type QuoteRequestRecord } from '@/server/db/store';
import { entitlementsForUser } from '@/lib/entitlements';
import { isListed } from '@/server/hiring/directory';
import { startConversation, type MessagingError } from '@/server/messaging/service';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';

const monthOf = (iso: string) => iso.slice(0, 7);

export interface QuoteInput {
  freelancerId: string;
  gigId: string | null;
  title: string;
  details: string;
  budget: number | null;
  deadline: string | null;
}

export type QuoteResult =
  | { ok: true; quoteId: string; conversationId: string }
  | { ok: false; reason: 'NOT_FOUND' | 'QUOTE_LIMIT' | MessagingError; limit?: number };

export function quotesUsedThisMonth(data: Awaited<ReturnType<typeof db.read>>, entrepreneurId: string): number {
  const month = monthOf(new Date().toISOString());
  return (data.quoteRequests ?? []).filter((q) => q.entrepreneurId === entrepreneurId && monthOf(q.createdAt) === month).length;
}

/** The first message of the thread, in the founder's language. */
function summary(input: QuoteInput, labels: QuoteLabels): string {
  const lines = [input.title, '', input.details];
  const extra = [
    input.budget ? `${labels.budget}: ${formatCurrency(input.budget, labels.locale)}` : null,
    input.deadline ? `${labels.deadline}: ${formatDate(`${input.deadline}T12:00:00Z`, labels.locale, { dateStyle: 'long' })}` : null,
  ].filter((l): l is string => l !== null);
  return [...lines, ...(extra.length ? ['', ...extra] : [])].join('\n').trim();
}

export interface QuoteLabels {
  locale: Locale;
  budget: string;
  deadline: string;
}

export async function requestQuote(entrepreneurId: string, input: QuoteInput, labels: QuoteLabels): Promise<QuoteResult> {
  const data = await db.read();
  const me = data.users.find((u) => u.id === entrepreneurId);
  if (!me || me.role !== 'ENTREPRENEUR') return { ok: false, reason: 'NOT_ALLOWED' };
  if (!isListed(data, input.freelancerId)) return { ok: false, reason: 'NOT_FOUND' };
  if (input.gigId && !(data.gigs ?? []).some((g) => g.id === input.gigId && g.freelancerId === input.freelancerId && g.isActive)) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  // null = unlimited (paid plans) — never `?? 0`.
  const ent = entitlementsForUser(me);
  const limit = ent?.audience === 'ENTREPRENEUR' ? ent.quoteRequestsPerMonth : 0;
  if (limit !== null && quotesUsedThisMonth(data, entrepreneurId) >= limit) return { ok: false, reason: 'QUOTE_LIMIT', limit };

  const now = new Date().toISOString();
  const quote: QuoteRequestRecord = {
    id: randomUUID(),
    entrepreneurId,
    freelancerId: input.freelancerId,
    gigId: input.gigId,
    title: input.title,
    details: input.details,
    budget: input.budget,
    deadline: input.deadline,
    status: 'OPEN',
    conversationId: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.update((d) => { (d.quoteRequests ??= []).push(quote); });

  const conv = await startConversation({
    fromId: entrepreneurId,
    toId: input.freelancerId,
    contextType: 'QUOTE_REQUEST',
    contextId: quote.id,
    body: summary(input, labels),
  });
  if (!conv.ok) {
    await db.update((d) => { d.quoteRequests = (d.quoteRequests ?? []).filter((q) => q.id !== quote.id); });
    return conv;
  }
  await db.update((d) => {
    const q = d.quoteRequests?.find((x) => x.id === quote.id);
    if (q) { q.conversationId = conv.value.conversationId; q.updatedAt = new Date().toISOString(); }
  });
  return { ok: true, quoteId: quote.id, conversationId: conv.value.conversationId };
}
