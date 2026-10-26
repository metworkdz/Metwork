-- ─────────────────────────────────────────────────────────────────────────────
-- Startup Academy — phase 0 tables (Supabase Postgres)
--
-- NOT APPLIED AUTOMATICALLY. Run once in the Supabase SQL editor (or
-- `supabase db push`) BEFORE deploying the Academy. Idempotent: running it
-- twice is a no-op.
--
-- Only high-frequency writes live here: where a learner stopped in each lesson
-- and how long they watched (one heartbeat every 30 s while playing). Courses,
-- settings and enrollments stay in the JSONB store, next to the payments that
-- create them, so a paid course is granted in the same atomic update.
--
-- User, course, lesson and mentor ids reference the JSONB store, so they are
-- TEXT (seeded accounts have ids like 'qa-explorer-id').
--
-- Security: RLS on, NO policies — only the server (service-role key) reads or
-- writes. The functions are revoked from anon/authenticated for the same reason.
-- ─────────────────────────────────────────────────────────────────────────────

-- Where each learner is in each lesson (resume point, completion).
create table if not exists public.academy_progress (
  user_id       text not null,
  lesson_id     text not null,
  course_id     text not null,
  position_sec  integer not null default 0 check (position_sec >= 0),
  completed_at  timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index if not exists academy_progress_user_course_idx
  on public.academy_progress (user_id, course_id);
alter table public.academy_progress enable row level security;

-- Seconds watched per learner, lesson and day. The Academy Pass is split
-- between mentors from the PASS rows of the month (per subscriber, by time).
-- mentor_id and access are frozen when the first second of the day is counted.
create table if not exists public.academy_watch_ledger (
  user_id     text not null,
  lesson_id   text not null,
  day         date not null,
  course_id   text not null,
  mentor_id   text not null,
  access      text not null check (access in ('PASS', 'OWNED', 'PREVIEW')),
  seconds     integer not null default 0 check (seconds >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, lesson_id, day)
);
create index if not exists academy_watch_ledger_day_idx
  on public.academy_watch_ledger (day, access);
alter table public.academy_watch_ledger enable row level security;

-- Add watch time atomically, never past the day's cap for that lesson.
-- p_add and p_daily_cap are computed by the app (`creditableWatchSeconds` in
-- src/lib/academy.ts); this function only makes the read-and-add race-free.
create or replace function public.academy_add_watch(
  p_user_id text, p_lesson_id text, p_course_id text, p_mentor_id text,
  p_access text, p_day date, p_add integer, p_daily_cap integer
) returns table (credited integer, total integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing integer;
  v_credit integer;
begin
  insert into public.academy_watch_ledger (user_id, lesson_id, day, course_id, mentor_id, access, seconds)
  values (p_user_id, p_lesson_id, p_day, p_course_id, p_mentor_id, p_access, 0)
  on conflict (user_id, lesson_id, day) do nothing;

  select l.seconds into v_existing
  from public.academy_watch_ledger l
  where l.user_id = p_user_id and l.lesson_id = p_lesson_id and l.day = p_day
  for update;

  v_credit := least(greatest(p_add, 0), greatest(p_daily_cap - v_existing, 0));
  if v_credit > 0 then
    update public.academy_watch_ledger
    set seconds = seconds + v_credit, updated_at = now()
    where user_id = p_user_id and lesson_id = p_lesson_id and day = p_day;
  end if;

  return query select v_credit, v_existing + v_credit;
end;
$$;

-- Seconds per subscriber and mentor over a period (Pass settlement input).
create or replace function public.academy_watch_totals(p_from date, p_to date, p_access text)
returns table (user_id text, mentor_id text, seconds bigint)
language sql
security definer
set search_path = public
as $$
  select l.user_id, l.mentor_id, sum(l.seconds)::bigint
  from public.academy_watch_ledger l
  where l.day >= p_from and l.day <= p_to and l.access = p_access
  group by l.user_id, l.mentor_id;
$$;

revoke all on function public.academy_add_watch(text, text, text, text, text, date, integer, integer) from public, anon, authenticated;
revoke all on function public.academy_watch_totals(date, date, text) from public, anon, authenticated;
-- The server calls these with the service-role key; grant it explicitly so the
-- revokes above can never lock the app out.
grant execute on function public.academy_add_watch(text, text, text, text, text, date, integer, integer) to service_role;
grant execute on function public.academy_watch_totals(date, date, text) to service_role;
