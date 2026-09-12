-- Settings columns used by the current application routes and tenant-scoped integrations.
alter table public.settings
  add column if not exists google_review_url text,
  add column if not exists timezone text not null default 'America/Chicago',
  add column if not exists automation_config jsonb not null default '{}'::jsonb,
  add column if not exists telnyx_connection_id text,
  add column if not exists facebook_page_id text,
  add column if not exists facebook_page_token text,
  add column if not exists fb_ad_account_id text,
  add column if not exists searxng_url text;
