-- Parent pledges. Parents are not on the allowlist.
-- Quantities are capped in a security-definer trigger so one parent
-- cannot see another's rows and still cannot pledge past the limit.

alter table public.stalls
  add column if not exists published_to_parents boolean not null default false;

alter table public.stalls
  add column if not exists pledge_deadline date;

alter table public.dishes
  add column if not exists max_quantity integer;

alter table public.dishes drop constraint if exists dishes_max_quantity_check;
alter table public.dishes
  add constraint dishes_max_quantity_check
  check (max_quantity is null or (max_quantity >= 0 and max_quantity <= 100000));

create table if not exists public.parents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  email text not null,
  parent_name text not null default '',
  child_name text not null default '',
  year_group text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pledges (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.parents (id),
  stall_id text not null references public.stalls (id),
  dish_id uuid references public.dishes (id),
  quantity integer,
  money_lkr integer,
  kind text not null check (kind in ('food', 'money')),
  status text not null default 'active' check (status in ('active', 'cancelled', 'removed')),
  removed_reason text,
  removed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pledges_shape check (
    (
      kind = 'food'
      and dish_id is not null
      and quantity is not null
      and quantity >= 0
      and quantity <= 100000
      and money_lkr is null
    )
    or (
      kind = 'money'
      and dish_id is null
      and quantity is null
      and money_lkr is not null
      and money_lkr >= 0
      and money_lkr <= 10000000
    )
  )
);

create unique index if not exists pledges_one_active_food
  on public.pledges (parent_id, dish_id)
  where kind = 'food' and status = 'active';

create unique index if not exists pledges_one_active_money
  on public.pledges (parent_id, stall_id)
  where kind = 'money' and status = 'active';

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

create or replace function public.my_parent_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.parents
  where user_id = auth.uid()
  limit 1;
$$;

create or replace function public.guard_parent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and current_user = 'authenticated' and not public.is_admin() then
    new.id := old.id;
    new.user_id := old.user_id;
    new.email := old.email;
  end if;
  new.email := lower(trim(new.email));
  new.parent_name := trim(coalesce(new.parent_name, ''));
  new.child_name := trim(coalesce(new.child_name, ''));
  new.year_group := trim(coalesce(new.year_group, ''));
  new.phone := trim(coalesce(new.phone, ''));
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.enforce_pledge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  stall public.stalls%rowtype;
  dish public.dishes%rowtype;
  cap integer;
  used integer;
  remaining integer;
begin
  select * into stall from public.stalls where id = new.stall_id;
  if not found then
    raise exception 'Stall not found';
  end if;

  if new.status = 'removed' then
    if not public.is_admin() then
      raise exception 'Only the PTC can remove a pledge';
    end if;
    if coalesce(trim(new.removed_reason), '') = '' then
      raise exception 'A reason is required';
    end if;
  elsif not public.is_admin() then
    if not stall.published_to_parents then
      raise exception 'This stall is not open for pledges';
    end if;
    if stall.pledge_deadline is not null and current_date > stall.pledge_deadline then
      raise exception 'The pledge deadline has passed';
    end if;
  end if;

  if new.kind = 'food' and new.status = 'active' then
    if new.quantity is null or new.quantity < 1 then
      raise exception 'Enter a quantity';
    end if;
    select * into dish from public.dishes where id = new.dish_id for update;
    if not found or dish.stall_id is distinct from new.stall_id then
      raise exception 'That dish is not on this stall';
    end if;
    cap := coalesce(dish.max_quantity, dish.target_pieces);
    if cap is null then
      raise exception 'This dish has no limit yet';
    end if;
    select coalesce(sum(quantity), 0) into used
    from public.pledges
    where dish_id = new.dish_id
      and kind = 'food'
      and status = 'active'
      and id is distinct from new.id;
    remaining := cap - used;
    if new.quantity > remaining then
      if remaining <= 0 then
        raise exception 'Full';
      end if;
      raise exception 'Only % still needed', remaining;
    end if;
  elsif new.kind = 'money' and new.status = 'active' then
    if stall.support_type not in ('money', 'both') then
      raise exception 'This stall is not collecting money';
    end if;
    if new.money_lkr is null or new.money_lkr < 1 then
      raise exception 'Enter an amount';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.dish_remaining()
returns table (
  dish_id uuid,
  stall_id text,
  cap integer,
  pledged integer,
  remaining integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id,
    d.stall_id,
    coalesce(d.max_quantity, d.target_pieces) as cap,
    coalesce(sum(p.quantity) filter (where p.status = 'active'), 0)::integer as pledged,
    case
      when coalesce(d.max_quantity, d.target_pieces) is null then null
      else greatest(
        0,
        coalesce(d.max_quantity, d.target_pieces)
          - coalesce(sum(p.quantity) filter (where p.status = 'active'), 0)
      )::integer
    end as remaining
  from public.dishes d
  join public.stalls s on s.id = d.stall_id
  left join public.pledges p on p.dish_id = d.id and p.kind = 'food'
  where s.published_to_parents
    and auth.uid() is not null
  group by d.id;
$$;

drop trigger if exists parents_guard on public.parents;
create trigger parents_guard
  before insert or update on public.parents
  for each row execute function public.guard_parent();

drop trigger if exists pledges_enforce on public.pledges;
create trigger pledges_enforce
  before insert or update on public.pledges
  for each row execute function public.enforce_pledge();

alter table public.parents enable row level security;
alter table public.pledges enable row level security;

drop policy if exists stalls_select_published on public.stalls;
create policy stalls_select_published on public.stalls
  for select to authenticated
  using (published_to_parents);

drop policy if exists dishes_select_published on public.dishes;
create policy dishes_select_published on public.dishes
  for select to authenticated
  using (
    exists (
      select 1 from public.stalls s
      where s.id = dishes.stall_id and s.published_to_parents
    )
  );

drop policy if exists portal_settings_select_signed_in on public.portal_settings;
create policy portal_settings_select_signed_in on public.portal_settings
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists parents_select on public.parents;
create policy parents_select on public.parents
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.pledges p
      where p.parent_id = parents.id
        and p.stall_id = public.my_stall_id()
        and p.status <> 'removed'
    )
  );

drop policy if exists parents_insert on public.parents;
create policy parents_insert on public.parents
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists parents_update on public.parents;
create policy parents_update on public.parents
  for update to authenticated
  using (public.is_admin() or user_id = auth.uid())
  with check (public.is_admin() or user_id = auth.uid());

drop policy if exists pledges_select on public.pledges;
create policy pledges_select on public.pledges
  for select to authenticated
  using (
    public.is_admin()
    or parent_id = public.my_parent_id()
    or (stall_id = public.my_stall_id() and status <> 'removed')
  );

drop policy if exists pledges_insert on public.pledges;
create policy pledges_insert on public.pledges
  for insert to authenticated
  with check (
    parent_id = public.my_parent_id()
    and status = 'active'
  );

drop policy if exists pledges_update on public.pledges;
create policy pledges_update on public.pledges
  for update to authenticated
  using (public.is_admin() or parent_id = public.my_parent_id())
  with check (
    public.is_admin()
    or (parent_id = public.my_parent_id() and status <> 'removed')
  );

revoke all on function public.my_parent_id() from public, anon, authenticated;
revoke all on function public.dish_remaining() from public, anon, authenticated;
grant execute on function public.my_parent_id() to authenticated;
grant execute on function public.dish_remaining() to authenticated;

grant select, insert, update on public.parents to authenticated;
grant select, insert, update on public.pledges to authenticated;
