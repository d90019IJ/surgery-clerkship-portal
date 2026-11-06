-- Synthetic data only; the entire transaction is rolled back.
begin;
do $$
declare r text; t text; p text;
begin
 foreach r in array array['anon','authenticated'] loop
  foreach t in array array['clerk_reminder_batches','clerk_reminder_batch_history','clerk_reminder_deliveries'] loop
   foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
    if has_table_privilege(r,'public.'||t,p) then raise exception 'Unexpected public access'; end if;
   end loop;
  end loop;
  if has_function_privilege(r,'public.save_clerk_reminder_batch(text,uuid,uuid,jsonb,jsonb,text)','EXECUTE') then raise exception 'Unexpected RPC access'; end if;
 end loop;
 if has_table_privilege('service_role','public.clerk_reminder_batch_history','UPDATE') then raise exception 'Unexpected delivery/audit write permission'; end if;
end $$;
set local role service_role;
do $$
declare c public.clerk_teacher_contacts; binding public.clerk_teacher_bindings; review public.clerk_reminder_reviews; b public.clerk_reminder_batches;
 req uuid:=gen_random_uuid(); rid text:='batch-test-'||gen_random_uuid(); m jsonb; result jsonb; replay jsonb; old_revision uuid; immutable boolean:=false;
begin
 insert into public.clerk_teacher_contacts(name,email,secondary_email,updated_by) values('合成測試老師','one@example.com','two@example.com','SYNTHETIC_TEST') returning * into c;
 insert into public.clerk_teacher_bindings(teacher_key,teacher_name,unit,contact_id,updated_by) values(rid,c.name,'測試科',c.id,'SYNTHETIC_TEST') returning * into binding;
 insert into public.clerk_reminder_reviews(row_id,source_version,confirmed,reviewed_by) values(rid,'synthetic-source',true,'SYNTHETIC_TEST') returning * into review;
 m:=jsonb_build_object('teacherId',c.id,'teacherName',c.name,'to',jsonb_build_array(c.email,c.secondary_email),'from','sender@example.com','html','<p>合成測試</p>','subject','測試', 'version',repeat('a',64),'expiresAt',now()+interval '7 days',
 'dependencies',jsonb_build_object('contactRevision',c.revision,'bindings',jsonb_build_array(jsonb_build_object('key',binding.teacher_key,'revision',binding.revision)), 'reviews',jsonb_build_array(jsonb_build_object('rowId',review.row_id,'revision',review.revision,'sourceVersion',review.source_version,'reviewedAt',review.reviewed_at))));
 result:=public.save_clerk_reminder_batch('create',req,null,jsonb_build_array(m),'[]','SYNTHETIC_TEST');
 if result ? 'error' then raise exception 'Create failed: %',result; end if;
 select * into b from public.clerk_reminder_batches where id=(result->>'id')::uuid;
 if b.messages<>jsonb_build_array(m) or b.confirmed<>'[]' then raise exception 'Snapshot mismatch'; end if;
 replay:=public.save_clerk_reminder_batch('create',req,null,'[]','[]','SYNTHETIC_TEST');
 if replay->>'id'<>result->>'id' or not (replay->>'replayed')::boolean then raise exception 'Replay failed'; end if;
 result:=public.save_clerk_reminder_batch('create',gen_random_uuid(),null,jsonb_build_array(m),'[]','SYNTHETIC_TEST');
 if not result ? 'error' then raise exception 'Duplicate allowed'; end if;
 old_revision:=b.revision;
 result:=public.save_clerk_reminder_batch('confirm',b.id,b.revision,'[]',jsonb_build_array(c.id),'SYNTHETIC_TEST');
 if result ? 'error' then raise exception 'Confirm failed %',result; end if;
 result:=public.save_clerk_reminder_batch('confirm',b.id,old_revision,'[]','[]','SYNTHETIC_TEST');
 if not result ? 'error' then raise exception 'Stale revision accepted'; end if;
 select * into b from public.clerk_reminder_batches where id=b.id;
 update public.clerk_teacher_contacts set revision=gen_random_uuid() where id=c.id;
 result:=public.save_clerk_reminder_batch('confirm',b.id,b.revision,'[]',jsonb_build_array(c.id),'SYNTHETIC_TEST');
 if not result ? 'error' then raise exception 'Changed contact accepted'; end if;
 update public.clerk_teacher_contacts set revision=c.revision where id=c.id;
 update public.clerk_reminder_reviews set reviewed_at=now()-interval '7 days' where row_id=rid;
 result:=public.save_clerk_reminder_batch('confirm',b.id,b.revision,'[]',jsonb_build_array(c.id),'SYNTHETIC_TEST');
 if not result ? 'error' then raise exception 'Expired review accepted'; end if;
 update public.clerk_reminder_reviews set reviewed_at=review.reviewed_at where row_id=rid;
 begin update public.clerk_reminder_batches set messages=jsonb_build_array(jsonb_build_object('fake',true)) where id=b.id;
 exception when raise_exception then immutable:=true; end;
 if not immutable then raise exception 'Snapshot could change'; end if;
 result:=public.save_clerk_reminder_batch('cancel',b.id,b.revision,'[]','[]','SYNTHETIC_TEST');
 if result ? 'error' then raise exception 'Cancel failed %',result; end if;
 if (select count(*) from public.clerk_reminder_batch_history where batch_id=b.id)<>3 then raise exception 'Audit incomplete'; end if;
 result:=public.save_clerk_reminder_batch('create',gen_random_uuid(),null,jsonb_build_array(m),'[]','SYNTHETIC_TEST');
 if result ? 'error' then raise exception 'Replacement failed %',result; end if;
 if exists(select 1 from public.clerk_reminder_deliveries where batch_id=b.id) then raise exception 'Unexpected delivery'; end if;
end $$;
rollback;
