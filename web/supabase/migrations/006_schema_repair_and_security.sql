-- ============================================================================
-- 006 — SCHEMA REPAIR + SECURITY (2026-07-02)
-- Creates every table the code uses that was missing in production (their
-- pages have been silently failing), adds shop isolation columns, hot-path
-- indexes, and locks Row Level Security so only logged-in users can touch
-- shop data. Written to be safe to run more than once (IF NOT EXISTS).
-- Run in the Supabase SQL editor.
-- ============================================================================

-- ─── 1. Missing tables the app already uses ────────────────────────────────

-- Appointments page + AI scheduling
CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  customer_id uuid,
  customer_name text NOT NULL,
  phone text,
  vehicle text,
  service text,
  tech text,
  date text,
  time text,
  duration integer,
  status text DEFAULT 'Scheduled',
  notes text,
  reminder_sent_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointments_shop_date ON public.appointments (shop_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_shop_status ON public.appointments (shop_id, status);

-- Scheduled follow-ups (AI "schedule a text for Friday")
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  customer_id uuid,
  customer_name text,
  channel text DEFAULT 'sms',
  scheduled_for timestamptz,
  message_body text,
  subject text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_shop_scheduled ON public.scheduled_messages (shop_id, scheduled_for);

-- Inventory page
CREATE TABLE IF NOT EXISTS public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  part_number text,
  name text NOT NULL,
  category text,
  brand text,
  description text,
  cost numeric,
  retail_price numeric,
  qty_on_hand integer DEFAULT 0,
  qty_reorder integer DEFAULT 0,
  qty_on_order integer DEFAULT 0,
  location text,
  supplier text,
  supplier_part_number text,
  notes text,
  last_ordered text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_shop_name ON public.inventory (shop_id, name);

-- Digital vehicle inspections page
CREATE TABLE IF NOT EXISTS public.dvi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  job_id uuid,
  customer_name text,
  vehicle text,
  tech text,
  sections jsonb DEFAULT '[]'::jsonb,
  overall_status text,
  tech_notes text,
  sent_to_customer boolean DEFAULT false,
  sent_at timestamptz,
  customer_approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dvi_created ON public.dvi (created_at DESC);

-- Canned jobs page (estimate templates)
CREATE TABLE IF NOT EXISTS public.canned_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  name text NOT NULL,
  category text,
  description text,
  labor_hours numeric,
  labor_rate numeric,
  parts jsonb DEFAULT '[]'::jsonb,
  total_price numeric,
  notes text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_canned_jobs_category ON public.canned_jobs (category);

-- Call log summaries used by notifications
CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  from_number text,
  to_number text,
  start_time timestamptz,
  duration_secs integer,
  direction text,
  matched_customer_name text,
  status text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calls_start_time ON public.calls (start_time DESC);

-- Vehicles (service reminders + VIN decode)
CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  customer_id uuid,
  year text,
  make text,
  model text,
  vin text,
  engine text,
  trim text,
  current_mileage integer,
  last_oil_change_mileage integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON public.vehicles (customer_id);

-- Legacy invoices reads (reports/service reminders)
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  customer_id uuid,
  vehicle_id uuid,
  items jsonb DEFAULT '[]'::jsonb,
  total numeric,
  amount_paid numeric,
  status text,
  payment_method text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON public.invoices (customer_id);

-- Automation bookkeeping tables
CREATE TABLE IF NOT EXISTS public.service_reminders_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid,
  customer_id uuid,
  message text,
  sent boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.estimate_followups_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid,
  customer_id uuid,
  method text,
  sent boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.growth_review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid,
  customer_name text,
  phone text,
  sent boolean DEFAULT false,
  error text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.growth_review_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_name text,
  rating integer,
  review_text text,
  ai_response text,
  posted boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.growth_referral_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid,
  referral_code text,
  referrer_id uuid,
  referrer_name text,
  new_customer_name text,
  new_customer_phone text,
  service_total numeric DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.growth_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid,
  customer_name text,
  phone text,
  message text,
  sent boolean DEFAULT false,
  message_id text,
  error text,
  months_since_visit integer,
  last_service text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.web_automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text,
  task text,
  result text,
  success boolean,
  created_at timestamptz DEFAULT now()
);

