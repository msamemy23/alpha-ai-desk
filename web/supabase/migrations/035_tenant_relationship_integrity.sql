-- Tenant-safe relationship keys and per-shop social mention deduplication.
-- Existing legacy rows with NULL tenant ids remain readable; all new rows
-- with tenant ids must reference a record from the same shop.

CREATE UNIQUE INDEX IF NOT EXISTS competitor_shops_shop_id_id_key
  ON public.competitor_shops (shop_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS leads_shop_id_id_key
  ON public.leads (shop_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS social_keywords_shop_id_id_key
  ON public.social_keywords (shop_id, id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.competitor_reviews'::regclass
      AND conname = 'competitor_reviews_shop_id_fkey'
  ) THEN
    ALTER TABLE public.competitor_reviews
      DROP CONSTRAINT competitor_reviews_shop_id_fkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.competitor_reviews'::regclass
      AND conname = 'competitor_reviews_lead_id_fkey'
  ) THEN
    ALTER TABLE public.competitor_reviews
      DROP CONSTRAINT competitor_reviews_lead_id_fkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.competitor_reviews'::regclass
      AND conname = 'competitor_reviews_competitor_shop_tenant_fkey'
  ) THEN
    ALTER TABLE public.competitor_reviews
      ADD CONSTRAINT competitor_reviews_competitor_shop_tenant_fkey
      FOREIGN KEY (shop_id, competitor_shop_id)
      REFERENCES public.competitor_shops (shop_id, id)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.competitor_reviews'::regclass
      AND conname = 'competitor_reviews_lead_tenant_fkey'
  ) THEN
    ALTER TABLE public.competitor_reviews
      ADD CONSTRAINT competitor_reviews_lead_tenant_fkey
      FOREIGN KEY (shop_id, lead_id)
      REFERENCES public.leads (shop_id, id)
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.social_mentions'::regclass
      AND conname = 'social_mentions_keyword_id_fkey'
  ) THEN
    ALTER TABLE public.social_mentions
      DROP CONSTRAINT social_mentions_keyword_id_fkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.social_mentions'::regclass
      AND conname = 'social_mentions_keyword_tenant_fkey'
  ) THEN
    ALTER TABLE public.social_mentions
      ADD CONSTRAINT social_mentions_keyword_tenant_fkey
      FOREIGN KEY (shop_id, keyword_id)
      REFERENCES public.social_keywords (shop_id, id)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.social_mentions
  DROP CONSTRAINT IF EXISTS social_mentions_mention_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS social_mentions_shop_mention_hash_key
  ON public.social_mentions (shop_id, mention_hash)
  WHERE shop_id IS NOT NULL AND mention_hash IS NOT NULL;
