-- Repair Workspace tables.
-- Without these, saving a procedure card silently fails ("migration required")
-- and research-session logging no-ops. Safe to run more than once.

-- ── Procedure cards: shop-verified repair procedures saved from the workspace ──
CREATE TABLE IF NOT EXISTS public.repair_procedure_cards (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              uuid NOT NULL REFERENCES public.shop_profiles(id) ON DELETE CASCADE,
  title                text NOT NULL,
  status               text NOT NULL DEFAULT 'draft',        -- draft | verified
  confidence           text NOT NULL DEFAULT 'needs_review', -- needs_review | source_linked | shop_verified
  vehicle_year         text,
  vehicle_make         text,
  vehicle_model        text,
  vehicle_engine       text,
  vehicle_trim         text,
  vehicle_drivetrain   text,
  vehicle_transmission text,
  vehicle_brake_system text,
  operation            text,
  systems              jsonb NOT NULL DEFAULT '[]'::jsonb,
  tools                jsonb NOT NULL DEFAULT '[]'::jsonb,
  parts_fluids         jsonb NOT NULL DEFAULT '[]'::jsonb,
  safety_gates         jsonb NOT NULL DEFAULT '[]'::jsonb,
  operation_lines      jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_links         jsonb NOT NULL DEFAULT '[]'::jsonb,
  technician_notes     text NOT NULL DEFAULT '',
  approved_by          text,
  approved_at          timestamptz,
  created_by           uuid,
  updated_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repair_cards_shop_updated   ON public.repair_procedure_cards (shop_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_cards_shop_vehicle   ON public.repair_procedure_cards (shop_id, vehicle_make, vehicle_model);

-- ── Research sessions: a log of every repair lookup (best-effort analytics) ──
CREATE TABLE IF NOT EXISTS public.repair_research_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id            uuid NOT NULL REFERENCES public.shop_profiles(id) ON DELETE CASCADE,
  user_id            uuid,
  query              text,
  normalized_vehicle jsonb,
  coverage           jsonb,
  operation_lines    jsonb,
  safety_profile     jsonb,
  estimate_draft     jsonb,
  source_links       jsonb,
  manual_matches     jsonb,
  warnings           jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repair_sessions_shop_created ON public.repair_research_sessions (shop_id, created_at DESC);

-- ── RLS: on by default; scoped to the owning shop. Service-role routes bypass it. ──
ALTER TABLE public.repair_procedure_cards   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_research_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repair_cards_shop_access ON public.repair_procedure_cards;
CREATE POLICY repair_cards_shop_access ON public.repair_procedure_cards
  FOR ALL
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS repair_sessions_shop_access ON public.repair_research_sessions;
CREATE POLICY repair_sessions_shop_access ON public.repair_research_sessions
  FOR ALL
  USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
