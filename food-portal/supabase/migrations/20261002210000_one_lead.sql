-- One lead per stall, and at most one food coordinator.
-- A food coordinator signs in with an email code and can open that stall's
-- plan and pledges, the same as the lead.

alter table public.allowlist drop constraint if exists allowlist_role_check;
alter table public.allowlist drop constraint if exists allowlist_role_stall;

alter table public.allowlist
  add constraint allowlist_role_check
  check (role in ('admin', 'lead', 'food_coordinator'));

alter table public.allowlist
  add constraint allowlist_role_stall check (
    (role = 'admin' and stall_id is null)
    or (role in ('lead', 'food_coordinator') and stall_id is not null)
  );

create unique index if not exists allowlist_one_slot_per_stall
  on public.allowlist (stall_id, role)
  where role in ('lead', 'food_coordinator');

comment on table public.allowlist is
  'Who may sign in. Admins have no stall. Each stall has at most one lead and one food coordinator.';

create or replace function public.my_stall_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select stall_id from public.allowlist
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and role in ('lead', 'food_coordinator')
  limit 1;
$$;

drop policy if exists allowlist_select on public.allowlist;
create policy allowlist_select on public.allowlist
  for select to authenticated
  using (
    public.is_admin()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or stall_id = public.my_stall_id()
  );
