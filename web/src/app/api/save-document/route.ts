import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// This legacy route used to write documents directly with a service client.
// Paid or partially paid documents are financially immutable, and all document
// mutations now go through /api/ai-action so confirmation, tenant checks,
// durable idempotency, audit delivery, and payment guards cannot be bypassed.
export async function POST() {
  return NextResponse.json({
    ok: false,
    error: 'This document endpoint is retired. Use the confirmed document action.',
  }, { status: 410 })
}
