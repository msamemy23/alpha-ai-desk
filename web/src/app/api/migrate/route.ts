import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

// One-time migration to add missing columns to Supabase tables.
// Gated: requires the x-admin-secret header (and ADMIN_SECRET to be set).
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([^.]+)/)?.[1]

  if (!serviceKey || !projectRef) {
    return NextResponse.json({ error: 'Missing env vars' }, { status: 500 })
  }

  const queries = [
    "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS sentiment text DEFAULT 'neutral'",
    "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS last_contact timestamptz",
    "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS review_requested timestamptz",
    "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS vehicle_color text DEFAULT ''",
    "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS vehicle_engine text DEFAULT ''",
    "ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS technicians jsonb DEFAULT '[]'::jsonb",
    "ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS labor_rate numeric DEFAULT 125",
    "ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS tax_rate numeric DEFAULT 8.25",
    "CREATE TABLE IF NOT EXISTS public.time_clock (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, employee text NOT NULL, clock_in timestamptz NOT NULL, clock_out timestamptz, date date NOT NULL DEFAULT CURRENT_DATE, hours numeric, created_at timestamptz DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS public.signatures (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE, customer_email text, signer_name text, signature_data text, ip_address text, expires_at timestamptz, signed_at timestamptz, created_at timestamptz DEFAULT now())",
    "CREATE INDEX IF NOT EXISTS idx_signatures_token ON public.signatures(token)",
    "CREATE INDEX IF NOT EXISTS idx_signatures_document_id ON public.signatures(document_id)",
    "ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS signature_requested_at timestamptz",
    "ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS signature_signed_at timestamptz",
    "ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS signature_signer_name text",
    "ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS line_items jsonb DEFAULT '[]'::jsonb",
    "CREATE TABLE IF NOT EXISTS public.repair_procedure_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES public.shop_profiles(id) ON DELETE CASCADE, title text NOT NULL, status text NOT NULL DEFAULT 'draft', confidence text NOT NULL DEFAULT 'needs_review', vehicle_year text, vehicle_make text, vehicle_model text, vehicle_engine text, vehicle_trim text, vehicle_drivetrain text, vehicle_transmission text, vehicle_brake_system text, operation text NOT NULL, systems text[] DEFAULT '{}', tools text[] DEFAULT '{}', parts_fluids text[] DEFAULT '{}', safety_gates jsonb DEFAULT '[]'::jsonb, operation_lines jsonb DEFAULT '[]'::jsonb, source_links jsonb DEFAULT '[]'::jsonb, technician_notes text DEFAULT '', approved_by text, approved_at timestamptz, version integer NOT NULL DEFAULT 1, created_by uuid, updated_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS public.repair_research_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES public.shop_profiles(id) ON DELETE CASCADE, user_id uuid, query text NOT NULL, normalized_vehicle jsonb DEFAULT '{}'::jsonb, coverage jsonb DEFAULT '{}'::jsonb, operation_lines jsonb DEFAULT '[]'::jsonb, safety_profile jsonb DEFAULT '{}'::jsonb, estimate_draft jsonb DEFAULT '{}'::jsonb, source_links jsonb DEFAULT '[]'::jsonb, manual_matches jsonb DEFAULT '[]'::jsonb, warnings text[] DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE INDEX IF NOT EXISTS idx_repair_procedure_cards_shop_vehicle ON public.repair_procedure_cards(shop_id, vehicle_year, vehicle_make, vehicle_model)",
    "CREATE INDEX IF NOT EXISTS idx_repair_research_sessions_shop_created ON public.repair_research_sessions(shop_id, created_at DESC)",
    "ALTER TABLE public.repair_procedure_cards ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE public.repair_research_sessions ENABLE ROW LEVEL SECURITY",
    "DROP POLICY IF EXISTS repair_procedure_cards_shop_select ON public.repair_procedure_cards",
    "CREATE POLICY repair_procedure_cards_shop_select ON public.repair_procedure_cards FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()))",
    "DROP POLICY IF EXISTS repair_procedure_cards_shop_insert ON public.repair_procedure_cards",
    "CREATE POLICY repair_procedure_cards_shop_insert ON public.repair_procedure_cards FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()))",
    "DROP POLICY IF EXISTS repair_procedure_cards_shop_update ON public.repair_procedure_cards",
    "CREATE POLICY repair_procedure_cards_shop_update ON public.repair_procedure_cards FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid())) WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()))",
    "DROP POLICY IF EXISTS repair_research_sessions_shop_select ON public.repair_research_sessions",
    "CREATE POLICY repair_research_sessions_shop_select ON public.repair_research_sessions FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()))",
    "DROP POLICY IF EXISTS repair_research_sessions_shop_insert ON public.repair_research_sessions",
    "CREATE POLICY repair_research_sessions_shop_insert ON public.repair_research_sessions FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()))",
    // ── 006: security + performance + payments/cache/reminders ──
    "CREATE INDEX IF NOT EXISTS idx_messages_shop_id ON public.messages(shop_id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_customer_id ON public.messages(customer_id)",
    "CREATE INDEX IF NOT EXISTS idx_documents_shop_id ON public.documents(shop_id)",
    "CREATE INDEX IF NOT EXISTS idx_documents_shop_type_status ON public.documents(shop_id, type, status)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_shop_status ON public.jobs(shop_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_shop_start ON public.appointments(shop_id, start_time)",
    "CREATE TABLE IF NOT EXISTS public.repair_manual_cache (url text PRIMARY KEY, html text NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now())",
    "ALTER TABLE public.repair_manual_cache ENABLE ROW LEVEL SECURITY",
    "CREATE TABLE IF NOT EXISTS public.payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE, amount numeric NOT NULL, method text NOT NULL DEFAULT 'cash', note text DEFAULT '', paid_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now())",
    "CREATE INDEX IF NOT EXISTS idx_payments_document_id ON public.payments(document_id)",
    "CREATE INDEX IF NOT EXISTS idx_payments_shop_paid_at ON public.payments(shop_id, paid_at DESC)",
    "ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY",
    "DROP POLICY IF EXISTS payments_shop_all ON public.payments",
    "CREATE POLICY payments_shop_all ON public.payments FOR ALL USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid())) WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()))",
    "ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz",
    "ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS approved_at timestamptz",
    "ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS approved_by text",
  ]

  const results: Record<string, string> = {}
  for (const q of queries) {
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      })
      const label = q.substring(0, 60)
      results[label] = res.ok ? 'ok' : `error ${res.status}`
    } catch (e) {
      results[q.substring(0, 60)] = `exception: ${(e as Error).message}`
    }
  }

  return NextResponse.json({ ok: true, results })
}
