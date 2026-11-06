-- Manual Gmail delivery. No tokens, passwords, queues or scheduled jobs are stored.
create table public.clerk_mail_intents (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.clerk_reminder_batches(id),
 batch_revision uuid not null, actor text not null, google_sub text not null, teacher_ids jsonb not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '10 minutes'
);
alter table public.clerk_reminder_deliveries
 add column attempt_id uuid unique, add column intent_id uuid references public.clerk_mail_intents(id),
 add column requested_by text, add column finished_at timestamptz, add column rfc_message_id text;
create table public.clerk_mail_delivery_events (
 id uuid primary key default gen_random_uuid(), delivery_id uuid not null references public.clerk_reminder_deliveries(id),
 batch_id uuid not null references public.clerk_reminder_batches(id), attempt_id uuid not null,
 status text not null check(status in ('sending','sent','failed','unknown')), actor text not null,
 provider_message_id text, error text, created_at timestamptz not null default now()
);
create index on public.clerk_mail_delivery_events(batch_id,created_at);
alter table public.clerk_mail_intents enable row level security;
alter table public.clerk_mail_delivery_events enable row level security;
revoke all on public.clerk_mail_intents,public.clerk_mail_delivery_events from public,anon,authenticated,service_role;
grant select,insert on public.clerk_mail_intents,public.clerk_mail_delivery_events to service_role;
grant insert,update on public.clerk_reminder_deliveries to service_role;

