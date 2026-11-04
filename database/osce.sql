-- Only the staff-authorized Edge Function accesses these tables.
create table public.clerk_osce_scores (
  id text primary key,
  student_id text not null,
  batch text not null,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  suture numeric check (suture >= 0 and suture <= 100),
  dressing numeric check (dressing >= 0 and dressing <= 100),
  note text not null default '' check (length(note) <= 500),
  revision uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  updated_by text not null
);
create table public.clerk_osce_history (
  id uuid primary key default gen_random_uuid(),
  record_id text not null references public.clerk_osce_scores(id),
  before_value jsonb,
  after_value jsonb not null,
  actor text not null,
  created_at timestamptz not null default now()
);
create index clerk_osce_history_record_time on public.clerk_osce_history(record_id, created_at desc);
alter table public.clerk_osce_scores enable row level security;
alter table public.clerk_osce_history enable row level security;
revoke all on public.clerk_osce_scores, public.clerk_osce_history from public, anon, authenticated;
grant select, insert, update on public.clerk_osce_scores to service_role;
grant select, insert on public.clerk_osce_history to service_role;

create function public.save_clerk_osce(p_id text, p_student_id text, p_batch text,
  p_start date, p_end date, p_suture numeric, p_dressing numeric, p_note text,
  p_revision text, p_actor text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare previous public.clerk_osce_scores; saved public.clerk_osce_scores;
begin
  -- Serialize initial inserts too; stale browser tabs cannot overwrite newer data.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id, 0));
  select * into previous from public.clerk_osce_scores where id = p_id for update;
  if coalesce(previous.revision::text, '') <> coalesce(p_revision, '') then
    return jsonb_build_object('conflict', true);
  end if;
  insert into public.clerk_osce_scores(id, student_id, batch, period_start, period_end, suture, dressing, note, updated_by)
    values(p_id, p_student_id, p_batch, p_start, p_end, p_suture, p_dressing, p_note, p_actor)
  on conflict(id) do update set suture=excluded.suture, dressing=excluded.dressing,
    note=excluded.note, revision=gen_random_uuid(), updated_at=now(), updated_by=excluded.updated_by
  returning * into saved;
  insert into public.clerk_osce_history(record_id, before_value, after_value, actor)
    values(p_id, case when previous.id is null then null else to_jsonb(previous) end, to_jsonb(saved), p_actor);
  return jsonb_build_object('record', to_jsonb(saved));
end;
$$;
revoke all on function public.save_clerk_osce(text,text,text,date,date,numeric,numeric,text,text,text) from public, anon, authenticated;
grant execute on function public.save_clerk_osce(text,text,text,date,date,numeric,numeric,text,text,text) to service_role;
