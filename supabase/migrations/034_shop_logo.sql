-- Per-shop logo.
--
-- Stored as a small data URL (the browser shrinks the picture to about 320px before it is saved,
-- so a logo is normally 20 to 60 KB). Only the server reads or writes this column, through
-- /api/shop-logo: migration 027 revoked broad table access and granted the browser only a short
-- list of columns, and this column is deliberately not on that list.
--
-- Safe to run more than once. Not applied to production yet.

alter table public.settings add column if not exists logo_data text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'settings_logo_data_check' and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings add constraint settings_logo_data_check
      check (
        logo_data is null
        or (length(logo_data) <= 300000 and logo_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$')
      );
  end if;
end $$;
