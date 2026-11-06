-- No email provider is invoked. Synthetic records are rolled back, including sent outcomes.
begin;
do $$
declare r text; t text; p text;
begin
 foreach r in array array['anon','authenticated'] loop
  foreach t in array array['clerk_mail_intents','clerk_mail_delivery_events','clerk_reminder_deliveries'] loop
   foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
    if has_table_privilege(r,'public.'||t,p) then raise exception 'Unexpected public access'; end if;
   end loop;
  end loop;
  if has_function_privilege(r,'public.claim_clerk_mail(uuid,uuid,uuid,uuid,text,text)','EXECUTE') or has_function_privilege(r,'public.prepare_clerk_mail(uuid,uuid,text,text,jsonb)','EXECUTE') or has_function_privilege(r,'public.finish_clerk_mail(uuid,text,text,text)','EXECUTE') then raise exception 'Public mail RPC exposed'; end if;
 end loop;
 if has_table_privilege('service_role','public.clerk_mail_delivery_events','UPDATE') or has_table_privilege('service_role','public.clerk_mail_delivery_events','DELETE') then raise exception 'Audit mutable'; end if;
end $$;
set local role service_role;
do $$
declare c public.clerk_teacher_contacts; binding public.clerk_teacher_bindings; review public.clerk_reminder_reviews; b public.clerk_reminder_batches;
 rid text:='mail-test-'||gen_random_uuid(); m jsonb; result jsonb; intent uuid; next_intent uuid; attempt uuid;
