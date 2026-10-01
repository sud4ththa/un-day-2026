-- Run this after the migration.
-- Subraja, Zainab, and Sudaththa are the PTC admins for UN Day 2026.
-- A person cannot sign in until their email is in this list.

insert into public.allowlist (email, role, display_name) values
  ('subraja.subramaniam@pta.britishschool.lk', 'admin', 'Subraja'),
  ('zainab.nuzhan@britishschool.lk', 'admin', 'Zainab'),
  ('sudaththa.ariyasena@pta.britishschool.lk', 'admin', 'Sudaththa');
