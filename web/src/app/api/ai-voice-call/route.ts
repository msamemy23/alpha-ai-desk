// Compatibility alias. There is one call-start implementation so the AI
// voice entry point cannot drift from the normal call path's auth, recording,
// durable idempotency, audit, and uncertain-outcome handling.
export { POST } from '@/app/api/make-call/route'

export const dynamic = 'force-dynamic'
