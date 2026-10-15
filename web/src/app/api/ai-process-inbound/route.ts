/**
 * Retired. Phone calls are now handled entirely inside /api/calls/webhook (the receptionist in src/lib/voice), which keeps the
 * shop's rules, tells callers they are speaking with an AI assistant, and never invents prices. This route used to be a second,
 * separate call-handling path with its own wording; leaving it live would let it bypass those rules.
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const GONE = { ok: false, error: 'This route has been retired. Calls are handled by the call webhook.' }

export async function POST() { return NextResponse.json(GONE, { status: 410 }) }
export async function GET() { return NextResponse.json(GONE, { status: 410 }) }
