-- Phone on the sign-in list, and one assigned year group per stall.
-- Only an admin can change the assigned year group. A lead's save leaves it as it was.
-- More than one lead may share a stall. The allowlist is still one row per email.

alter table public.allowlist
  add column if not exists phone text not null default '';

alter table public.stalls
  add column if not exists assigned_year_group text;

alter table public.stalls drop constraint if exists stalls_assigned_year_group_check;
alter table public.stalls
  add constraint stalls_assigned_year_group_check
  check (
    assigned_year_group is null
    or assigned_year_group in (
      'Nursery',
      'Reception',
      'Year 1',
      'Year 2',
      'Year 3',
      'Year 4',
      'Year 5',
      'Year 6',
      'Year 7',
      'Year 8',
      'Year 9',
      'Year 10',
      'Year 11'
    )
  );

comment on column public.stalls.assigned_year_group is
  'The year group the PTC assigns to this stall. Leads cannot change it.';

create or replace function public.normalize_allowlist()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := lower(trim(new.email));
  new.display_name := trim(coalesce(new.display_name, ''));
  new.phone := trim(coalesce(new.phone, ''));
  if new.role = 'admin' then
    new.stall_id := null;
  end if;
  return new;
end;
$$;

create or replace function public.guard_stall()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    if old.status = 'locked' then
      raise exception 'This stall is locked';
    end if;
    new.id := old.id;
    new.name := old.name;
    new.sort_order := old.sort_order;
    new.locked_at := old.locked_at;
    new.locked_by := old.locked_by;
    new.assigned_year_group := old.assigned_year_group;
    if new.status = 'locked' then
      raise exception 'Only the PTC can lock a stall';
    end if;
    if old.status = 'submitted' or new.status = 'submitted' then
      new.status := 'submitted';
      new.submitted_at := coalesce(old.submitted_at, now());
    else
      new.status := 'draft';
      new.submitted_at := null;
    end if;
  else
    if new.status = 'locked' and old.status is distinct from 'locked' then
      new.locked_at := coalesce(new.locked_at, now());
      new.locked_by := coalesce(new.locked_by, auth.uid());
    elsif new.status is distinct from 'locked' then
      new.locked_at := null;
      new.locked_by := null;
    end if;
    if new.status = 'submitted' then
      new.submitted_at := coalesce(old.submitted_at, now());
    elsif new.status in ('draft', 'not_started') then
      new.submitted_at := null;
    end if;
  end if;

  if current_user = 'authenticated'
     and not coalesce((select allow_bank_details from public.portal_settings where id = 'portal'), false) then
    new.bank_account_name := old.bank_account_name;
    new.bank_name := old.bank_name;
    new.bank_branch := old.bank_branch;
    new.bank_account_number := old.bank_account_number;
    new.bank_reference := old.bank_reference;
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();
  new.updated_by_email := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  return new;
end;
$$;
