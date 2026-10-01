-- Proves a lead cannot read or write another stall, and that the sign-in
-- hook rejects an email that is not on the allowlist.

insert into public.allowlist (email, role, stall_id, display_name) values
  ('lead.japan@example.com', 'lead', 'japan', 'Japan lead'),
  ('lead.india@example.com', 'lead', 'india', 'India lead'),
  ('admin@example.com', 'admin', null, 'PTC admin');

-- The hook role cannot read the table directly, but the hook function can.
set role supabase_auth_admin;

do $$
declare
  result jsonb;
begin
  begin
    perform count(*) from public.allowlist;
    raise exception 'FAIL: auth hook role read the allowlist directly';
  exception
    when insufficient_privilege then
      raise notice 'OK: allowlist is not directly readable by the auth hook role';
  end;

  result := public.hook_before_user_created('{"user":{"email":"stranger@example.com"}}'::jsonb);
  if coalesce(result->'error'->>'http_code', '') <> '403' then
    raise exception 'FAIL: stranger was allowed (%)', result;
  end if;

  result := public.hook_before_user_created('{"user":{"email":"Lead.Japan@example.com"}}'::jsonb);
  if result <> '{}'::jsonb then
    raise exception 'FAIL: allowlisted email was rejected (%)', result;
  end if;
  raise notice 'OK: auth hook checks the allowlist';
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
  seen int;
begin
  select count(*) into n from public.stalls;
  if n <> 1 then
    raise exception 'FAIL: Japan lead sees % stalls', n;
  end if;

  select count(*) into n from public.stalls where id = 'india';
  if n <> 0 then
    raise exception 'FAIL: Japan lead can read the India stall';
  end if;

  select count(*) into n from public.dishes where stall_id = 'india';
  if n <> 0 then
    raise exception 'FAIL: Japan lead can read India dishes (% )', n;
  end if;

  select count(*) into seen from public.dish_name_index() where stall_id = 'india';
  if seen = 0 then
    raise exception 'FAIL: dish name index hid other stalls';
  end if;

  select count(*) into n from public.allowlist where email <> 'lead.japan@example.com';
  if n <> 0 then
    raise exception 'FAIL: Japan lead can read other people';
  end if;
  raise notice 'OK: lead reads only their stall, plus dish names for warnings';

  update public.stalls set year_groups = 'Hacked' where id = 'india';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: lead updated another stall';
  end if;

  update public.dishes set name = 'Hacked' where stall_id = 'india';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: lead updated another stall''s dish';
  end if;

  delete from public.dishes where stall_id = 'india';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: lead deleted another stall''s dish';
  end if;

  begin
    insert into public.dishes (stall_id, name, sort_order) values ('india', 'Sneaky', 99);
    raise exception 'FAIL: lead inserted a dish on another stall';
  exception
    when insufficient_privilege or raise_exception then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      raise notice 'OK: cross-stall dish insert blocked (% )', sqlerrm;
  end;

  begin
    insert into public.allowlist (email, role, stall_id) values ('extra@example.com', 'lead', 'japan');
    raise exception 'FAIL: lead edited the allowlist';
  exception
    when insufficient_privilege or raise_exception then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      raise notice 'OK: lead cannot add to the allowlist';
  end;

  update public.stalls set dropoff_instructions = 'Side gate' where id = 'japan';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: lead could not update their own stall (% rows)', n;
  end if;

  insert into public.dishes (stall_id, name, sort_order) values ('japan', 'Test onigiri', 50);
  raise notice 'OK: lead can write their own stall';
end $$;

reset role;

do $$
declare
  status text;
  email text;
  years text;
  dropoff text;
  sneaky int;
begin
  select s.status, s.updated_by_email, s.dropoff_instructions
    into status, email, dropoff
  from public.stalls s where s.id = 'japan';
  if status <> 'draft' then
    raise exception 'FAIL: own-stall save left status %', status;
  end if;
  if email <> 'lead.japan@example.com' then
    raise exception 'FAIL: updated_by_email is %', email;
  end if;
  if dropoff <> 'Side gate' then
    raise exception 'FAIL: drop-off was not saved (% )', dropoff;
  end if;

  select year_groups into years from public.stalls where id = 'india';
  if years = 'Hacked' then
    raise exception 'FAIL: India year groups were overwritten';
  end if;

  select count(*) into sneaky from public.dishes where name = 'Sneaky';
  if sneaky <> 0 then
    raise exception 'FAIL: sneaky dish was stored';
  end if;
  raise notice 'OK: other stall is unchanged and the audit trail is the lead email';
end $$;

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
  select count(*) into n from public.stalls;
  if n <> 12 then
    raise exception 'FAIL: admin sees % stalls', n;
  end if;
  select count(*) into n from public.dishes where stall_id = 'india';
  if n = 0 then
    raise exception 'FAIL: admin cannot read India dishes';
  end if;
  update public.stalls set status = 'locked' where id = 'japan';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: admin could not lock Japan';
  end if;
  raise notice 'OK: admin reads every stall and can lock';
end $$;

reset role;

do $$
declare
  locked_at timestamptz;
begin
  select s.locked_at into locked_at from public.stalls s where s.id = 'japan';
  if locked_at is null then
    raise exception 'FAIL: lock did not record a time';
  end if;
end $$;

select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"lead.japan@example.com","role":"authenticated"}',
  false
);
set role authenticated;

do $$
declare
  n int;
  before_count int;
  after_count int;
begin
  select count(*) into n from public.stalls where id = 'japan';
  if n <> 1 then
    raise exception 'FAIL: lead cannot read a locked stall';
  end if;

  select count(*) into before_count from public.dishes where stall_id = 'japan';
  update public.stalls set dropoff_instructions = 'Nope' where id = 'japan';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: lead updated a locked stall';
  end if;

  begin
    insert into public.dishes (stall_id, name, sort_order) values ('japan', 'Locked dish', 80);
    raise exception 'FAIL: lead added a dish to a locked stall';
  exception
    when insufficient_privilege or raise_exception then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
  end;

  select count(*) into after_count from public.dishes where stall_id = 'japan';
  if after_count <> before_count then
    raise exception 'FAIL: locked stall dish count changed';
  end if;
  raise notice 'OK: a locked stall is readable but not writable by its lead';
end $$;

reset role;

do $$
declare
  dropoff text;
begin
  select dropoff_instructions into dropoff from public.stalls where id = 'japan';
  if dropoff <> 'Side gate' then
    raise exception 'FAIL: locked stall drop-off changed to %', dropoff;
  end if;
end $$;

set role anon;

do $$
begin
  begin
    perform 1 from public.stalls;
    raise exception 'FAIL: anon read stalls';
  exception
    when insufficient_privilege then
      raise notice 'OK: anonymous visitors cannot read stalls';
  end;
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
  insert into public.allowlist (email, role, stall_id, display_name)
  values ('lead.europe@example.com', 'lead', 'europe', 'Europe lead');

  begin
    delete from public.allowlist where email = 'admin@example.com';
    raise exception 'FAIL: the only admin was removed';
  exception
    when others then
      if sqlerrm <> 'The list needs at least one admin' then
        raise;
      end if;
      raise notice 'OK: the last admin stays on the list';
  end;

  delete from public.allowlist where email = 'lead.europe@example.com';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: admin could not remove a lead';
  end if;
  raise notice 'OK: admin can add and remove a lead';
end $$;

reset role;

do $$
begin
  if exists (select 1 from public.allowlist where email = 'admin@example.com') then
    raise notice 'ALL RLS CHECKS PASSED';
  else
    raise exception 'FAIL: admin row disappeared';
  end if;
end $$;