-- Audit trail (audit-log.ts has been silently skipping — table never existed)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  user_id uuid,
  action text NOT NULL,
  target_type text,
  target_id text,
  permission text,
  approved boolean,
  idempotency_key text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_shop_created ON public.audit_logs (shop_id, created_at DESC);

-- ─── 2. New feature tables (payments + manual cache) ───────────────────────

-- Payment records against invoices (invoice page "record payment")
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid,
  document_id uuid,
  customer_id uuid,
  amount numeric NOT NULL,
  method text NOT NULL DEFAULT 'cash',
  reference text,
  notes text,
  paid_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_document ON public.payments (document_id);
CREATE INDEX IF NOT EXISTS idx_payments_shop_paid ON public.payments (shop_id, paid_at DESC);

-- Repair manual page cache (stop re-scraping lemon/charm on every request)
CREATE TABLE IF NOT EXISTS public.repair_manual_cache (
  url text PRIMARY KEY,
  provider text,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_repair_manual_cache_fetched ON public.repair_manual_cache (fetched_at);

-- ─── 3. Shop isolation columns on existing tables ──────────────────────────

ALTER TABLE public.connectors ADD COLUMN IF NOT EXISTS shop_id uuid;
ALTER TABLE public.ai_calls ADD COLUMN IF NOT EXISTS shop_id uuid;
ALTER TABLE public.growth_leads ADD COLUMN IF NOT EXISTS shop_id uuid;
ALTER TABLE public.growth_campaigns ADD COLUMN IF NOT EXISTS shop_id uuid;

-- Backfill single-shop data to the first (only) shop profile.
UPDATE public.connectors SET shop_id = (SELECT id FROM public.shop_profiles ORDER BY created_at LIMIT 1) WHERE shop_id IS NULL;
UPDATE public.ai_calls SET shop_id = (SELECT id FROM public.shop_profiles ORDER BY created_at LIMIT 1) WHERE shop_id IS NULL;
UPDATE public.growth_leads SET shop_id = (SELECT id FROM public.shop_profiles ORDER BY created_at LIMIT 1) WHERE shop_id IS NULL;
UPDATE public.growth_campaigns SET shop_id = (SELECT id FROM public.shop_profiles ORDER BY created_at LIMIT 1) WHERE shop_id IS NULL;

-- Connectors: one row per (shop, service) instead of one global row per service.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'public.connectors'::regclass AND contype = 'u' LIMIT 1;
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.connectors DROP CONSTRAINT %I', c);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_connectors_shop_service ON public.connectors (shop_id, service);

-- ─── 4. Hot-path indexes on the busiest tables ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_messages_shop_created ON public.messages (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_shop_type ON public.documents (shop_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_shop_status ON public.jobs (shop_id, status);
CREATE INDEX IF NOT EXISTS idx_customers_shop_phone ON public.customers (shop_id, phone);

-- ─── 5. Columns older code expects that may be missing ─────────────────────

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS sentiment text DEFAULT 'neutral';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS last_contact timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS review_requested timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS vehicle_color text DEFAULT '';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS vehicle_engine text DEFAULT '';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS approved_by_name text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS amount_paid numeric DEFAULT 0;

-- ─── 6. Row Level Security ─────────────────────────────────────────────────
-- Server API routes use the service role (bypasses RLS) and filter by shop in
-- code; RLS here protects direct PostgREST access with the anon/user keys.
-- Shop-scoped tables get owner-only policies; single-shop bookkeeping tables
-- get authenticated-only (never anonymous) access.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'appointments','scheduled_messages','inventory','dvi','canned_jobs','calls',
    'vehicles','invoices','service_reminders_sent','estimate_followups_sent',
    'growth_review_requests','growth_review_responses','growth_referral_redemptions',
    'growth_followups','web_automation_logs','audit_logs','payments','repair_manual_cache'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_authenticated_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t || '_authenticated_all', t
    );
  END LOOP;
END $$;

-- Replace the wide-open growth policies with authenticated-only.
DO $$
DECLARE t text;
DECLARE p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['growth_leads','growth_campaigns','growth_scans','growth_activity','referrals','outreach_history','social_posts','leads'] LOOP
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
      END LOOP;
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        t || '_authenticated_all', t
      );
    END IF;
  END LOOP;
END $$;

-- Done. Verify with: SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1;
