-- Stall leads and food coordinators no longer sign in.
-- Their allowlist rows become contact records. The PTC enters every plan.
-- Parents still sign in with a code. Notification sends stay off.

create table if not exists public.stall_contacts (
  id uuid primary key default gen_random_uuid(),
  stall_id text not null references public.stalls (id),
  role text not null check (role in ('lead', 'food_coordinator')),
  display_name text not null default '',
  email text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists stall_contacts_one_slot
  on public.stall_contacts (stall_id, role);

insert into public.stall_contacts (stall_id, role, display_name, email, phone)
select stall_id, role, display_name, email, coalesce(phone, '')
from public.allowlist
where role in ('lead', 'food_coordinator')
on conflict do nothing;

delete from public.allowlist where role in ('lead', 'food_coordinator');

alter table public.allowlist drop constraint if exists allowlist_role_check;
alter table public.allowlist drop constraint if exists allowlist_role_stall;
drop index if exists allowlist_one_slot_per_stall;

alter table public.allowlist
  add constraint allowlist_role_check check (role = 'admin');

alter table public.allowlist
  add constraint allowlist_role_stall check (role = 'admin' and stall_id is null);

comment on table public.allowlist is
  'PTC admins who can sign in. Stall leads and food coordinators live in stall_contacts and cannot sign in.';

comment on table public.stall_contacts is
  'One lead and an optional food coordinator per stall. Contact records for the daily update. They do not sign in.';

-- Older policies still call this. It matches nobody, so a former lead login cannot open a stall.
create or replace function public.my_stall_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select null::text;
$$;

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_email text;
  user_phone text;
  purpose text;
begin
  user_email := lower(trim(coalesce(event->'user'->>'email', '')));
  user_phone := trim(coalesce(event->'user'->>'phone', ''));
  purpose := coalesce(
    event->'user'->'raw_user_meta_data'->>'purpose',
    event->'user'->'user_metadata'->>'purpose',
    ''
  );
  if user_email <> '' and exists (
    select 1 from public.stall_contacts
    where lower(email) = user_email and email <> ''
  ) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'Stall leads do not sign in. The PTC enters the plan.',
        'http_code', 403
      )
    );
  end if;
  if user_email <> '' and exists (
    select 1 from public.allowlist
    where email = user_email and role = 'admin'
  ) then
    return '{}'::jsonb;
  end if;
  if purpose = 'parent' and (user_email <> '' or user_phone <> '') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'This email is not on the UN Day food list. Ask the PTC to add you.',
      'http_code', 403
    )
  );
end;
$$;

create table if not exists public.parent_children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id) on delete cascade,
  child_name text not null,
  year_group text not null,
  section text not null default '',
  sort_order integer not null default 1,
  constraint parent_children_year check (
    year_group in (
      'Nursery', 'Reception',
      'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6',
      'Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11'
    )
  ),
  constraint parent_children_section check (section = '' or section ~ '^[A-Za-z]{1,2}$'),
  constraint parent_children_order check (sort_order in (1, 2)),
  unique (parent_id, sort_order)
);

insert into public.parent_children (parent_id, child_name, year_group, section, sort_order)
select id, child_name, year_group, '', 1
from public.parents
where child_name <> ''
  and year_group in (
    'Nursery', 'Reception',
    'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6',
    'Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11'
  )
  and not exists (
    select 1 from public.parent_children c where c.parent_id = parents.id
  );

create table if not exists public.notification_settings (
  id text primary key,
  parent_reminders boolean not null default false,
  daily_stall_update boolean not null default false,
  daily_admin_report boolean not null default false,
  progress_report boolean not null default false,
  progress_schedule text not null default 'weekly' check (progress_schedule in ('weekly', 'daily')),
  progress_recipients text not null default '',
  event_date date not null default date '2026-10-16',
  updated_at timestamptz not null default now()
);

insert into public.notification_settings (id)
values ('portal')
on conflict (id) do nothing;

alter table public.stall_contacts enable row level security;
alter table public.parent_children enable row level security;
alter table public.notification_settings enable row level security;

drop policy if exists stall_contacts_all on public.stall_contacts;
create policy stall_contacts_all on public.stall_contacts
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists parent_children_select on public.parent_children;
create policy parent_children_select on public.parent_children
  for select to authenticated
  using (
    public.is_admin()
    or parent_id = public.my_parent_id()
  );

drop policy if exists parent_children_insert on public.parent_children;
create policy parent_children_insert on public.parent_children
  for insert to authenticated
  with check (parent_id = public.my_parent_id() or public.is_admin());

drop policy if exists parent_children_update on public.parent_children;
create policy parent_children_update on public.parent_children
  for update to authenticated
  using (parent_id = public.my_parent_id() or public.is_admin())
  with check (parent_id = public.my_parent_id() or public.is_admin());

drop policy if exists parent_children_delete on public.parent_children;
create policy parent_children_delete on public.parent_children
  for delete to authenticated
  using (parent_id = public.my_parent_id() or public.is_admin());

drop policy if exists notification_settings_select on public.notification_settings;
create policy notification_settings_select on public.notification_settings
  for select to authenticated
  using (public.is_admin());

drop policy if exists notification_settings_update on public.notification_settings;
create policy notification_settings_update on public.notification_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists parents_insert on public.parents;
create policy parents_insert on public.parents
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      (
        email <> ''
        and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
      or (
        coalesce(auth.jwt() ->> 'email', '') = ''
        and phone <> ''
      )
    )
  );

grant select, insert, update, delete on public.stall_contacts to authenticated;
grant select, insert, update, delete on public.parent_children to authenticated;
grant select, update on public.notification_settings to authenticated;
revoke all on public.stall_contacts from anon;
revoke all on public.parent_children from anon;
revoke all on public.notification_settings from anon;
