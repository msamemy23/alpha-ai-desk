-- Repair-order numbers on jobs.
--
-- The app has written and shown jobs.ro_number since March 2026 (RO-2026-0001 style), but no migration ever created the
-- column, so production silently dropped every RO number: the Jobs screen saved without it, and the Shop board, My cars and
-- Inspections screens each asked for it, got a 400, and asked again without it (audit 20 Oct 2026, bug B6).
--
-- Add-only: one nullable text column and one partial unique index (two jobs in one shop cannot share an RO number; jobs
-- without one are not affected). No existing row is read or changed. Safe to run more than once.
-- Undo: drop index if exists public.jobs_shop_ro_number_key; alter table public.jobs drop column if exists ro_number;

alter table public.jobs add column if not exists ro_number text;

create unique index if not exists jobs_shop_ro_number_key
  on public.jobs (shop_id, ro_number)
  where ro_number is not null and ro_number <> '';
