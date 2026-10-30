-- ─────────────────────────────────────────────────────────────────────────────
-- Startup Academy — phase 2: one video stream per account.
--
-- NOT APPLIED AUTOMATICALLY. Apply AFTER 20261026000000_academy_foundation.sql,
-- before deploying phase 2. Idempotent.
--
-- Opening a lesson replaces the account's stream row; a heartbeat from any
-- other stream is refused, so the same login cannot watch on two devices at
-- once. The heartbeat's watch time is measured HERE (now − last_seen_at), never
-- taken from the browser.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.academy_streams (
  user_id       text primary key,
  stream_id     text not null,
  course_id     text not null,
  lesson_id     text not null,
  last_seen_at  timestamptz not null default now()
);
alter table public.academy_streams enable row level security;

-- Seconds since this stream's previous heartbeat, and the new timestamp, in one
-- atomic step. No row (another device took over) = no result.
create or replace function public.academy_touch_stream(p_user_id text, p_stream_id text)
returns table (elapsed_sec integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev timestamptz;
begin
  select s.last_seen_at into v_prev
  from public.academy_streams s
  where s.user_id = p_user_id and s.stream_id = p_stream_id
  for update;
  if not found then
    return;
  end if;
  update public.academy_streams set last_seen_at = now()
  where user_id = p_user_id and stream_id = p_stream_id;
  return query select greatest(0, floor(extract(epoch from (now() - v_prev))))::integer;
end;
$$;

revoke all on function public.academy_touch_stream(text, text) from public, anon, authenticated;
grant execute on function public.academy_touch_stream(text, text) to service_role;
