import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

// Schema changes belong in the versioned web/supabase/migrations tree. This
// guarded route remains only so old operator links fail clearly; it cannot run
// the obsolete schema snapshot that previously lived here.
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req)
  if (denied) return denied

  return NextResponse.json({
    ok: false,
    error: 'This migration endpoint is retired. Apply the canonical migrations from web/supabase/migrations.',
  }, { status: 410 })
}
