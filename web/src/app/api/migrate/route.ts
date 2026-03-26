import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// One-time migration to add missing columns to Supabase tables
// Call GET /api/migrate to run
export async function GET() {
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