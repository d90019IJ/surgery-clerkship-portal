-- Run after reminder-reviews.sql. All synthetic writes are rolled back.
begin;
do $$
declare role_name text; table_name text; privilege_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    foreach table_name in array array['clerk_reminder_reviews','clerk_reminder_review_history'] loop
      foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE'] loop
        if has_table_privilege(role_name,'public.'||table_name,privilege_name) then raise exception 'Unexpected public table privilege'; end if;
      end loop;
    end loop;
    if has_function_privilege(role_name,'public.save_clerk_reminder_review(text,text,boolean,text,text)','EXECUTE') then raise exception 'Unexpected public function privilege'; end if;
  end loop;
  if exists(select 1 from pg_class where oid in ('public.clerk_reminder_reviews'::regclass,'public.clerk_reminder_review_history'::regclass) and not relrowsecurity) then raise exception 'RLS missing'; end if;
end $$;
set local role service_role;
do $$
declare test_id text:='test-rollback-'||gen_random_uuid()::text; first_save jsonb; result jsonb; history_count int;
begin
  first_save:=public.save_clerk_reminder_review(test_id,'synthetic-source',true,'','TEST-ACTOR');
  if first_save->'record'->>'confirmed'<>'true' then raise exception 'Initial save failed'; end if;
  result:=public.save_clerk_reminder_review(test_id,'synthetic-source',false,'','TEST-ACTOR');
  if result->>'conflict'<>'true' then raise exception 'Stale revision accepted'; end if;
  result:=public.save_clerk_reminder_review(test_id,'synthetic-source',false,first_save->'record'->>'revision','TEST-ACTOR');
  if result->'record'->>'confirmed'<>'false' then raise exception 'Revoke failed'; end if;
  select count(*) into history_count from public.clerk_reminder_review_history where row_id=test_id;
  if history_count<>2 then raise exception 'History mismatch'; end if;
end $$;
rollback;
