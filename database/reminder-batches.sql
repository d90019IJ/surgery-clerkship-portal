-- Confirmation stores an immutable preview. This migration does not send mail.
create table public.clerk_reminder_batches (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 messages jsonb not null check(jsonb_typeof(messages)='array' and jsonb_array_length(messages) between 1 and 100),
 confirmed jsonb not null default '[]' check(jsonb_typeof(confirmed)='array'),
 revision uuid not null default gen_random_uuid(), created_at timestamptz not null default now(), created_by text not null,
 confirmed_at timestamptz, confirmed_by text, cancelled_at timestamptz, cancelled_by text
);
create table public.clerk_reminder_batch_history (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.clerk_reminder_batches(id),
 event text not null check(event in ('created','confirmation_saved','cancelled')), confirmed jsonb not null,
 actor text not null, created_at timestamptz not null default now()
);
create index on public.clerk_reminder_batch_history(batch_id,created_at);
-- Reserved for actual provider results. No client API can insert or change these records.
create table public.clerk_reminder_deliveries (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.clerk_reminder_batches(id), teacher_id uuid not null,
 status text not null check(status in ('sending','sent','failed','unknown')),
 from_address text not null, provider_message_id text, sent_at timestamptz, error text,
 created_at timestamptz not null default now(), unique(batch_id,teacher_id),
 check(status<>'sent' or (sent_at is not null and provider_message_id is not null and length(provider_message_id)>0))
);
alter table public.clerk_reminder_batches enable row level security;
alter table public.clerk_reminder_batch_history enable row level security;
alter table public.clerk_reminder_deliveries enable row level security;
revoke all on public.clerk_reminder_batches,public.clerk_reminder_batch_history,public.clerk_reminder_deliveries from public,anon,authenticated,service_role;
grant select,insert,update on public.clerk_reminder_batches to service_role;
grant select,insert on public.clerk_reminder_batch_history to service_role;
grant select on public.clerk_reminder_deliveries to service_role;

