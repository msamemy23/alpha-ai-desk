import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''

export async function POST(_req: NextRequest) {
  // Create connectors table via Supabase direct SQL
  // We do this by inserting and catching errors — actual table creation
  // happens through the Supabase management API or manually
  // This endpoint seeds initial connector rows if the table exists
  const services = ['facebook', 'instagram', 'google_business', 'google_calendar']

  const results = []
  for (const service of services) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/connectors`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify({ service, enabled: false }),
    })
    const d = await r.json()
    results.push({ service, status: r.status, data: d })
  }

  return NextResponse.json({ ok: true, results })
}

export async function GET() {
  // Return SQL to run in Supabase dashboard
  const sql = `
CREATE TABLE IF NOT EXISTS connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  page_id TEXT,
  page_access_token TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE connectors DISABLE ROW LEVEL SECURITY;

INSERT INTO connectors (service, enabled) VALUES
  ('facebook', false),
  ('instagram', false),
  ('google_business', false),
  ('google_calendar', false)
ON CONFLICT (service) DO NOTHING;
`
  return NextResponse.json({ sql })
}
