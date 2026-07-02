-- 006: security + performance + payments/cache/reminders
-- Idempotent — safe to run more than once.

-- ── Hot-path indexes (dashboard, messages, invoices all filter by shop) ──
CREATE INDEX IF NOT EXISTS idx_messages_shop_id ON public.messages(shop_id);
CREATE INDEX IF NOT EXISTS idx_messages_customer_id ON public.messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_documents_shop_id ON public.documents(shop_id);
CREATE INDEX IF NOT EXISTS idx_documents_shop_type_status ON public.documents(shop_id, type, status);
CREATE INDEX IF NOT EXISTS idx_jobs_shop_status ON public.jobs(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_shop_start ON public.appointments(shop_id, start_time);

-- ── Repair manual cache: stop re-scraping the manual sites on every lookup ──
CREATE TABLE IF NOT EXISTS public.repair_manual_cache (
  url text PRIMARY KEY,
  html text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.repair_manual_cache ENABLE ROW LEVEL SECURITY;
-- Service-role only (server code). No user-facing policies on purpose.

-- ── Payments: real record of money received against an invoice ──
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  method text NOT NULL DEFAULT 'cash',
  note text DEFAULT '',
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_document_id ON public.payments(document_id);
CREATE INDEX IF NOT EXISTS idx_payments_shop_paid_at ON public.payments(shop_id, paid_at DESC);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_shop_all ON public.payments;
CREATE POLICY payments_shop_all ON public.payments FOR ALL
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));

-- ── Appointment reminders: track what was already sent so we never double-text ──
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- ── One-click estimate approval ──
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS approved_by text;

-- ── Growth tables: replace the catch-all "allow everything" policies with
--    authenticated-only (single-shop deployment; anon key gets nothing) ──
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['growth_leads','growth_campaigns','growth_scans','growth_referrals']) LOOP
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS "Allow all for authenticated" ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS %I_authed_only ON public.%I', t, t);
      EXECUTE format(
        'CREATE POLICY %I_authed_only ON public.%I FOR ALL USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')',
        t, t
      );
    END IF;
  END LOOP;
END $$;
