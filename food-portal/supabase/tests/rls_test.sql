-- Proves a stall contact cannot sign in or edit a plan, and that the
-- sign-in hook rejects an email that is not a PTC admin.

insert into public.stall_contacts (email, role, stall_id, display_name) values
  ('lead.japan@example.com', 'lead', 'japan', 'Japan lead'),
  ('lead.india@example.com', 'lead', 'india', 'India lead');

insert into public.allowlist (email, role, display_name) values
  ('admin@example.com', 'admin', 'PTC admin');

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
  if coalesce(result->'error'->>'http_code', '') <> '403' then
    raise exception 'FAIL: a stall contact was allowed to sign in (%)', result;
  end if;

  result := public.hook_before_user_created('{"user":{"email":"admin@example.com"}}'::jsonb);
  if result <> '{}'::jsonb then
    raise exception 'FAIL: admin email was rejected (%)', result;
  end if;
  raise notice 'OK: auth hook allows PTC admins and refuses stall contacts';
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
  if n <> 0 then
    raise exception 'FAIL: a stall contact sees % stalls', n;
  end if;

  update public.stalls set dropoff_instructions = 'Side gate' where id = 'japan';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: a stall contact updated a stall';
  end if;

  begin
    insert into public.dishes (stall_id, name, sort_order) values ('japan', 'Test onigiri', 50);
    raise exception 'FAIL: a stall contact added a dish';
  exception
    when insufficient_privilege or raise_exception then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
  end;

  begin
    insert into public.allowlist (email, role, display_name) values ('extra@example.com', 'admin', 'Extra');
    raise exception 'FAIL: a stall contact edited the allowlist';
  exception
    when insufficient_privilege or raise_exception then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
  end;
  raise notice 'OK: a stall contact cannot read or write a plan';
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
  if status <> 'not_started' then
    raise exception 'FAIL: contact write changed status to %', status;
  end if;
  if email is not null then
    raise exception 'FAIL: updated_by_email is %', email;
  end if;
  if dropoff = 'Side gate' then
    raise exception 'FAIL: a stall contact changed the drop-off';
  end if;

  select year_groups into years from public.stalls where id = 'india';
  if years = 'Hacked' then
    raise exception 'FAIL: India year groups were overwritten';
  end if;

  select count(*) into sneaky from public.dishes where name = 'Sneaky';
  if sneaky <> 0 then
    raise exception 'FAIL: sneaky dish was stored';
  end if;
  raise notice 'OK: a stall contact left the plan unchanged';
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
  if n <> 0 then
    raise exception 'FAIL: a stall contact can read a locked stall';
  end if;

  select count(*) into before_count from public.dishes where stall_id = 'japan';
  update public.stalls set dropoff_instructions = 'Nope' where id = 'japan';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: a stall contact updated a locked stall';
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
  raise notice 'OK: a locked stall stays closed to a stall contact';
end $$;

reset role;

do $$
declare
  dropoff text;
begin
  select dropoff_instructions into dropoff from public.stalls where id = 'japan';
  if dropoff = 'Nope' then
    raise exception 'FAIL: locked stall drop-off changed';
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
  begin
    insert into public.allowlist (email, role, stall_id, display_name)
    values ('lead.europe@example.com', 'lead', 'europe', 'Europe lead');
    raise exception 'FAIL: a lead was added to the sign-in list';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
  end;

  insert into public.stall_contacts (email, role, stall_id, display_name)
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

  delete from public.stall_contacts where email = 'lead.europe@example.com';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: admin could not remove a lead contact';
  end if;
  raise notice 'OK: admin keeps contacts off the sign-in list';
end $$;

reset role;

do $$
declare
  number text;
  pay text;
  flag boolean;
begin
  select bank_account_number, how_to_pay into number, pay from public.stalls where id = 'india';
  if number is distinct from '5464113' then
    raise exception 'FAIL: India account number is %', number;
  end if;
  if pay like '%5464113%' then
    raise exception 'FAIL: India account number is still in how to pay';
  end if;
  select allow_bank_details into flag from public.portal_settings where id = 'portal';
  if flag then
    raise exception 'FAIL: bank details started on';
  end if;
end $$;

select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","email":"lead.india@example.com","role":"authenticated"}',
  false
);
set role authenticated;

do $$
declare
  n int;
  number text;
  flag boolean;
begin
  select allow_bank_details into flag from public.portal_settings where id = 'portal';
  if flag is distinct from false then
    raise exception 'FAIL: India lead cannot read the bank switch';
  end if;

  update public.portal_settings set allow_bank_details = true where id = 'portal';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: lead changed the bank switch';
  end if;

  update public.stalls set bank_account_number = '99999999' where id = 'india';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: a stall contact changed bank details';
  end if;
  raise notice 'OK: bank details stay closed for a stall contact';
end $$;

reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","email":"admin@example.com","role":"authenticated"}',
  false
);
set role authenticated;

update public.portal_settings set allow_bank_details = true where id = 'portal';

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
begin
  update public.stalls set bank_account_number = '11111111' where id = 'india';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: a stall contact edited bank details';
  end if;
  raise notice 'OK: bank details stay with the PTC after they are allowed';
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
