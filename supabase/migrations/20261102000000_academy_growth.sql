-- ─────────────────────────────────────────────────────────────────────────────
-- Startup Academy — phase 6 table (lesson subtitles)
--
-- NOT APPLIED AUTOMATICALLY. Run once in the Supabase SQL editor (or
-- `supabase db push`) BEFORE deploying phase 6. Idempotent.
--
-- The WebVTT text of each lesson's subtitles, per language: the author's
-- upload (from the whisper pipeline) and the machine-drafted translations the
-- author checks. The video host (VdoCipher) gets a copy to show in the player;
-- this is the copy the builder reads and edits. Seats, gifts, bundles and
-- referrals are bounded and money-adjacent: they live in the JSONB store.
--
-- Security: RLS on, NO policies — only the server (service-role key).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.academy_subtitles (
  lesson_id   text not null,
  lang        text not null check (lang in ('fr', 'en', 'ar')),
  vtt         text not null check (char_length(vtt) <= 1000000),
  drafted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (lesson_id, lang)
);
alter table public.academy_subtitles enable row level security;
