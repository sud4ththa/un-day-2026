-- UN Day 2026 food list.
-- Run this once in the Supabase SQL editor (SQL → New query → paste → Run).
-- It creates the tables, the sign-in allowlist, row-level security, and the
-- starting stalls. Dish names begin from the 2025 forms. Eco Warriors is empty.
-- Year groups are last year's assignment and can be edited in the portal.

begin;

create table public.stalls (
  id text primary key,
  name text not null,
  sort_order integer not null unique,
  year_groups text not null default '',
  support_type text not null default 'food' check (support_type in ('food', 'money', 'both')),
  amount_per_family text not null default '',
  how_to_pay text not null default '',
  payment_deadline text not null default '',
  contribution_mode text check (contribution_mode is null or contribution_mode in ('either', 'both')),
  food_coordinator_name text not null default '',
  food_coordinator_phone text not null default '',
  dropoff_instructions text not null default '',
  packaging_note text not null default 'No single-use plastic.',
  halal_note text not null default '',
  bank_account_name text not null default '',
  bank_name text not null default '',
  bank_branch text not null default '',
  bank_account_number text not null default '',
  bank_reference text not null default '',
  status text not null default 'not_started' check (status in ('not_started', 'draft', 'submitted', 'locked')),
  locked_at timestamptz,
  locked_by uuid,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_email text
);

create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  stall_id text not null references public.stalls (id) on delete cascade,
  name text not null default '',
  diet text check (diet is null or diet in ('veg', 'non_veg', 'vegan')),
  allergens text[] not null default '{}',
  allergen_other text not null default '',
  spice text check (spice is null or spice in ('none', 'mild', 'medium', 'hot')),
  taste text check (taste is null or taste in ('sweet', 'savoury')),
  made_by text not null default 'home' check (made_by in ('home', 'caterer')),
  caterer_name text not null default '',
  caterer_contact text not null default '',
  target_pieces integer check (target_pieces is null or target_pieces >= 0),
  notes text not null default '',
  sort_order integer not null,
  constraint dishes_allergens_known check (
    allergens <@ array['nuts', 'dairy', 'gluten', 'egg', 'seafood', 'other']::text[]
  )
);

create index dishes_stall_sort_idx on public.dishes (stall_id, sort_order);

create table public.allowlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (position('@' in email) > 1),
  role text not null check (role in ('admin', 'lead')),
  stall_id text references public.stalls (id),
  display_name text not null default '',
  created_at timestamptz not null default now(),
  constraint allowlist_role_stall check (
    (role = 'admin' and stall_id is null)
    or (role = 'lead' and stall_id is not null)
  )
);

comment on table public.allowlist is
  'Who may sign in. Admins have no stall. Leads have exactly one stall.';

create table public.portal_settings (
  id text primary key,
  allow_bank_details boolean not null default false,
  constraint portal_settings_one_row check (id = 'portal')
);

comment on table public.portal_settings is
  'Site-wide switches. Bank details stay off until the PTC and the school approve them.';

alter table public.stalls enable row level security;
alter table public.dishes enable row level security;
alter table public.allowlist enable row level security;
alter table public.portal_settings enable row level security;

-- Helpers read the allowlist as the table owner so policies cannot recurse.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowlist
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role = 'admin'
  );
$$;

create or replace function public.my_stall_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select stall_id from public.allowlist
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and role = 'lead'
  limit 1;
$$;

-- Names only, so a lead can be warned about a dish another stall already has
-- without seeing that stall's plan.
create or replace function public.dish_name_index()
returns table (stall_id text, stall_name text, dish_name text)
language sql
stable
security definer
set search_path = public
as $$
  select d.stall_id, s.name, d.name
  from public.dishes d
  join public.stalls s on s.id = d.stall_id
  where length(trim(d.name)) > 0
    and exists (
      select 1 from public.allowlist a
      where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  order by s.sort_order, d.sort_order;
$$;

-- Runs before Supabase creates a login.
-- Leads and admins must be on the allowlist.
-- Parents are not on that list. Their sign-in sends purpose = parent.
-- security definer: the auth hook role cannot read allowlist through RLS.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_email text;
  purpose text;
begin
  user_email := lower(trim(coalesce(event->'user'->>'email', '')));
  purpose := coalesce(
    event->'user'->'raw_user_meta_data'->>'purpose',
    event->'user'->'user_metadata'->>'purpose',
    ''
  );
  if user_email <> '' and exists (
    select 1 from public.allowlist where email = user_email
  ) then
    return '{}'::jsonb;
  end if;
  if user_email <> '' and purpose = 'parent' then
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

create or replace function public.normalize_allowlist()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.email := lower(trim(new.email));
  new.display_name := trim(coalesce(new.display_name, ''));
  if new.role = 'admin' then
    new.stall_id := null;
  end if;
  return new;
end;
$$;

create or replace function public.keep_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin' and (
      select count(*) from public.allowlist where role = 'admin' and id <> old.id
    ) = 0 then
      raise exception 'The list needs at least one admin';
    end if;
    return old;
  end if;
  if old.role = 'admin' and new.role is distinct from 'admin' and (
    select count(*) from public.allowlist where role = 'admin' and id <> old.id
  ) = 0 then
    raise exception 'The list needs at least one admin';
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

