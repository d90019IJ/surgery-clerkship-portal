-- Confirmation only. No mail queue, email service, trigger or scheduled job is created.
create table public.clerk_reminder_reviews (
  row_id text primary key check (length(row_id) between 1 and 2000),
  source_version text not null check (length(source_version) between 1 and 8000),
  confirmed boolean not null,
  reviewed_at timestamptz not null default now(),
  reviewed_by text not null check (length(reviewed_by) between 1 and 80),
  revision uuid not null default gen_random_uuid()
);
create table public.clerk_reminder_review_history (
  id uuid primary key default gen_random_uuid(),
  row_id text not null references public.clerk_reminder_reviews(row_id),
  before_value jsonb,
  after_value jsonb not null,
  actor text not null,
  created_at timestamptz not null default now()
);
create index clerk_reminder_history_row_time on public.clerk_reminder_review_history(row_id,created_at desc,id);
alter table public.clerk_reminder_reviews enable row level security;
alter table public.clerk_reminder_review_history enable row level security;
revoke all on public.clerk_reminder_reviews,public.clerk_reminder_review_history from public,anon,authenticated,service_role;
grant select,insert,update on public.clerk_reminder_reviews to service_role;
grant select,insert on public.clerk_reminder_review_history to service_role;

create function public.save_clerk_reminder_review(p_row_id text,p_source_version text,p_confirmed boolean,p_revision text,p_actor text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare previous public.clerk_reminder_reviews; saved public.clerk_reminder_reviews;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reminder:'||p_row_id,0));
  select * into previous from public.clerk_reminder_reviews where row_id=p_row_id for update;
  if coalesce(previous.revision::text,'')<>coalesce(p_revision,'') then
    return jsonb_build_object('conflict',true);
  end if;
  insert into public.clerk_reminder_reviews(row_id,source_version,confirmed,reviewed_by)
  values(p_row_id,p_source_version,p_confirmed,p_actor)
  on conflict(row_id) do update set source_version=excluded.source_version,confirmed=excluded.confirmed,
    reviewed_at=now(),reviewed_by=excluded.reviewed_by,revision=gen_random_uuid()
  returning * into saved;
  insert into public.clerk_reminder_review_history(row_id,before_value,after_value,actor)
  values(p_row_id,case when previous.row_id is null then null else to_jsonb(previous) end,to_jsonb(saved),p_actor);
  return jsonb_build_object('record',to_jsonb(saved));
end;
$$;
revoke all on function public.save_clerk_reminder_review(text,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.save_clerk_reminder_review(text,text,boolean,text,text) to service_role;
