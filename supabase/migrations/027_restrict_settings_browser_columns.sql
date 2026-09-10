-- Browser-facing settings reads are limited to the non-secret fields used by the UI.
-- Provider credentials and automation configuration remain server-only.
revoke all privileges on table public.settings from public, anon, authenticated;

grant select (
  id,
  shop_id,
  shop_name,
  shop_address,
  shop_phone,
  shop_email,
  labor_rate,
  tax_rate,
  payment_methods,
  google_review_url
) on table public.settings to authenticated;