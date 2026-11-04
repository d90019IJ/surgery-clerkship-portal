-- Apply after osce.sql. Existing scores remain intact; completion starts unknown.
alter table public.clerk_osce_scores add column passport_completion numeric
  check (passport_completion >= 0 and passport_completion <= 100);

-- Keep save_clerk_osce for already-open clients: it never changes passport_completion.
create function public.save_clerk_assessment(p_id text, p_student_id text, p_batch text,
  p_start date, p_end date, p_suture numeric, p_dressing numeric, p_note text,
  p_revision text, p_actor text, p_passport_completion numeric) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare previous public.clerk_osce_scores; saved public.clerk_osce_scores;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id, 0));
  select * into previous from public.clerk_osce_scores where id = p_id for update;
  if coalesce(previous.revision::text, '') <> coalesce(p_revision, '') then
    return jsonb_build_object('conflict', true);
  end if;
  insert into public.clerk_osce_scores(id, student_id, batch, period_start, period_end,
    suture, dressing, note, updated_by, passport_completion)
    values(p_id, p_student_id, p_batch, p_start, p_end,
      p_suture, p_dressing, p_note, p_actor, p_passport_completion)
  on conflict(id) do update set suture=excluded.suture, dressing=excluded.dressing,
    note=excluded.note, passport_completion=excluded.passport_completion,
    revision=gen_random_uuid(), updated_at=now(), updated_by=excluded.updated_by
  returning * into saved;
  insert into public.clerk_osce_history(record_id, before_value, after_value, actor)
    values(p_id, case when previous.id is null then null else to_jsonb(previous) end, to_jsonb(saved), p_actor);
  return jsonb_build_object('record', to_jsonb(saved));
end;
$$;
revoke all on function public.save_clerk_assessment(text,text,text,date,date,numeric,numeric,text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.save_clerk_assessment(text,text,text,date,date,numeric,numeric,text,text,text,numeric) to service_role;