create function public.clerk_mail_snapshot_valid(m jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare dep jsonb;
begin
 if coalesce((m->>'expiresAt')::timestamptz<=now(),true) or m->>'from' is distinct from 'd90019@nycu.edu.tw' then return false; end if;
 perform 1 from public.clerk_teacher_contacts where id=(m->>'teacherId')::uuid and revision::text=m#>>'{dependencies,contactRevision}' for share;
 if not found then return false; end if;
 for dep in select value from jsonb_array_elements(m#>'{dependencies,bindings}') loop
  perform 1 from public.clerk_teacher_bindings where teacher_key=dep->>'key' and revision::text=dep->>'revision' and contact_id=(m->>'teacherId')::uuid for share;
  if not found then return false; end if;
 end loop;
 for dep in select value from jsonb_array_elements(m#>'{dependencies,reviews}') loop
  perform 1 from public.clerk_reminder_reviews where row_id=dep->>'rowId' and revision::text=dep->>'revision' and source_version=dep->>'sourceVersion' and confirmed and reviewed_at<=now() and reviewed_at+interval '7 days'>now() for share;
  if not found then return false; end if;
 end loop;
 return true;
end $$;

create function public.prepare_clerk_mail(p_batch uuid,p_revision uuid,p_actor text,p_sub text,p_teachers jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.clerk_reminder_batches; intent public.clerk_mail_intents; teacher text; m jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('clerk-reminder-batches',0));
 if coalesce(length(p_actor),0) not between 1 and 100 or coalesce(length(p_sub),0) not between 1 and 255 then return jsonb_build_object('error','帳號驗證不完整。'); end if;
 select * into b from public.clerk_reminder_batches where id=p_batch for update;
 if not found or b.revision is distinct from p_revision or b.cancelled_at is not null then return jsonb_build_object('error','批次已更新或取消。'); end if;
 if jsonb_typeof(p_teachers) is distinct from 'array' or jsonb_array_length(p_teachers) not between 1 and 100 or (select count(distinct v) from jsonb_array_elements_text(p_teachers) v)<>jsonb_array_length(p_teachers) then return jsonb_build_object('error','請先保存本批確認。'); end if;
 for teacher in select value from jsonb_array_elements_text(p_teachers) loop
  select v into m from jsonb_array_elements(b.messages) v where v->>'teacherId'=teacher;
  if m is null or not (b.confirmed ? teacher) or not public.clerk_mail_snapshot_valid(m) then return jsonb_build_object('error','信件尚未確認或資料已變更。'); end if;
  if exists(select 1 from public.clerk_reminder_deliveries where batch_id=b.id and teacher_id=teacher::uuid and status<>'failed') then return jsonb_build_object('error','部分信件已處理，請更新寄送紀錄。'); end if;
 end loop;
 insert into public.clerk_mail_intents(batch_id,batch_revision,actor,google_sub,teacher_ids) values(b.id,b.revision,p_actor,p_sub,p_teachers) returning * into intent;
 return jsonb_build_object('intentId',intent.id,'expiresAt',intent.expires_at);
end $$;

create function public.claim_clerk_mail(p_intent uuid,p_batch uuid,p_revision uuid,p_teacher uuid,p_actor text,p_sub text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare intent public.clerk_mail_intents; b public.clerk_reminder_batches; delivery public.clerk_reminder_deliveries; m jsonb; attempt uuid:=gen_random_uuid();
begin
 perform pg_advisory_xact_lock(hashtextextended('clerk-reminder-batches',0));
 select * into intent from public.clerk_mail_intents where id=p_intent;
 if not found or intent.actor is distinct from p_actor or intent.google_sub is distinct from p_sub or intent.batch_id is distinct from p_batch or intent.batch_revision is distinct from p_revision or intent.expires_at<=now() or not(intent.teacher_ids ? p_teacher::text) then return jsonb_build_object('error','寄送摘要已失效，請重新核對。'); end if;
 select * into b from public.clerk_reminder_batches where id=intent.batch_id for update;
 if b.cancelled_at is not null or b.revision is distinct from intent.batch_revision or not(b.confirmed ? p_teacher::text) then return jsonb_build_object('error','批次確認已變更。'); end if;
 select v into m from jsonb_array_elements(b.messages) v where v->>'teacherId'=p_teacher::text;
 if m is null or not public.clerk_mail_snapshot_valid(m) then return jsonb_build_object('error','信箱或核對資料已變更，已停止寄送。'); end if;
 select * into delivery from public.clerk_reminder_deliveries where batch_id=b.id and teacher_id=p_teacher for update;
 if found then
  if delivery.status='sent' then return jsonb_build_object('alreadySent',true); end if;
  if delivery.status<>'failed' then return jsonb_build_object('error','這封信正在處理或結果待查證，請先檢查寄件備份，勿重寄。'); end if;
  if delivery.intent_id=p_intent then return jsonb_build_object('error','請重新核對寄送摘要後才可再次寄送。'); end if;
  update public.clerk_reminder_deliveries set status='sending',attempt_id=attempt,intent_id=p_intent,requested_by=p_actor,finished_at=null,error=null,provider_message_id=null,sent_at=null,rfc_message_id='<clerk-'||attempt::text||'@d90019ij.github.io>' where id=delivery.id returning * into delivery;
 else
  insert into public.clerk_reminder_deliveries(batch_id,teacher_id,status,from_address,attempt_id,intent_id,requested_by,rfc_message_id) values(b.id,p_teacher,'sending','d90019@nycu.edu.tw',attempt,p_intent,p_actor,'<clerk-'||attempt::text||'@d90019ij.github.io>') returning * into delivery;
 end if;
 insert into public.clerk_mail_delivery_events(delivery_id,batch_id,attempt_id,status,actor) values(delivery.id,b.id,attempt,'sending',p_actor);
 return jsonb_build_object('attemptId',attempt,'message',m,'messageId',delivery.rfc_message_id);
end $$;

create function public.finish_clerk_mail(p_attempt uuid,p_status text,p_provider text,p_error text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare delivery public.clerk_reminder_deliveries;
begin
 if p_status not in ('sent','failed','unknown') or p_status is null or (p_status='sent' and coalesce(length(p_provider),0)=0) then return jsonb_build_object('error','寄送結果不完整。'); end if;
 select * into delivery from public.clerk_reminder_deliveries where attempt_id=p_attempt for update;
 if not found then return jsonb_build_object('error','找不到寄送處理紀錄。'); end if;
 if delivery.status<>'sending' then return jsonb_build_object('status',delivery.status); end if;
 update public.clerk_reminder_deliveries set status=p_status,finished_at=now(),provider_message_id=p_provider,sent_at=case when p_status='sent' then now() else null end,error=left(p_error,500) where id=delivery.id;
 insert into public.clerk_mail_delivery_events(delivery_id,batch_id,attempt_id,status,actor,provider_message_id,error) values(delivery.id,delivery.batch_id,p_attempt,p_status,delivery.requested_by,p_provider,left(p_error,500));
 return jsonb_build_object('status',p_status);
end $$;
revoke all on function public.clerk_mail_snapshot_valid(jsonb),public.prepare_clerk_mail(uuid,uuid,text,text,jsonb),public.claim_clerk_mail(uuid,uuid,uuid,uuid,text,text),public.finish_clerk_mail(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.clerk_mail_snapshot_valid(jsonb),public.prepare_clerk_mail(uuid,uuid,text,text,jsonb),public.claim_clerk_mail(uuid,uuid,uuid,uuid,text,text),public.finish_clerk_mail(uuid,text,text,text) to service_role;
