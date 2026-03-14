import { NextResponse } from 'next/server'

// Web automation has been removed. Use /api/ai-search for all search needs.
export async function POST() {
  return NextResponse.json(
    { ok: false, error: 'Web automation removed. Use /api/ai-search instead.' },
    { status: 410 }
  )
}
