-- Run this after the migration, once you know the real admin emails.
-- Sudaththa, Subraja, and Zainab are the PTC admins for UN Day 2026.
-- Replace each example.com address, then paste this into the Supabase SQL editor.
-- A person cannot sign in until their email is in this list.

insert into public.allowlist (email, role, display_name) values
  ('sudaththa@example.com', 'admin', 'Sudaththa'),
  ('subraja@example.com', 'admin', 'Subraja'),
  ('zainab@example.com', 'admin', 'Zainab');
