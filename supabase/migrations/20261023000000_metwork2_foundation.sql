-- ─────────────────────────────────────────────────────────────────────────────
-- Metwork 2.0 — phase 0 foundation tables (Supabase Postgres)
--
-- NOT APPLIED AUTOMATICALLY. Run once in the Supabase SQL editor (or
-- `supabase db push`) after review. Idempotent: every statement is guarded,
-- so running it twice is a no-op.
--
-- Why real tables: the app state is ONE JSONB document and every db.update()
-- rewrites all of it. Chat and cofounder swipes are many
-- small writes, so they live here. Money never does —
-- wallets, invoices, payment links and settlements stay in the JSONB store so
-- they settle atomically with commission.
--
-- Ids that reference the JSONB store (users) are TEXT, not uuid: seeded and
-- imported accounts have ids like 'qa-explorer-id'.
--
-- Security: RLS is enabled on every table with NO policies, so the anon key
-- can read or write nothing. Only the server (service-role key) reaches these
-- tables, behind the same session guards as every API route. Live chat
-- delivery (phase 6) must therefore NOT subscribe with the anon key directly;
-- it goes through a server-minted, per-conversation token or broadcast.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Messaging (phase 6) ─────────────────────────────────────────────────────

create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  -- What the thread is about. DIRECT = a connection request with no object.
  context_type    text not null check (context_type in
                    ('DIRECT', 'GIG_ORDER', 'QUOTE_REQUEST', 'COFOUNDER_MATCH', 'BOOKING', 'VENTURE')),
  context_id      text,
  -- Who opened the thread: the weekly "new contacts" limit counts these.
  created_by      text not null,
  created_at      timestamptz not null default now(),
  -- Denormalised so the inbox and the unread badge need no message scan.
  last_message_at      timestamptz,
  last_sender_id       text,
  last_message_preview text
);
create index if not exists conversations_context_idx
  on public.conversations (context_type, context_id);
create index if not exists conversations_created_by_idx
  on public.conversations (created_by, created_at desc);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         text not null,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
  -- Last WhatsApp/email alert for this thread: alerts are throttled per thread.
  last_alerted_at timestamptz,
  muted           boolean not null default false,
  primary key (conversation_id, user_id)
);
create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       text not null,
  body            text not null check (char_length(body) between 1 and 4000),
  -- Structured card (devis, payment link, contract) — ids only, never amounts
  -- copied from the store, so a card always renders the live record.
  attachment      jsonb,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

create table if not exists public.user_blocks (
  blocker_id text not null,
  blocked_id text not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ── Find my cofounder (phase 8) ─────────────────────────────────────────────

create table if not exists public.cofounder_swipes (
  swiper_id  text not null,
  target_id  text not null,
  decision   text not null check (decision in ('LIKE', 'PASS')),
  created_at timestamptz not null default now(),
  primary key (swiper_id, target_id),
  check (swiper_id <> target_id)
);
-- "Someone liked you" counts: likes received, never exposing who.
create index if not exists cofounder_swipes_target_like_idx
  on public.cofounder_swipes (target_id, created_at desc) where decision = 'LIKE';

create table if not exists public.cofounder_matches (
  id              uuid primary key default gen_random_uuid(),
  -- Stored ordered (user_a < user_b) so a pair can only match once.
  user_a          text not null,
  user_b          text not null,
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);
create index if not exists cofounder_matches_user_b_idx on public.cofounder_matches (user_b);

-- The AI copilot (phase 5) keeps its index as a private file, not in tables:
-- see src/server/copilot/kb-store.ts.

-- ── Lock everything down: server (service role) only ────────────────────────

alter table public.conversations              enable row level security;
alter table public.conversation_participants  enable row level security;
alter table public.messages                   enable row level security;
alter table public.user_blocks                enable row level security;
alter table public.cofounder_swipes           enable row level security;
alter table public.cofounder_matches          enable row level security;
