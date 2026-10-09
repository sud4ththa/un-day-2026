-- Adds structured bank details and the PTC switch that keeps them closed.
-- Safe to run after 20261001120000_init.sql, including a copy that already
-- has these columns.

alter table public.stalls add column if not exists bank_account_name text not null default '';
alter table public.stalls add column if not exists bank_name text not null default '';
alter table public.stalls add column if not exists bank_branch text not null default '';
alter table public.stalls add column if not exists bank_account_number text not null default '';
alter table public.stalls add column if not exists bank_reference text not null default '';

create table if not exists public.portal_settings (
  id text primary key,
  allow_bank_details boolean not null default false,
  constraint portal_settings_one_row check (id = 'portal')
);

alter table public.portal_settings enable row level security;

insert into public.portal_settings (id, allow_bank_details)
values ('portal', false)
on conflict (id) do nothing;

update public.stalls set
  bank_account_name = 'L C Kumari',
  bank_name = 'BOC',
  bank_branch = 'Rajagiriya',
  bank_account_number = '5464113',
  bank_reference = 'Child''s name and class',
  how_to_pay = 'Last year''s details, please confirm. WhatsApp the receipt to Chandi on 0773824465, with your child''s name and class.'
where id = 'india'
  and how_to_pay like '%Account number: 5464113%';

update public.stalls set
  bank_account_name = 'Shyam Jobanputra',
  bank_name = 'Commercial Bank',
  bank_branch = 'Narahenpita',
  bank_account_number = '1220044952',
  how_to_pay = 'Last year''s details, please confirm.'
where id = 'palestine-un-zone'
  and how_to_pay like '%1220044952%';

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

drop policy if exists portal_settings_select on public.portal_settings;
create policy portal_settings_select on public.portal_settings
  for select to authenticated
  using (public.is_admin() or public.my_stall_id() is not null);

drop policy if exists portal_settings_update on public.portal_settings;
create policy portal_settings_update on public.portal_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, update on public.portal_settings to authenticated;
revoke all on public.portal_settings from anon;
