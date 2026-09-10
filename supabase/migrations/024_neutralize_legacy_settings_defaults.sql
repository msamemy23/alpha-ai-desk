-- New tenants must never inherit the original deployment's identity or staff list.
-- Existing values are intentionally preserved; only column defaults change.
alter table public.settings
  alter column shop_name drop default,
  alter column shop_address drop default,
  alter column shop_phone drop default,
  alter column shop_email drop default,
  alter column from_email drop default,
  alter column disclaimer drop default,
  alter column techs drop default;