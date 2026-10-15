-- Digital vehicle inspections: the shop's own checklists, a private place for photos, video and voice notes,
-- and a record of when a declined finding was followed up.
--
-- Safe to run more than once. Nothing here changes existing rows or columns the app already reads.
-- The app checks for each piece and keeps working without it:
--   * no dvi_templates table: the three built-in checklists are offered and "Your checklists" shows a notice.
--   * no dvi-media bucket: photos stay inside the inspection (as they do today) and video and voice notes show a notice.
--   * no followup columns: follow-up texts still go out, but "followed up" is not remembered.
-- Not applied to production yet.

-- 1. Checklists a shop writes for itself. Only the server reads or writes them, through /api/inspection/templates.
create table if not exists public.dvi_templates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  label text not null,
  blurb text not null default '',
  sections jsonb not null default '[]'::jsonb,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dvi_templates_label_check' and conrelid = 'public.dvi_templates'::regclass) then
    alter table public.dvi_templates add constraint dvi_templates_label_check check (char_length(label) between 1 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dvi_templates_sections_check' and conrelid = 'public.dvi_templates'::regclass) then
    alter table public.dvi_templates add constraint dvi_templates_sections_check
      check (jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) between 1 and 12);
  end if;
end $$;

create index if not exists idx_dvi_templates_shop on public.dvi_templates (shop_id, archived, created_at);

alter table public.dvi_templates enable row level security;
revoke all on table public.dvi_templates from public, anon, authenticated;
grant all on table public.dvi_templates to service_role;

-- 2. A private bucket for inspection photos, video and voice notes.
-- Nothing in it is public. The server hands out short-lived signed addresses: to the signed-in shop, and to a customer
-- who holds that inspection's private link. No browser policy is created on purpose: with none, only the server can reach it.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'dvi-media', 'dvi-media', false, 26214400,
      array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/mpeg', 'audio/ogg']
    )
    on conflict (id) do nothing;
  end if;
end $$;

-- 3. When a declined or unanswered finding was last followed up with the customer.
alter table public.dvi add column if not exists followup_sent_at timestamptz;
alter table public.dvi add column if not exists followup_count integer not null default 0;

-- 4. A compact copy of every rated line, kept beside the row so "what changed since the last visit" and the history list
-- do not have to load every photo. The app rewrites it on every save. Separate from the summary column on purpose:
-- the list of inspections reads the summary for 300 rows at once and should stay small.
alter table public.dvi add column if not exists digest jsonb;
