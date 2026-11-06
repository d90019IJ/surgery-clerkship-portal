-- Directory and explicit same-teacher links only. No mail delivery or scheduler.
create table public.clerk_teacher_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 1 and 80),
  hospital_code text not null default '' check(length(hospital_code)<=40),
  email text not null default '' check(length(email)<=254 and email !~ '[[:space:],;<>]'),
  revision uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  updated_by text not null
);
create table public.clerk_teacher_bindings (
  teacher_key text primary key check(length(teacher_key)<=1000),
  teacher_name text not null check(length(teacher_name) between 1 and 80),
  unit text not null check(length(unit) between 1 and 200),
  contact_id uuid not null references public.clerk_teacher_contacts(id),
  revision uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  updated_by text not null
);
create index clerk_teacher_bindings_contact on public.clerk_teacher_bindings(contact_id);
create table public.clerk_teacher_contact_history (
  id uuid primary key default gen_random_uuid(),
  teacher_key text not null,
  contact_id uuid not null references public.clerk_teacher_contacts(id),
  before_contact jsonb,
  after_contact jsonb not null,
  before_binding jsonb,
  after_binding jsonb not null,
  actor text not null,
  created_at timestamptz not null default now()
);
create index clerk_teacher_history_contact_time on public.clerk_teacher_contact_history(contact_id,created_at desc,id);
alter table public.clerk_teacher_contacts enable row level security;
alter table public.clerk_teacher_bindings enable row level security;
alter table public.clerk_teacher_contact_history enable row level security;
revoke all on public.clerk_teacher_contacts,public.clerk_teacher_bindings,public.clerk_teacher_contact_history from public,anon,authenticated,service_role;
grant select,insert,update on public.clerk_teacher_contacts,public.clerk_teacher_bindings to service_role;
grant select,insert on public.clerk_teacher_contact_history to service_role;

create function public.save_clerk_teacher_contact(p_key text,p_name text,p_unit text,p_contact_id uuid,p_email text,p_code text,p_revision text,p_binding_revision text,p_actor text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare previous public.clerk_teacher_contacts; saved public.clerk_teacher_contacts;
  old_binding public.clerk_teacher_bindings; saved_binding public.clerk_teacher_bindings;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('teacher-binding:'||p_key,0));
  select * into old_binding from public.clerk_teacher_bindings where teacher_key=p_key for update;
  if coalesce(old_binding.revision::text,'')<>coalesce(p_binding_revision,'') then return jsonb_build_object('conflict',true); end if;
  if p_contact_id is not null then
    select * into previous from public.clerk_teacher_contacts where id=p_contact_id for update;
    if previous.id is null or previous.name<>p_name then return jsonb_build_object('invalid',true); end if;
    if previous.revision::text<>coalesce(p_revision,'') then return jsonb_build_object('conflict',true); end if;
    if previous.email=p_email and previous.hospital_code=p_code then saved:=previous;
    else
      update public.clerk_teacher_contacts set email=p_email,hospital_code=p_code,revision=gen_random_uuid(),updated_at=now(),updated_by=p_actor where id=p_contact_id returning * into saved;
    end if;
  else
    if coalesce(p_revision,'')<>'' then return jsonb_build_object('conflict',true); end if;
    insert into public.clerk_teacher_contacts(name,email,hospital_code,updated_by) values(p_name,p_email,p_code,p_actor) returning * into saved;
  end if;
  insert into public.clerk_teacher_bindings(teacher_key,teacher_name,unit,contact_id,updated_by)
    values(p_key,p_name,p_unit,saved.id,p_actor)
  on conflict(teacher_key) do update set contact_id=excluded.contact_id,revision=gen_random_uuid(),updated_at=now(),updated_by=excluded.updated_by
  returning * into saved_binding;
  insert into public.clerk_teacher_contact_history(teacher_key,contact_id,before_contact,after_contact,before_binding,after_binding,actor)
    values(p_key,saved.id,case when previous.id is null then null else to_jsonb(previous) end,to_jsonb(saved),case when old_binding.teacher_key is null then null else to_jsonb(old_binding) end,to_jsonb(saved_binding),p_actor);
  return jsonb_build_object('contact',to_jsonb(saved),'binding',to_jsonb(saved_binding));
end;
$$;
revoke all on function public.save_clerk_teacher_contact(text,text,text,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.save_clerk_teacher_contact(text,text,text,uuid,text,text,text,text,text) to service_role;