create function public.save_clerk_reminder_batch(p_operation text,p_id uuid,p_revision uuid,p_messages jsonb,p_confirmed jsonb,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.clerk_reminder_batches; m jsonb; d jsonb; previous jsonb; check_messages jsonb; sent public.clerk_reminder_deliveries; event_name text;
begin
 perform pg_advisory_xact_lock(hashtextextended('clerk-reminder-batches',0));
 if p_actor is null or length(p_actor)=0 or length(p_actor)>100 then return jsonb_build_object('error','操作人資料不完整。'); end if;
 if p_operation='create' then
   select * into b from public.clerk_reminder_batches where request_id=p_id;
   if found then return jsonb_build_object('id',b.id,'replayed',true); end if;
   if jsonb_typeof(p_messages) is distinct from 'array' or jsonb_array_length(p_messages) not between 1 and 100 then return jsonb_build_object('error','批次名單不完整。'); end if;
   if (select count(distinct v->>'teacherId') from jsonb_array_elements(p_messages) v)<>jsonb_array_length(p_messages) then return jsonb_build_object('error','同一位老師不可重複列入。'); end if;
   check_messages:=p_messages;
 elsif p_operation in ('confirm','cancel') then
   select * into b from public.clerk_reminder_batches where id=p_id for update;
   if not found or b.revision is distinct from p_revision or b.cancelled_at is not null then return jsonb_build_object('error','批次已更新或取消，請重新載入。'); end if;
   if exists(select 1 from public.clerk_reminder_deliveries where batch_id=b.id) then return jsonb_build_object('error','批次已有寄送紀錄，不能變更。'); end if;
   if p_operation='confirm' then
     if jsonb_typeof(p_confirmed) is distinct from 'array' then return jsonb_build_object('error','確認內容不完整。'); end if;
     if exists(select 1 from jsonb_array_elements_text(p_confirmed) v where not exists(select 1 from jsonb_array_elements(b.messages) candidate_message where candidate_message->>'teacherId'=v)) then return jsonb_build_object('error','確認名單不屬於此批次。'); end if;
     select coalesce(jsonb_agg(v),'[]') into check_messages from jsonb_array_elements(b.messages) v where p_confirmed ? (v->>'teacherId');
   else check_messages:='[]'; end if;
 else return jsonb_build_object('error','不支援的批次操作。'); end if;
 for m in select value from jsonb_array_elements(check_messages) loop
   if coalesce((m->>'expiresAt')::timestamptz<=now(),true) or coalesce(m->>'version','') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error','核對已過期，請重新核對。'); end if;
   perform 1 from public.clerk_teacher_contacts where id=(m->>'teacherId')::uuid and revision::text=m#>>'{dependencies,contactRevision}' for share;
   if not found then return jsonb_build_object('error','老師信箱已更新，請重新核對。'); end if;
   for d in select value from jsonb_array_elements(m#>'{dependencies,bindings}') loop
     perform 1 from public.clerk_teacher_bindings where teacher_key=d->>'key' and revision::text=d->>'revision' and contact_id=(m->>'teacherId')::uuid for share;
     if not found then return jsonb_build_object('error','老師通訊錄對應已更新。'); end if;
   end loop;
   for d in select value from jsonb_array_elements(m#>'{dependencies,reviews}') loop
     perform 1 from public.clerk_reminder_reviews where row_id=d->>'rowId' and revision::text=d->>'revision' and source_version=d->>'sourceVersion' and confirmed and reviewed_at<=now() and reviewed_at+interval '7 days'>now() for share;
     if not found then return jsonb_build_object('error','仍未評分的核對已變更或過期。'); end if;
     if p_operation='create' then
       for previous in select jsonb_build_object('id',x.id,'message',v) from public.clerk_reminder_batches x cross join lateral jsonb_array_elements(x.messages) v where x.cancelled_at is null and exists(select 1 from jsonb_array_elements(v#>'{dependencies,reviews}') r where r->>'rowId'=d->>'rowId') loop
         select * into sent from public.clerk_reminder_deliveries where batch_id=(previous->>'id')::uuid and teacher_id=(previous#>>'{message,teacherId}')::uuid;
         if not found or sent.status<>'sent' then return jsonb_build_object('error','已有未結案批次，請先查看或取消該批。'); end if;
         if sent.sent_at+interval '7 days'>now() or (d->>'reviewedAt')::timestamptz<=sent.sent_at then return jsonb_build_object('error','續寄須間隔一週並重新核對。'); end if;
       end loop;
     end if;
   end loop;
 end loop;
 if p_operation='create' then
   insert into public.clerk_reminder_batches(request_id,messages,created_by) values(p_id,p_messages,p_actor) returning * into b;
   event_name:='created';
 elsif p_operation='confirm' then
   update public.clerk_reminder_batches set confirmed=p_confirmed,confirmed_at=now(),confirmed_by=p_actor,revision=gen_random_uuid() where id=b.id returning * into b;
   event_name:='confirmation_saved';
 else
   update public.clerk_reminder_batches set cancelled_at=now(),cancelled_by=p_actor,revision=gen_random_uuid() where id=b.id returning * into b;
   event_name:='cancelled';
 end if;
 insert into public.clerk_reminder_batch_history(batch_id,event,confirmed,actor) values(b.id,event_name,b.confirmed,p_actor);
 return jsonb_build_object('id',b.id,'revision',b.revision);
end $$;
revoke all on function public.save_clerk_reminder_batch(text,uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_clerk_reminder_batch(text,uuid,uuid,jsonb,jsonb,text) to service_role;

create function public.guard_clerk_reminder_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 if new.messages is distinct from old.messages or new.request_id is distinct from old.request_id or new.id is distinct from old.id or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then raise exception 'Batch snapshot is immutable'; end if;
 return new;
end $$;
revoke all on function public.guard_clerk_reminder_snapshot() from public,anon,authenticated;
create trigger clerk_reminder_snapshot_immutable before update on public.clerk_reminder_batches for each row execute function public.guard_clerk_reminder_snapshot();
