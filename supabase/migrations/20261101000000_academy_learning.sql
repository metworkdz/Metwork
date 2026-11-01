-- ─────────────────────────────────────────────────────────────────────────────
-- Startup Academy — phase 5 tables (learner notes, lesson Q&A)
--
-- NOT APPLIED AUTOMATICALLY. Run once in the Supabase SQL editor (or
-- `supabase db push`) BEFORE deploying phase 5. Idempotent.
--
-- Notes and Q&A grow without bound (every learner, every lesson), so they live
-- here and not in the JSONB store. Reviews, quiz results and certificates are
-- bounded (one per learner and course or module) and stay in the store.
--
-- Security: RLS on, NO policies — only the server (service-role key) reads or
-- writes, after its own access checks.
-- ─────────────────────────────────────────────────────────────────────────────

-- Private notes a learner pins to a moment of a lesson.
create table if not exists public.academy_notes (
  id            uuid primary key,
  user_id       text not null,
  course_id     text not null,
  lesson_id     text not null,
  position_sec  integer not null default 0 check (position_sec >= 0),
  body          text not null check (char_length(body) between 1 and 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists academy_notes_user_course_idx on public.academy_notes (user_id, course_id);
alter table public.academy_notes enable row level security;

-- Lesson Q&A: a question (parent_id null) and its answers, visible to every
-- learner of the course. Hidden posts stay for the admin's audit.
create table if not exists public.academy_posts (
  id           uuid primary key,
  course_id    text not null,
  lesson_id    text not null,
  parent_id    uuid references public.academy_posts (id) on delete cascade,
  author_kind  text not null check (author_kind in ('USER', 'MENTOR', 'ADMIN')),
  author_id    text not null,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now(),
  hidden_at    timestamptz,
  hidden_by    text
);
create index if not exists academy_posts_lesson_idx on public.academy_posts (course_id, lesson_id, created_at);
create index if not exists academy_posts_parent_idx on public.academy_posts (parent_id);
create index if not exists academy_posts_course_idx on public.academy_posts (course_id, created_at desc);
alter table public.academy_posts enable row level security;

-- Learners whose last progress on a course falls between two instants
-- (reminder emails: started, then stopped).
create or replace function public.academy_inactive_learners(p_from timestamptz, p_to timestamptz)
returns table (user_id text, course_id text, last_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select p.user_id, p.course_id, max(p.updated_at)
  from public.academy_progress p
  group by p.user_id, p.course_id
  having max(p.updated_at) >= p_from and max(p.updated_at) < p_to;
$$;

revoke all on function public.academy_inactive_learners(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.academy_inactive_learners(timestamptz, timestamptz) to service_role;
