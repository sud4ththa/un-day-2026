-- One lead and one optional food coordinator per stall.

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
  ('coord.maldives@example.com', 'food_coordinator', 'maldives', 'Maldives Coordinator', '0773000002'),
  ('coord.japan@example.com', 'food_coordinator', 'japan', 'Japan Coordinator', '');

do $$
declare
  n int;
  stored_phone text;
begin
  select count(*) into n from public.allowlist where stall_id = 'maldives' and role = 'lead';
  if n <> 1 then
    raise exception 'FAIL: Maldives should have one lead (% )', n;
  end if;
  select count(*) into n from public.allowlist where stall_id = 'maldives' and role = 'food_coordinator';
  if n <> 1 then
    raise exception 'FAIL: Maldives should have one food coordinator (% )', n;
  end if;
  select a.phone into stored_phone from public.allowlist a where a.email = 'lead.maldives.a@example.com';
  if stored_phone is distinct from '0773000001' then
    raise exception 'FAIL: lead phone was not stored (%)', stored_phone;
  end if;

  begin
    insert into public.allowlist (email, role, stall_id, display_name)
    values ('lead.maldives.b@example.com', 'lead', 'maldives', 'Maldives B');
    raise exception 'FAIL: a second lead was saved';
  exception
    when unique_violation then
      raise notice 'OK: a stall cannot have two leads';
  end;
  raise notice 'OK: one lead and one food coordinator, with an optional phone';
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
  select count(*) into n from public.stalls where id = 'japan';
  if n <> 1 then
    raise exception 'FAIL: food coordinator cannot read their stall';
  end if;
  select count(*) into n from public.stalls where id = 'maldives';
  if n <> 0 then
    raise exception 'FAIL: food coordinator can read another unpublished stall';
  end if;
  select count(*) into n from public.allowlist where role = 'lead' and stall_id = 'japan';
  if n <> 1 then
    raise exception 'FAIL: food coordinator cannot see the lead name';
  end if;
  update public.stalls set year_groups = 'Year 11' where id = 'india';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: food coordinator updated another stall';
  end if;
  raise notice 'OK: a food coordinator can open their stall and not another';
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

  select count(*) into n from public.allowlist where email = 'coord.japan@example.com';
  if n <> 1 then
    raise exception 'FAIL: lead cannot see the food coordinator';
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
  delete from public.allowlist where email = 'coord.maldives@example.com';
  select count(*) into n from public.allowlist where email = 'coord.maldives@example.com';
  if n <> 0 then
    raise exception 'FAIL: removed food coordinator is still on the list';
  end if;
  select count(*) into n from public.allowlist where email = 'lead.maldives.a@example.com';
  if n <> 1 then
    raise exception 'FAIL: removing the food coordinator removed the lead';
  end if;
  raise notice 'OK: removing a food coordinator revokes that email only';
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