create or replace function public.guard_dish()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  sid text;
  stall_status text;
begin
  if current_user <> 'authenticated' or public.is_admin() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  sid := case when tg_op = 'DELETE' then old.stall_id else new.stall_id end;
  if sid is distinct from public.my_stall_id() then
    raise exception 'You can only edit your own stall';
  end if;
  if tg_op = 'UPDATE' and new.stall_id is distinct from old.stall_id then
    raise exception 'You can only edit your own stall';
  end if;

  select status into stall_status from public.stalls where id = sid;
  if stall_status = 'locked' then
    raise exception 'This stall is locked';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger allowlist_normalize
  before insert or update on public.allowlist
  for each row execute function public.normalize_allowlist();

create trigger allowlist_keep_last_admin
  before update or delete on public.allowlist
  for each row execute function public.keep_last_admin();

create trigger stalls_guard
  before update on public.stalls
  for each row execute function public.guard_stall();

create trigger dishes_guard
  before insert or update or delete on public.dishes
  for each row execute function public.guard_dish();

create policy stalls_select on public.stalls
  for select to authenticated
  using (public.is_admin() or id = public.my_stall_id());

create policy stalls_update on public.stalls
  for update to authenticated
  using (
    public.is_admin()
    or (id = public.my_stall_id() and status <> 'locked')
  )
  with check (
    public.is_admin()
    or (id = public.my_stall_id() and status <> 'locked')
  );

create policy dishes_select on public.dishes
  for select to authenticated
  using (public.is_admin() or stall_id = public.my_stall_id());

create policy dishes_insert on public.dishes
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      stall_id = public.my_stall_id()
      and exists (
        select 1 from public.stalls s
        where s.id = stall_id and s.status <> 'locked'
      )
    )
  );

create policy dishes_update on public.dishes
  for update to authenticated
  using (
    public.is_admin()
    or (
      stall_id = public.my_stall_id()
      and exists (
        select 1 from public.stalls s
        where s.id = dishes.stall_id and s.status <> 'locked'
      )
    )
  )
  with check (
    public.is_admin()
    or (
      stall_id = public.my_stall_id()
      and exists (
        select 1 from public.stalls s
        where s.id = stall_id and s.status <> 'locked'
      )
    )
  );

create policy dishes_delete on public.dishes
  for delete to authenticated
  using (
    public.is_admin()
    or (
      stall_id = public.my_stall_id()
      and exists (
        select 1 from public.stalls s
        where s.id = dishes.stall_id and s.status <> 'locked'
      )
    )
  );

create policy allowlist_select on public.allowlist
  for select to authenticated
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.is_admin()
  );

create policy allowlist_insert on public.allowlist
  for insert to authenticated
  with check (public.is_admin());

create policy allowlist_update on public.allowlist
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy allowlist_delete on public.allowlist
  for delete to authenticated
  using (public.is_admin());

create policy portal_settings_select on public.portal_settings
  for select to authenticated
  using (public.is_admin() or public.my_stall_id() is not null);

create policy portal_settings_update on public.portal_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.my_stall_id() from public, anon, authenticated;
revoke all on function public.dish_name_index() from public, anon, authenticated;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
revoke all on function public.keep_last_admin() from public;
revoke all on function public.guard_stall() from public;
revoke all on function public.guard_dish() from public;
revoke all on function public.normalize_allowlist() from public;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_stall_id() to authenticated;
grant execute on function public.dish_name_index() to authenticated;
grant execute on function public.guard_stall() to authenticated;
grant execute on function public.guard_dish() to authenticated;
grant execute on function public.normalize_allowlist() to authenticated;
grant execute on function public.keep_last_admin() to authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to anon, authenticated, supabase_auth_admin;

grant select, insert, update, delete on public.stalls to authenticated;
grant select, insert, update, delete on public.dishes to authenticated;
grant select, insert, update, delete on public.allowlist to authenticated;
grant select, update on public.portal_settings to authenticated;
revoke all on public.stalls from anon;
revoke all on public.dishes from anon;
revoke all on public.allowlist from anon;
revoke all on public.portal_settings from anon;



