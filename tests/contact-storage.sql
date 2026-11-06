begin;
set local role service_role;
do $$
declare a jsonb; b jsonb; c jsonb; x jsonb;
begin
 a:=public.save_clerk_teacher_contact('CONTACT-TEST-A','測試老師','測試甲科',null,'test@example.com','test','','','TEST');
 if a->'contact'->>'email'<>'test@example.com' then raise exception 'save failed'; end if;
 b:=public.save_clerk_teacher_contact('CONTACT-TEST-B','測試老師','測試乙科',(a->'contact'->>'id')::uuid,'test@example.com','test',a->'contact'->>'revision','','TEST');
 if b->'contact'->>'id'<>a->'contact'->>'id' then raise exception 'share failed'; end if;
 c:=public.save_clerk_teacher_contact('CONTACT-TEST-C','測試老師','測試丙科',null,'test@example.com','other','','','TEST');
 if c->'contact'->>'id'=a->'contact'->>'id' then raise exception 'identity collision'; end if;
 x:=public.save_clerk_teacher_contact('CONTACT-TEST-A','測試老師','測試甲科',(a->'contact'->>'id')::uuid,'changed@example.com','test',a->'contact'->>'revision','','TEST');
 if x->>'conflict'<>'true' then raise exception 'binding conflict missed'; end if;
 x:=public.save_clerk_teacher_contact('CONTACT-TEST-A','測試老師','測試甲科',(a->'contact'->>'id')::uuid,'changed@example.com','test','stale',a->'binding'->>'revision','TEST');
 if x->>'conflict'<>'true' then raise exception 'contact conflict missed'; end if;
 if (select count(*) from public.clerk_teacher_contact_history where actor='TEST')<>3 then raise exception 'audit failed'; end if;
 if has_table_privilege('anon','public.clerk_teacher_contacts','SELECT') or has_table_privilege('authenticated','public.clerk_teacher_contacts','UPDATE') then raise exception 'public access'; end if;
 if has_function_privilege('anon','public.save_clerk_teacher_contact(text,text,text,uuid,text,text,text,text,text)','EXECUTE') then raise exception 'public rpc'; end if;
end $$;
rollback;