begin
 insert into public.clerk_teacher_contacts(name,email,secondary_email,updated_by) values('合成測試老師','one@example.com','two@example.com','SYNTHETIC_TEST') returning * into c;
 insert into public.clerk_teacher_bindings(teacher_key,teacher_name,unit,contact_id,updated_by) values(rid,c.name,'測試科',c.id,'SYNTHETIC_TEST') returning * into binding;
 insert into public.clerk_reminder_reviews(row_id,source_version,confirmed,reviewed_by) values(rid,'synthetic-source',true,'SYNTHETIC_TEST') returning * into review;
 m:=jsonb_build_object('teacherId',c.id,'teacherName',c.name,'to',jsonb_build_array(c.email,c.secondary_email),'from','d90019@nycu.edu.tw','html','<p>合成測試</p>','subject','測試','version',repeat('a',64),'expiresAt',now()+interval '7 days',
 'dependencies',jsonb_build_object('contactRevision',c.revision,'bindings',jsonb_build_array(jsonb_build_object('key',binding.teacher_key,'revision',binding.revision)),'reviews',jsonb_build_array(jsonb_build_object('rowId',review.row_id,'revision',review.revision,'sourceVersion',review.source_version,'reviewedAt',review.reviewed_at))));
 result:=public.save_clerk_reminder_batch('create',gen_random_uuid(),null,jsonb_build_array(m),'[]','SYNTHETIC_TEST');
 select * into b from public.clerk_reminder_batches where id=(result->>'id')::uuid;
 result:=public.prepare_clerk_mail(b.id,b.revision,'SYNTHETIC_TEST','google-test-sub',jsonb_build_array(c.id));
 if not result ? 'error' then raise exception 'Unconfirmed batch could prepare'; end if;
 result:=public.save_clerk_reminder_batch('confirm',b.id,b.revision,'[]',jsonb_build_array(c.id),'SYNTHETIC_TEST');
 select * into b from public.clerk_reminder_batches where id=b.id;
 result:=public.prepare_clerk_mail(b.id,b.revision,'SYNTHETIC_TEST','google-test-sub',jsonb_build_array(c.id));
 if result ? 'error' then raise exception 'Prepare failed: %',result; end if;
 intent:=(result->>'intentId')::uuid;
 if exists(select 1 from public.clerk_reminder_deliveries where batch_id=b.id) then raise exception 'Prepare created a delivery'; end if;
 result:=public.claim_clerk_mail(intent,b.id,b.revision,c.id,'OTHER_STAFF','google-test-sub');
 if not result ? 'error' then raise exception 'Other actor accepted'; end if;
 result:=public.claim_clerk_mail(intent,b.id,b.revision,c.id,'SYNTHETIC_TEST','OTHER_GOOGLE_SUB');
 if not result ? 'error' then raise exception 'Other Google account accepted'; end if;
 result:=public.claim_clerk_mail(intent,gen_random_uuid(),b.revision,c.id,'SYNTHETIC_TEST','google-test-sub');
 if not result ? 'error' then raise exception 'Wrong batch accepted'; end if;
 update public.clerk_teacher_contacts set revision=gen_random_uuid() where id=c.id;
 result:=public.claim_clerk_mail(intent,b.id,b.revision,c.id,'SYNTHETIC_TEST','google-test-sub');
 if not result ? 'error' then raise exception 'Changed contact accepted'; end if;
 update public.clerk_teacher_contacts set revision=c.revision where id=c.id;
 update public.clerk_reminder_reviews set confirmed=false where row_id=rid;
 result:=public.claim_clerk_mail(intent,b.id,b.revision,c.id,'SYNTHETIC_TEST','google-test-sub');
 if not result ? 'error' then raise exception 'Revoked review accepted'; end if;
 update public.clerk_reminder_reviews set confirmed=true where row_id=rid;
 result:=public.claim_clerk_mail(intent,b.id,b.revision,c.id,'SYNTHETIC_TEST','google-test-sub');
 if result ? 'error' then raise exception 'Claim failed: %',result; end if;
 attempt:=(result->>'attemptId')::uuid;
 if result->'message'<>m then raise exception 'Snapshot changed'; end if;
 result:=public.claim_clerk_mail(intent,b.id,b.revision,c.id,'SYNTHETIC_TEST','google-test-sub');
 if not result ? 'error' then raise exception 'Duplicate in-flight claim accepted'; end if;
 result:=public.finish_clerk_mail(attempt,'sent',null,null);
 if not result ? 'error' then raise exception 'Sent without provider ID accepted'; end if;
 result:=public.finish_clerk_mail(attempt,'failed',null,'Synthetic rejection');
 result:=public.claim_clerk_mail(intent,b.id,b.revision,c.id,'SYNTHETIC_TEST','google-test-sub');
 if not result ? 'error' then raise exception 'Same intent retried'; end if;
 result:=public.prepare_clerk_mail(b.id,b.revision,'SYNTHETIC_TEST','google-test-sub',jsonb_build_array(c.id));
 next_intent:=(result->>'intentId')::uuid;
 result:=public.claim_clerk_mail(next_intent,b.id,b.revision,c.id,'SYNTHETIC_TEST','google-test-sub');
 if result ? 'error' then raise exception 'Explicit retry failed: %',result; end if;
 attempt:=(result->>'attemptId')::uuid;
 result:=public.finish_clerk_mail(attempt,'unknown',null,'Synthetic timeout');
 result:=public.claim_clerk_mail(next_intent,b.id,b.revision,c.id,'SYNTHETIC_TEST','google-test-sub');
 if not result ? 'error' then raise exception 'Unknown result retried'; end if;
 result:=public.finish_clerk_mail(attempt,'sent','fake-provider-id',null);
 if result->>'status'<>'unknown' then raise exception 'Late finish overwrote terminal state'; end if;
 if (select count(*) from public.clerk_mail_delivery_events where batch_id=b.id)<>4 then raise exception 'Attempt history incomplete'; end if;
 -- A separate synthetic batch verifies sent replay protection, without calling Gmail.
 insert into public.clerk_reminder_batches(request_id,messages,confirmed,created_by) values(gen_random_uuid(),jsonb_build_array(m),jsonb_build_array(c.id),'SYNTHETIC_TEST') returning * into b;
 result:=public.prepare_clerk_mail(b.id,b.revision,'SYNTHETIC_TEST','google-test-sub',jsonb_build_array(c.id));
 intent:=(result->>'intentId')::uuid;
 result:=public.claim_clerk_mail(intent,b.id,b.revision,c.id,'SYNTHETIC_TEST','google-test-sub');attempt:=(result->>'attemptId')::uuid;
 result:=public.finish_clerk_mail(attempt,'sent','synthetic-provider-id',null);
 if result->>'status'<>'sent' then raise exception 'Synthetic success not recorded'; end if;
 result:=public.claim_clerk_mail(intent,b.id,b.revision,c.id,'SYNTHETIC_TEST','google-test-sub');
 if result->>'alreadySent'<>'true' then raise exception 'Sent replay not blocked'; end if;
end $$;
rollback;
