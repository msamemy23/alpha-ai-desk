-- Estimates and invoices, part 1: secure customer links, the customer's answer, and the history of a document.
--
--   document_links      one row per link sent to a customer. The link token, when it expires, when the customer first
--                       looked and how many times, whether the email was opened, and how they answered.
--   document_approvals  the customer's answer to an estimate: which jobs they approved or declined, the option they
--                       picked, their signature, and the exact copy of the document they saw, with a fingerprint so a
--                       later change is detectable. Rows are never edited after they are written (see the trigger).
--   document_events     the readable history of a document: who did what and when. Append only.
--
-- Server only: the browser never reads or writes these tables. The app reaches them through its own routes, which check
-- the signed-in shop (staff) or the secret link (customers). RLS is on and only the service role has any grant.
--
-- Nothing here changes the documents or payments tables. Totals, numbering, statuses and the paid-document lock are untouched.
-- Safe to run more than once. Not applied to production yet; the app works without it (customer links fall back to the
-- older sign-only flow, and the history sheet says it needs this database update).

create table if not exists public.document_links (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  document_id uuid not null,
  token text not null check (length(token) between 16 and 64),
  purpose text not null default 'review' check (purpose in ('review', 'supplement')),
  doc_type text,
  doc_number text,
  channel text check (channel is null or channel in ('email', 'sms', 'copy')),
  sent_to text,
  -- Fingerprint of the document when the link was made. The customer's answer must match what they were shown.
  content_hash text,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  email_opened_at timestamptz,
  email_open_count integer not null default 0 check (email_open_count >= 0),
  completed_at timestamptz,
  response text check (response is null or response in ('approved', 'partial', 'declined', 'signed'))
);

create unique index if not exists idx_document_links_token on public.document_links (token);
create index if not exists idx_document_links_document on public.document_links (shop_id, document_id, created_at desc);
create index if not exists idx_document_links_shop_recent on public.document_links (shop_id, created_at desc);

alter table public.document_links enable row level security;
revoke all on table public.document_links from public, anon, authenticated;
grant all on table public.document_links to service_role;

create table if not exists public.document_approvals (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  document_id uuid not null,
  link_id uuid references public.document_links(id) on delete set null,
  -- pending: written first. applied: the document was updated to match. failed: the update did not go through.
  status text not null default 'pending' check (status in ('pending', 'applied', 'failed')),
  outcome text not null check (outcome in ('approved', 'partial', 'declined', 'signed')),
  signer_name text not null check (length(btrim(signer_name)) between 1 and 160),
  method text not null default 'typed' check (method in ('drawn', 'typed', 'click')),
  signature_data text check (
    signature_data is null
    or (length(signature_data) <= 500000 and signature_data ~ '^data:image/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$')
  ),
  signature_hash text,
  content_hash text not null,
  record_hash text not null,
  signer_ip text,
  signer_agent text check (signer_agent is null or length(signer_agent) <= 400),
  signer_device text,
  decisions jsonb not null default '{}'::jsonb,
  options jsonb not null default '{}'::jsonb,
  note text check (note is null or length(note) <= 2000),
  -- The document exactly as the customer saw it (lines, totals, terms), kept so a signed copy never depends on later edits.
  snapshot jsonb not null default '{}'::jsonb check (length(snapshot::text) <= 600000),
  total_before numeric,
  total_after numeric,
  signed_at timestamptz not null default now(),
  applied_at timestamptz,
  error text check (error is null or length(error) <= 500),
  created_at timestamptz not null default now()
);

-- One answer per link. A failed attempt does not use up the link.
create unique index if not exists idx_document_approvals_link_once
  on public.document_approvals (link_id) where link_id is not null and status <> 'failed';
create index if not exists idx_document_approvals_document on public.document_approvals (shop_id, document_id, signed_at desc);

alter table public.document_approvals enable row level security;
revoke all on table public.document_approvals from public, anon, authenticated;
grant all on table public.document_approvals to service_role;

create table if not exists public.document_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  document_id uuid not null,
  doc_number text,
  kind text not null check (length(kind) between 1 and 40),
  actor text not null default 'staff' check (actor in ('staff', 'customer', 'system')),
  actor_name text check (actor_name is null or length(actor_name) <= 160),
  summary text not null check (length(summary) between 1 and 600),
  detail jsonb check (detail is null or length(detail::text) <= 40000),
  created_at timestamptz not null default now()
);

create index if not exists idx_document_events_document on public.document_events (shop_id, document_id, created_at desc);
create index if not exists idx_document_events_shop_recent on public.document_events (shop_id, created_at desc);

alter table public.document_events enable row level security;
revoke all on table public.document_events from public, anon, authenticated;
grant all on table public.document_events to service_role;

-- History is never rewritten. Rows can be added; they cannot be changed or removed (a shop being deleted can still
-- take its rows with it, because that delete arrives from a foreign key rather than from the app).
create or replace function public.document_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Document history cannot be changed or removed' using errcode = '42501';
end;
$$;

drop trigger if exists document_events_no_change on public.document_events;
create trigger document_events_no_change
  before update or delete on public.document_events
  for each row execute function public.document_events_append_only();

-- A signed record keeps its signer, time, address, answers, signature, copy of the document and fingerprint for good.
-- Only the bookkeeping columns (status, applied_at, error, total_after) may change after it is written.
create or replace function public.document_approvals_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Signed records cannot be removed' using errcode = '42501';
  end if;
  if (new.id, new.shop_id, new.document_id, new.link_id, new.outcome, new.signer_name, new.method, new.signature_data,
      new.signature_hash, new.content_hash, new.record_hash, new.signer_ip, new.signer_agent, new.signer_device,
      new.decisions, new.options, new.note, new.snapshot, new.total_before, new.signed_at, new.created_at)
     is distinct from
     (old.id, old.shop_id, old.document_id, old.link_id, old.outcome, old.signer_name, old.method, old.signature_data,
      old.signature_hash, old.content_hash, old.record_hash, old.signer_ip, old.signer_agent, old.signer_device,
      old.decisions, old.options, old.note, old.snapshot, old.total_before, old.signed_at, old.created_at) then
    raise exception 'Signed records cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists document_approvals_no_change on public.document_approvals;
create trigger document_approvals_no_change
  before update or delete on public.document_approvals
  for each row execute function public.document_approvals_guard();
