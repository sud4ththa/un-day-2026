-- Assigned year groups and more than one lead on a stall.

reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","email":"admin@example.com","role":"authenticated"}',
  false
);
set role authenticated;

update public.stalls set assigned_year_group = 'Year 11' where id = 'japan';

insert into public.allowlist (email, role, stall_id, display_name, phone) values
  ('lead.maldives.a@example.com', 'lead', 'maldives', 'Maldives A', '0773000001'),
  ('lead.maldives.b@example.com', 'lead', 'maldives', 'Maldives B', '');

do $$
declare
  n int;
  stored_phone text;
begin
  select count(*) into n from public.allowlist where stall_id = 'maldives' and role = 'lead';
  if n <> 2 then
    raise exception 'FAIL: a stall should allow two leads (% )', n;
  end if;
  select a.phone into stored_phone from public.allowlist a where a.email = 'lead.maldives.a@example.com';
  if stored_phone is distinct from '0773000001' then
    raise exception 'FAIL: lead phone was not stored (%)', stored_phone;
  end if;
  raise notice 'OK: an admin can add two leads to one stall, with an optional phone';
end $$;

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"lead.japan@example.com","role":"authenticated"}',
  false
);
set role authenticated;

do $$
declare
  n int;
  year_group text;
begin
  update public.stalls set assigned_year_group = 'Nursery' where id = 'japan';
  select assigned_year_group into year_group from public.stalls where id = 'japan';
  if year_group is distinct from 'Year 11' then
    raise exception 'FAIL: a lead changed the assigned year group (%)', year_group;
  end if;

  update public.allowlist set phone = '000' where email = 'lead.maldives.a@example.com';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: a lead edited the allowlist';
  end if;
  raise notice 'OK: a lead cannot change the year group or the lead list';
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
  delete from public.allowlist where email = 'lead.maldives.b@example.com';
  select count(*) into n from public.allowlist where email = 'lead.maldives.b@example.com';
  if n <> 0 then
    raise exception 'FAIL: removed lead is still on the list';
  end if;
  select count(*) into n from public.allowlist where email = 'lead.maldives.a@example.com';
  if n <> 1 then
    raise exception 'FAIL: the other lead was removed as well';
  end if;
  raise notice 'OK: removing a lead revokes that email only';
end $$;

reset role;
do $$
begin
  begin
    update public.stalls set assigned_year_group = 'Playgroup' where id = 'japan';
    raise exception 'FAIL: a year group outside the list was saved';
  exception
    when check_violation then
      raise notice 'OK: year group must be one of the dropdown values';
  end;
  raise notice 'ALL LEAD CHECKS PASSED';
end $$;
