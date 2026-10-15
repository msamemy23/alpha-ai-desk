alter table public.jobs
  add column if not exists approved_amount numeric(12,2),
  add column if not exists communication_log jsonb not null default '[]'::jsonb,
  add column if not exists inspection_notes text,
  add column if not exists deductible_collected boolean not null default false,
  add column if not exists deductible_payment_method text,
  add column if not exists loss_date date,
  add column if not exists policy_number text,
  add column if not exists adjuster_email text,
  add column if not exists supplement_amount_requested numeric(12,2),
  add column if not exists supplement_amount_approved numeric(12,2);
