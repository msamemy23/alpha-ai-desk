-- Seed: shop_profiles
-- Run this after users have signed up via Supabase Auth

INSERT INTO public.shop_profiles (user_id, shop_name, phone, address, city_state_zip)
SELECT id, 'Alpha International Auto Center', '(713) 663-6979', '10710 S Main St', 'Houston, TX 77025'
FROM auth.users
WHERE email = 'valuestock85@gmail.com'
ON CONFLICT (user_id) DO UPDATE SET
  shop_name     = EXCLUDED.shop_name,
  phone         = EXCLUDED.phone,
  address       = EXCLUDED.address,
  city_state_zip = EXCLUDED.city_state_zip;

INSERT INTO public.shop_profiles (user_id, shop_name, phone, address, city_state_zip)
SELECT id, 'Ace Muffler', '(TBD)', '5710 Telephone Rd', 'Houston, TX 77075'
FROM auth.users
WHERE email = 'acemufflerhouston@gmail.com'
ON CONFLICT (user_id) DO UPDATE SET
  shop_name     = EXCLUDED.shop_name,
  phone         = EXCLUDED.phone,
  address       = EXCLUDED.address,
  city_state_zip = EXCLUDED.city_state_zip;