insert into public.stalls (
  id, name, sort_order, year_groups, support_type, amount_per_family, how_to_pay,
  payment_deadline, contribution_mode, food_coordinator_name, food_coordinator_phone,
  dropoff_instructions, packaging_note, halal_note,
  bank_account_name, bank_name, bank_branch, bank_account_number, bank_reference
) values
('japan', 'Japan', 1, 'Year 5', 'food', '', '', '', null, '', '', '', 'No single-use plastic.', 'Any meat provided should be halal please.', '', '', '', '', ''),
('india', 'India', 2, 'Year 10', 'both', 'LKR 5,000', 'Last year''s details, please confirm. WhatsApp the receipt to Chandi on 0773824465, with your child''s name and class.', '', 'either', '', '', '', 'No single-use plastic.', '', 'L C Kumari', 'BOC', 'Rajagiriya', '5464113', 'Child''s name and class'),
('usa-canada', 'USA/Canada', 3, 'Year 4', 'food', '', '', '', null, '', '', 'Please drop the food on the morning of Friday 16 October 2026, labelled with the stall name and your child''s name and class.', 'No single-use plastic. Please use cardboard or another recyclable container.', '', '', '', '', '', ''),
('singapore-malaysia-thailand', 'Singapore/Malaysia/Thailand', 4, 'Year 2', 'food', '', '', '', null, '', '', '', 'No single-use plastic.', 'Any meat provided should be halal please.', '', '', '', '', ''),
('sri-lanka', 'Sri Lanka', 5, 'Nursery and Year 1', 'food', '', '', '', null, '', '', '', 'No single-use plastic.', '', '', '', '', '', ''),
('europe', 'Europe', 6, 'Playgroup and Reception', 'food', '', '', '', null, '', '', '', 'No single-use plastic.', 'Any meat provided should be halal please.', '', '', '', '', ''),
('middle-east', 'Middle East', 7, 'Year 12', 'food', '', '', '', null, '', '', '', 'No single-use plastic.', 'Any meat should be halal please.', '', '', '', '', ''),
('china', 'China', 8, 'Year 6', 'food', '', '', '', null, '', '', '', 'No single-use plastic.', 'Any meat provided should be halal please.', '', '', '', '', ''),
('maldives', 'Maldives', 9, 'Year 11', 'food', '', '', '', null, '', '', '', 'No single-use plastic.', '', '', '', '', '', ''),
('australia-nz-philippines-indonesia', 'Australia/NZ/Philippines/Indonesia', 10, 'Year 3', 'food', '', '', '', null, '', '', '', 'No single-use plastic.', 'Any meat provided should be halal please.', '', '', '', '', ''),
('palestine-un-zone', 'Palestine and UN Zone', 11, 'Year 9 and Year 13', 'both', '', 'Last year''s details, please confirm.', '', 'either', '', '', '', 'No single-use plastic.', 'Any meat provided should be halal please.', 'Shyam Jobanputra', 'Commercial Bank', 'Narahenpita', '1220044952', ''),
('eco-warriors', 'Eco Warriors', 12, 'Year 8', 'food', '', '', '', null, '', '', '', 'No single-use plastic.', '', '', '', '', '', '');

