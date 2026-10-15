-- Estimates and invoices, part 3: earlier versions of a document.
--
-- When a sent or approved estimate or invoice is edited, the app saves what it looked like just before the edit, so the
-- shop can see exactly what changed, compare, and put an earlier version back. Only lines, fees, tax and notes are kept;
-- payments are never part of a version, and putting a version back never touches money already taken.
--
-- Server only, like migrations 046 and 047. Safe to run more than once. Not applied to production yet; until it is,
-- editing works as before and the "Earlier versions" list says it needs this update.

create table if not exists public.document_revisions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  document_id uuid not null,
  revision_no integer not null check (revision_no >= 1),
  reason text not null default 'edited' check (reason in ('edited', 'customer_answer', 'supplement', 'restored', 'voided')),
  total numeric not null default 0,
  snapshot jsonb not null check (length(snapshot::text) <= 300000),
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Two edits at the same moment cannot take the same number.
create unique index if not exists idx_document_revisions_number on public.document_revisions (shop_id, document_id, revision_no);
create index if not exists idx_document_revisions_recent on public.document_revisions (shop_id, document_id, created_at desc);

alter table public.document_revisions enable row level security;
revoke all on table public.document_revisions from public, anon, authenticated;
grant all on table public.document_revisions to service_role;
