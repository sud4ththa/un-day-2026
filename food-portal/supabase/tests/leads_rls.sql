-- Contact records: one lead and one food coordinator per stall.
-- Neither can sign in or edit the plan.

insert into public.stall_contacts (email, role, stall_id, display_name, phone) values
  ('lead.maldives.a@example.com', 'lead', 'maldives', 'Maldives Lead', '0773000001'),
  ('coord.maldives@example.com', 'food_coordinator', 'maldives', 'Maldives Coordinator', '0773000002'),
  ('coord.japan@example.com', 'food_coordinator', 'japan', 'Japan Coordinator', '');

do $$
declare
  n int;
  stored_phone text;
begin
  select count(*) into n from public.stall_contacts where stall_id = 'maldives' and role = 'lead';
  if n <> 1 then
    raise exception 'FAIL: maldives lead count %', n;
  end if;
  select count(*) into n from public.stall_contacts where stall_id = 'maldives' and role = 'food_coordinator';
  if n <> 1 then
    raise exception 'FAIL: maldives coordinator count %', n;
  end if;
  select c.phone into stored_phone from public.stall_contacts c where c.email = 'lead.maldives.a@example.com';
  if stored_phone <> '0773000001' then
    raise exception 'FAIL: phone was %', stored_phone;
  end if;
  begin
    insert into public.stall_contacts (email, role, stall_id, display_name)
    values ('lead.maldives.b@example.com', 'lead', 'maldives', 'Second');
    raise exception 'FAIL: a stall accepted two leads';
  exception
    when unique_violation then
      raise notice 'OK: a stall cannot have two leads';
  end;
  if exists (select 1 from public.allowlist where email = 'coord.japan@example.com') then
    raise exception 'FAIL: a food coordinator is on the sign-in list';
  end if;
  raise notice 'OK: one lead and one food coordinator, stored as contacts';
end $$;

set role supabase_auth_admin;
do $$
declare
  result jsonb;
begin
  result := public.hook_before_user_created('{"user":{"email":"coord.japan@example.com"}}'::jsonb);
  if coalesce(result->'error'->>'http_code', '') <> '403' then
    raise exception 'FAIL: food coordinator sign-in was allowed (%)', result;
  end if;
  raise notice 'OK: a food coordinator cannot sign in';
end $$;
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","email":"coord.japan@example.com","role":"authenticated"}',
  false
);
set role authenticated;

do $$
declare
  n int;
begin
  update public.stalls set dropoff_instructions = 'Nope' where id = 'japan';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: food coordinator edited a stall';
  end if;
  select count(*) into n from public.stall_contacts;
  if n <> 0 then
    raise exception 'FAIL: food coordinator can read the contact list';
  end if;
  raise notice 'OK: a food coordinator cannot open the plan';
end $$;

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","email":"admin@example.com","role":"authenticated"}',
  false
);
set role authenticated;

do $$
declare
  n int;
begin
  update public.stalls set assigned_year_group = 'Year 11' where id = 'japan';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: admin could not set the year group';
  end if;
  delete from public.stall_contacts where email = 'coord.maldives@example.com';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: admin could not remove a coordinator';
  end if;
  if not exists (select 1 from public.stall_contacts where email = 'lead.maldives.a@example.com') then
    raise exception 'FAIL: removing a coordinator removed the lead';
  end if;
  begin
    update public.stalls set assigned_year_group = 'Playgroup' where id = 'japan';
    raise exception 'FAIL: Playgroup was accepted';
  exception
    when check_violation then
      null;
  end;
  raise notice 'OK: removing a food coordinator leaves the lead';
  raise notice 'OK: year group must be one of the dropdown values';
  raise notice 'ALL LEAD CHECKS PASSED';
end $$;

reset role;