insert into public.dishes (
  stall_id, name, diet, allergens, allergen_other, spice, taste, made_by,
  caterer_name, caterer_contact, target_pieces, notes, sort_order
) values
('japan', 'Sushi Roll Veg', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 1),
('japan', 'Yakisoba Noodles', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 2),
('japan', 'Chicken Teriyaki/Karage', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 3),
('japan', 'Matcha Sweets/Cake', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 4),
('japan', 'Mochi Sweets', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 5),
('japan', 'Senbei Rice Crackers', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 6),
('india', 'Biriyani (veg)', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 1),
('india', 'Biriyani (chicken)', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 2),
('india', 'Chicken gravy and raita', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 3),
('india', 'Meduvadas', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 4),
('india', 'Soft paratha', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 5),
('india', 'Samosa', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 6),
('india', 'Momos (veg, Nepali)', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 7),
('india', 'Laddoos', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 8),
('india', 'Gulab Jamun', 'veg', array['dairy']::text[], '', null, 'sweet', 'home', '', '', null, '', 9),
('india', 'Other Indian sweets', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 10),
('india', 'Sel roti (Nepali)', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 11),
('india', 'Bundi', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 12),
('usa-canada', 'Waffles with maple syrup', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 1),
('usa-canada', 'Mini sausage pastries', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 2),
('usa-canada', 'Loaded fries (poutine)', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, 'Please send these in frozen packs so they can be fried on the morning.', 3),
('usa-canada', 'Strawberries and mini marshmallows', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 4),
('usa-canada', 'Hotdogs', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 5),
('usa-canada', 'Donuts', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 6),
('usa-canada', 'Cookies', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 7),
('usa-canada', 'Pizza', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 8),
('singapore-malaysia-thailand', 'Mee Goreng', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 1),
('singapore-malaysia-thailand', 'Mini Chicken Satay', 'non_veg', array['nuts']::text[], '', null, 'savoury', 'home', '', '', null, 'Peanut sauce is common. Note here if you leave it off.', 2),
('singapore-malaysia-thailand', 'Chicken Spring Rolls', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 3),
('singapore-malaysia-thailand', 'Mini Wonton Cups', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 4),
('singapore-malaysia-thailand', 'Mini Bao Buns', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 5),
('singapore-malaysia-thailand', 'Mini Pandan Cupcakes / Mini Milo Cupcakes', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 6),
('singapore-malaysia-thailand', 'Mango Sticky Cups', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 7),
('sri-lanka', 'Milk Rice', 'veg', array['dairy']::text[], '', null, 'savoury', 'home', '', '', null, '', 1),
('sri-lanka', 'Lunu Miris', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 2),
('sri-lanka', 'Konda Kavum', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 3),
('sri-lanka', 'Kokis', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 4),
('sri-lanka', 'Asmi', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 5),
('sri-lanka', 'Mung Kavum', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 6),
('sri-lanka', 'Hadi Kavum', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 7),
('sri-lanka', 'Naran Kavum', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 8),
('sri-lanka', 'Aluwa', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 9),
('sri-lanka', 'Wali Thalapa', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 10),
('sri-lanka', 'Halapa', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 11),
('sri-lanka', 'Dodol', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 12),
('sri-lanka', 'Milk Toffee', 'veg', array['dairy']::text[], '', null, 'sweet', 'home', '', '', null, '', 13),
('sri-lanka', 'Ala Toffee', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 14),
('sri-lanka', 'Coconut Toffee', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 15),
('sri-lanka', 'Pani Walalu', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 16),
('sri-lanka', 'Undu Wel', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 17),
('sri-lanka', 'Cup Cakes with SL Flag', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 18),
('sri-lanka', 'Thala Karali', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 19),
('sri-lanka', 'Bibikkan', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 20),
('sri-lanka', 'Tea Buns', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 21),
('sri-lanka', 'Viana Roll', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 22),
('sri-lanka', 'Fish Bun', 'non_veg', array['seafood']::text[], '', null, 'savoury', 'home', '', '', null, '', 23),
('sri-lanka', 'Mini Pol roti', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 24),
('sri-lanka', 'King Coconut Water', 'vegan', '{}'::text[], '', null, null, 'home', '', '', null, '', 25),
('sri-lanka', 'Aggala', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 26),
('sri-lanka', 'Banana', 'vegan', '{}'::text[], '', null, null, 'home', '', '', null, '', 27),
('europe', 'Mini Pizza (chicken/veg)', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 1),
('europe', 'Macarons', 'veg', array['nuts']::text[], '', null, 'sweet', 'home', '', '', null, 'Suggested vendor from last year: Fab, via Dinusha 0776383877.', 2),
('europe', 'Fruits (grapes or strawberry)', 'vegan', '{}'::text[], '', null, null, 'home', '', '', null, 'Fresh fruit.', 3),
('europe', 'Mini Quiche/Pie (chicken/veg)', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 4),
('europe', 'Chicken Sausages (cut in small pieces)', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 5),
('europe', 'Chicken meat balls', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 6),
('europe', 'Mini Donuts', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 7),
('europe', 'Mini Cupcakes', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 8),
('europe', 'Chocolate Fudge/Cake', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, 'Suggested vendor from last year: Fab, via Dinusha 0776383877.', 9),
('europe', 'Pastries or other savoury items', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, 'Suggested vendor from last year: Fab, via Dinusha 0776383877.', 10),
('middle-east', 'Boondi', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 1),
('middle-east', 'Dates/date cake', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 2),
('middle-east', 'Barfi', 'veg', array['dairy']::text[], '', null, 'sweet', 'home', '', '', null, '', 3),
('middle-east', 'Basbousa', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 4),
('middle-east', 'Gulab jamun', 'veg', array['dairy']::text[], '', null, 'sweet', 'home', '', '', null, '', 5),
('middle-east', 'Chicken Shawarma', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 6),
('middle-east', 'Chicken kebabs', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 7),
('middle-east', 'Chickpea salad', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 8),
('middle-east', 'Punjabi vegetable samosas', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 9),
('middle-east', 'Boneless Chicken Biryani', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 10),
('middle-east', 'Arabic coffee', 'veg', '{}'::text[], '', null, null, 'home', '', '', null, '', 11),
('middle-east', 'Rooh Afza', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 12),
('china', 'Red bean pumpkin cake', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 1),
('china', 'Fried Chicken Wings', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 2),
('china', 'Fried Prawns', 'non_veg', array['seafood']::text[], '', null, 'savoury', 'home', '', '', null, '', 3),
('china', 'Chicken and corn dumplings', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 4),
('china', 'Coconut mango rolls', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 5),
('china', 'Chinese chicken burger', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 6),
('maldives', 'Handulu Gulha', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 1),
('maldives', 'Fu Gulha', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 2),
('maldives', 'Masroshi', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 3),
('maldives', 'Bajiya', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 4),
('maldives', 'Kulhi Boakibaa', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 5),
('maldives', 'Riha Folhi', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 6),
('maldives', 'Kavaabu', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 7),
('maldives', 'Havaadhulee Bis', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 8),
('maldives', 'Kudhi Gulha', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, 'Last year this was a pack of 5.', 9),
('maldives', 'Dhandi Aluvi Boakibaa', null, '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 10),
('maldives', 'Huni Gulha', null, '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 11),
('maldives', 'Githeyo Boakibaa', null, '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 12),
('maldives', 'Saagu Bondibaiy', null, '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 13),
('maldives', 'Ulhaali', null, '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 14),
('maldives', 'Fehi Boakibaa', null, '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 15),
('australia-nz-philippines-indonesia', 'Sausage Pastry', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 1),
('australia-nz-philippines-indonesia', 'Chicken Sausages (halal)', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 2),
('australia-nz-philippines-indonesia', 'Mini Pavlova', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, 'Suggested vendor from last year: Silver Aisle bakery, 077 510 2583.', 3),
('australia-nz-philippines-indonesia', 'Lamingtons', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, 'Suggested vendor from last year: Hasna 0772001200. Another number listed last year: 0722435335.', 4),
('australia-nz-philippines-indonesia', 'Tim Tams', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, '', 5),
('australia-nz-philippines-indonesia', 'Rocky Road', 'veg', array['nuts']::text[], '', null, 'sweet', 'home', '', '', null, '', 6),
('australia-nz-philippines-indonesia', 'Fried/Baked chicken wings', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 7),
('australia-nz-philippines-indonesia', 'Chicken Satay', 'non_veg', array['nuts']::text[], '', null, 'savoury', 'home', '', '', null, 'Keep any sauce separate from the chicken. Suggested vendor from last year: Pepper Valley or Crescent.', 8),
('australia-nz-philippines-indonesia', 'Spring Roll', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 9),
('australia-nz-philippines-indonesia', 'Vege Rice Noodles', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, 'Suggested vendor from last year: Annalyn, 0769776009.', 10),
('australia-nz-philippines-indonesia', 'Chicken pie', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, '', 11),
('palestine-un-zone', 'Customised Flag Cookies', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, 'Suggested vendor from last year: Heavenly Bakes, Zeenath 777259249.', 1),
('palestine-un-zone', 'Cassava Chips', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, 'Suggested vendor from last year: Hasana 770285285.', 2),
('palestine-un-zone', 'Date Cake', 'veg', '{}'::text[], '', null, 'sweet', 'home', '', '', null, 'Suggested vendor from last year: Paan Paan, Avani 0774103799.', 3),
('palestine-un-zone', 'Garlic Bread Rolls', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, 'Suggested vendor from last year: Paan Paan, Avani 0774103799.', 4),
('palestine-un-zone', 'Samosas', null, '{}'::text[], '', null, 'savoury', 'home', '', '', null, 'Suggested vendor from last year: Paan Paan, Avani 0774103799.', 5),
('palestine-un-zone', 'Grilled Chicken Skewers', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, 'Suggested vendor from last year: Dolce Falasteen, Azra 774612999.', 6),
('palestine-un-zone', 'Falafel & Hummus', 'veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, 'Suggested vendor from last year: Dolce Falasteen, Azra 774612999.', 7),
('palestine-un-zone', 'Mini Shawarma', 'non_veg', '{}'::text[], '', null, 'savoury', 'home', '', '', null, 'Suggested vendor from last year: Dolce Falasteen, Azra 774612999.', 8);

insert into public.portal_settings (id, allow_bank_details) values ('portal', false);

commit;
