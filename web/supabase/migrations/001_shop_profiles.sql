-- Migration: 001_shop_profiles
-- Creates per-shop profile table with RLS

CREATE TABLE IF NOT EXISTS public.shop_profiles (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_name     text,
  phone         text,
  address       text,
  city_state_zip text,
  services      text[],
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT shop_profiles_user_id_key UNIQUE (user_id)
);

ALTER TABLE public.shop_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own shop profile"
  ON public.shop_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own shop profile"
  ON public.shop_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own shop profile"
  ON public.shop_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own shop profile"
  ON public.shop_profiles FOR DELETE
  USING (auth.uid() = user_id);

