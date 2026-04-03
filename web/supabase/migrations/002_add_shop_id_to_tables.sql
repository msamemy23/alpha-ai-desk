-- Migration: 002_add_shop_id_to_tables
-- Adds shop_id column to every data table and enforces RLS so each shop
-- can only access its own rows. Backfills existing data to Alpha International.

-- ── 1. Add shop_id columns ────────────────────────────────────────────────────
ALTER TABLE public.customers  ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.jobs       ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.documents  ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.messages   ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.settings   ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;

-- ── 2. Backfill existing rows → Alpha International (valuestock85@gmail.com) ──
DO $$
DECLARE v_shop_id uuid;
BEGIN
  SELECT sp.id INTO v_shop_id
    FROM public.shop_profiles sp
    JOIN auth.users u ON u.id = sp.user_id
   WHERE u.email = 'valuestock85@gmail.com';

  IF v_shop_id IS NOT NULL THEN
    UPDATE public.customers  SET shop_id = v_shop_id WHERE shop_id IS NULL;
    UPDATE public.jobs       SET shop_id = v_shop_id WHERE shop_id IS NULL;
    UPDATE public.documents  SET shop_id = v_shop_id WHERE shop_id IS NULL;
    UPDATE public.messages   SET shop_id = v_shop_id WHERE shop_id IS NULL;
    UPDATE public.settings   SET shop_id = v_shop_id WHERE shop_id IS NULL;
  END IF;
END $$;

-- ── 3. Auto-populate shop_id on INSERT via trigger ────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_shop_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.shop_id IS NULL THEN
    SELECT id INTO NEW.shop_id
      FROM public.shop_profiles
     WHERE user_id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['customers','jobs','documents','messages','settings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_shop_id ON public.%I', tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_set_shop_id
       BEFORE INSERT ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id()', tbl);
  END LOOP;
END $$;

-- ── 4. Enable RLS on data tables ─────────────────────────────────────────────
ALTER TABLE public.customers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings   ENABLE ROW LEVEL SECURITY;

-- ── 5. Drop old policies (idempotent re-run safety) ──────────────────────────
DO $$
DECLARE tbl text; pol text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['customers','jobs','documents','messages','settings'] LOOP
    FOREACH pol IN ARRAY ARRAY['shop_sel','shop_ins','shop_upd','shop_del'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS "%s_%s" ON public.%I', pol, tbl, tbl);
    END LOOP;
  END LOOP;
END $$;

-- ── 6. RLS policies ───────────────────────────────────────────────────────────
-- customers
CREATE POLICY "shop_sel_customers" ON public.customers FOR SELECT
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_ins_customers" ON public.customers FOR INSERT
  WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_upd_customers" ON public.customers FOR UPDATE
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_del_customers" ON public.customers FOR DELETE
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));

-- jobs
CREATE POLICY "shop_sel_jobs" ON public.jobs FOR SELECT
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_ins_jobs" ON public.jobs FOR INSERT
  WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_upd_jobs" ON public.jobs FOR UPDATE
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_del_jobs" ON public.jobs FOR DELETE
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));

-- documents
CREATE POLICY "shop_sel_documents" ON public.documents FOR SELECT
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_ins_documents" ON public.documents FOR INSERT
  WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_upd_documents" ON public.documents FOR UPDATE
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_del_documents" ON public.documents FOR DELETE
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));

-- messages
CREATE POLICY "shop_sel_messages" ON public.messages FOR SELECT
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_ins_messages" ON public.messages FOR INSERT
  WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_upd_messages" ON public.messages FOR UPDATE
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_del_messages" ON public.messages FOR DELETE
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));

-- settings
CREATE POLICY "shop_sel_settings" ON public.settings FOR SELECT
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_ins_settings" ON public.settings FOR INSERT
  WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_upd_settings" ON public.settings FOR UPDATE
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
CREATE POLICY "shop_del_settings" ON public.settings FOR DELETE
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
