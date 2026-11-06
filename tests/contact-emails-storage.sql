begin;
set local role service_role;
do $$
declare a jsonb; b jsonb; c jsonb;
begin
 a:=public.save_clerk_teacher_contact_emails('DUAL-TEST','測試老師','測試科',null,'one@example.com','','','','TEST-DUAL','two@example.com');
 if a->'contact'->>'secondary_email'<>'two@example.com' then raise exception 'secondary missing'; end if;
 b:=public.save_clerk_teacher_contact('DUAL-TEST','測試老師','測試科',(a->'contact'->>'id')::uuid,'new@example.com','',a->'contact'->>'revision',a->'binding'->>'revision','TEST-DUAL');
 if b->'contact'->>'secondary_email'<>'two@example.com' then raise exception 'legacy lost secondary'; end if;
 c:=public.save_clerk_teacher_contact_emails('DUAL-TEST','測試老師','測試科',(b->'contact'->>'id')::uuid,'new@example.com','',b->'contact'->>'revision',b->'binding'->>'revision','TEST-DUAL','');
 if c->'contact'->>'secondary_email'<>'' then raise exception 'clear failed'; end if;
 if (select count(*) from public.clerk_teacher_contact_history where actor='TEST-DUAL')<>3 then raise exception 'audit failed'; end if;
 if has_function_privilege('anon','public.save_clerk_teacher_contact_emails(text,text,text,uuid,text,text,text,text,text,text)','EXECUTE') then raise exception 'public rpc'; end if;
end $$;
rollback;
