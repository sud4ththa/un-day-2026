-- Parent pledges: cap, and who can see which rows.

update public.stalls
set published_to_parents = true, pledge_deadline = date '2026-10-13'
where id = 'india';

update public.dishes
set max_quantity = 5
where id = (
  select id from public.dishes where stall_id = 'india' and name = 'Samosa' limit 1
);

insert into public.parents (id, user_id, email, parent_name, child_name, year_group, phone) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ada@parent.test', 'Ada Parent', 'Child A', 'Year 10', '0771111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bea@parent.test', 'Bea Parent', 'Child B', 'Year 10', '0772222222');

set role supabase_auth_admin;
do $$
declare
  result jsonb;
begin
  result := public.hook_before_user_created('{"user":{"email":"stranger@example.com"}}'::jsonb);
  if coalesce(result->'error'->>'http_code', '') <> '403' then
    raise exception 'FAIL: stranger without purpose was allowed (%)', result;
  end if;
  result := public.hook_before_user_created(
    '{"user":{"email":"parent@example.com","raw_user_meta_data":{"purpose":"parent"}}}'::jsonb
  );
  if result <> '{}'::jsonb then
    raise exception 'FAIL: parent sign-in was rejected (%)', result;
  end if;
  raise notice 'OK: parent purpose can create a login, a stranger still cannot';
end $$;
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","email":"ada@parent.test","role":"authenticated"}',
  false
);
set role authenticated;

do $$
declare
  n int;
  dish uuid;
  left_over int;
begin
  select count(*) into n from public.stalls where id = 'japan';
  if n <> 0 then
    raise exception 'FAIL: parent can read an unpublished stall';
  end if;

  select count(*) into n from public.stalls where id = 'india';
  if n <> 1 then
    raise exception 'FAIL: parent cannot read a published stall';
  end if;

  select id into dish from public.dishes where stall_id = 'india' and name = 'Samosa';
  insert into public.pledges (parent_id, stall_id, dish_id, quantity, kind, status)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'india', dish, 4, 'food', 'active');

  select remaining into left_over from public.dish_remaining() where dish_id = dish;
  if left_over <> 1 then
    raise exception 'FAIL: remaining was % after a pledge of 4', left_over;
  end if;
  raise notice 'OK: parent reads published plans and remaining counts';
end $$;

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","email":"bea@parent.test","role":"authenticated"}',
  false
);
set role authenticated;

do $$
declare
  n int;
  dish uuid;
begin
  select count(*) into n from public.pledges;
  if n <> 0 then
    raise exception 'FAIL: parent B can read parent A pledges (% )', n;
  end if;

  select count(*) into n from public.parents where email = 'ada@parent.test';
  if n <> 0 then
    raise exception 'FAIL: parent B can read parent A';
  end if;

  select id into dish from public.dishes where stall_id = 'india' and name = 'Samosa';
  begin
    insert into public.pledges (parent_id, stall_id, dish_id, quantity, kind, status)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'india', dish, 2, 'food', 'active');
    raise exception 'FAIL: over-pledge was saved';
  exception
    when others then
      if sqlerrm not like '%Only 1 still needed%' and sqlerrm not like '%Full%' then
        raise exception 'FAIL: unexpected over-pledge error: %', sqlerrm;
      end if;
  end;

  insert into public.pledges (parent_id, stall_id, dish_id, quantity, kind, status)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'india', dish, 1, 'food', 'active');
  raise notice 'OK: a second parent cannot pledge past the cap';
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
begin
  select count(*) into n from public.pledges;
  if n <> 0 then
    raise exception 'FAIL: Japan lead can see India pledges';
  end if;
  raise notice 'OK: a lead cannot see another stall''s pledges';
end $$;

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","email":"lead.india@example.com","role":"authenticated"}',
  false
);
set role authenticated;

do $$
declare
  n int;
  phone text;
begin
  select count(*) into n from public.pledges where stall_id = 'india' and status = 'active';
  if n <> 0 then
    raise exception 'FAIL: a stall contact sees % pledges', n;
  end if;
  raise notice 'OK: a stall contact cannot see pledges';
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
  pledge uuid;
begin
  select count(*) into n from public.pledges;
  if n <> 2 then
    raise exception 'FAIL: admin sees % pledges', n;
  end if;
  select id into pledge from public.pledges where parent_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  update public.pledges
  set status = 'removed', removed_reason = 'Spam', removed_by = 'admin@example.com'
  where id = pledge;
  if not found then
    raise exception 'FAIL: admin could not remove a pledge';
  end if;
  raise notice 'OK: admin can soft-delete a pledge with a reason';
end $$;

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","email":"ada@parent.test","role":"authenticated"}',
  false
);
set role authenticated;

do $$
begin
  update public.pledges
  set status = 'removed', removed_reason = 'no'
  where parent_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'FAIL: parent removed their own pledge';
exception
  when others then
    if sqlerrm like '%FAIL:%' then
      raise;
    end if;
    raise notice 'OK: a parent cannot remove a pledge';
end $$;

reset role;
do $$
begin
  raise notice 'ALL PLEDGE CHECKS PASSED';
end $$;
