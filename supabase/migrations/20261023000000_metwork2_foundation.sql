-- ─────────────────────────────────────────────────────────────────────────────
-- Metwork 2.0 — phase 0 foundation tables (Supabase Postgres)
--
-- NOT APPLIED AUTOMATICALLY. Run once in the Supabase SQL editor (or
-- `supabase db push`) after review. Idempotent: every statement is guarded,
-- so running it twice is a no-op.
--
-- Why real tables: the app state is ONE JSONB document and every db.update()
-- rewrites all of it. Chat, swipes and the copilot knowledge base are many
-- small writes or thousands of rows, so they live here. Money never does —
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
  created_at      timestamptz not null default now(),
  last_message_at timestamptz
);
create index if not exists conversations_context_idx
  on public.conversations (context_type, context_id);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         text not null,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
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

-- ── AI copilot knowledge base (phase 5) ─────────────────────────────────────

create table if not exists public.kb_documents (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  -- Path relative to the `tax documents/` folder, or 'upload:<id>' for admin uploads.
  source_path    text not null unique,
  sha256         text not null,
  kind           text not null check (kind in ('CODE', 'FINANCE_LAW', 'FORM', 'NOTICE', 'LAW', 'ACCOUNTING', 'OTHER')),
  lang           text not null default 'fr' check (lang in ('fr', 'ar', 'en')),
  -- Year the text is in force from; newer documents win on conflict.
  effective_year int,
  active         boolean not null default true,
  -- Set when the PDF has no text layer and must be OCR'd before indexing.
  needs_ocr      boolean not null default false,
  passage_count  int not null default 0,
  indexed_at     timestamptz not null default now()
);

create table if not exists public.kb_passages (
  id          bigint generated always as identity primary key,
  document_id uuid not null references public.kb_documents (id) on delete cascade,
  ordinal     int not null,
  heading     text,
  -- Article number as printed ("Art. 282 bis"), when the passage is one.
  article     text,
  page        int,
  content     text not null,
  lang        text not null default 'fr',
  -- Postgres has no Arabic stemmer; Arabic passages use the 'simple' config.
  tsv         tsvector generated always as (
                to_tsvector(
                  case when lang = 'ar' then 'simple'::regconfig else 'french'::regconfig end,
                  coalesce(heading, '') || ' ' || coalesce(article, '') || ' ' || content
                )
              ) stored,
  unique (document_id, ordinal)
);
create index if not exists kb_passages_tsv_idx on public.kb_passages using gin (tsv);
create index if not exists kb_passages_article_idx on public.kb_passages (article) where article is not null;

create table if not exists public.copilot_threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists copilot_threads_user_idx on public.copilot_threads (user_id, updated_at desc);

create table if not exists public.copilot_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.copilot_threads (id) on delete cascade,
  -- Denormalised so the monthly quota is one indexed count.
  user_id     text not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null check (char_length(content) <= 20000),
  -- [{ passageId, documentTitle, article, page }]
  citations   jsonb,
  tokens_in   int,
  tokens_out  int,
  created_at  timestamptz not null default now()
);
create index if not exists copilot_messages_thread_idx on public.copilot_messages (thread_id, created_at);
create index if not exists copilot_messages_quota_idx
  on public.copilot_messages (user_id, created_at) where role = 'user';

-- ── Lock everything down: server (service role) only ────────────────────────

alter table public.conversations              enable row level security;
alter table public.conversation_participants  enable row level security;
alter table public.messages                   enable row level security;
alter table public.user_blocks                enable row level security;
alter table public.cofounder_swipes           enable row level security;
alter table public.cofounder_matches          enable row level security;
alter table public.kb_documents               enable row level security;
alter table public.kb_passages                enable row level security;
alter table public.copilot_threads            enable row level security;
alter table public.copilot_messages           enable row level security;
