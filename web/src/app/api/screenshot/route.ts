import { runLive } from '@/lib/browser/engine'
import { describeRefusal, LIMITS, makeCheck, makeResourceFetcher } from '@/lib/browser/guard'
import { Gate, RenderCache } from '@/lib/browser/render-cache'
import { audit, loadShopRules, openRoute, usedToday } from '@/lib/browser/server'
import type { BrowserAudit } from '@/lib/browser/server'
import { parseTarget } from '@/lib/browser/url'

export const dynamic = 'force-dynamic'
export const maxDuration = 40

/**
 * A picture of a public page, drawn by Alpha's own locked browser. No outside screenshot service is used, so the address
 * is never sent to a third party. The same rules as the Browser page apply: public sites only, the shop's allow and block
 * lists, a daily cap, and a line in the audit log for every picture taken.
 */
const pictures = new RenderCache<Uint8Array>({ maxEntries: 24, maxBytes: 6 * 1024 * 1024, ttlMs: 10 * 60_000 })
const gate = new Gate(2)
const LIVE_EVENTS: BrowserAudit[] = ['browser.visit', 'browser.fill', 'browser.click', 'browser.sent', 'browser.approval_asked', 'browser.handoff']

function text(message: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } })
}

function decode(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  return m ? new Uint8Array(Buffer.from(m[1], 'base64')) : null
}

export async function GET(req: Request) {
  // `write: true` only turns on the "must come from our own site" check; a picture is still just a read.
  const gateway = await openRoute(req, { scope: 'live', need: 'browse', write: true })
  if (!gateway.ok) return gateway.response
  const { caller } = gateway

  const raw = new URL(req.url).searchParams.get('url') || ''
  const target = parseTarget(raw)
  if (!target.ok) return text(target.message, 400)
  const url = target.url.toString()

  const rules = await loadShopRules(caller, req)
  const refusal = describeRefusal(url, rules.ctx, 'user')
  if (refusal) {
    await audit(caller, 'browser.blocked', { url, detail: refusal })
    return text(refusal, 403)
  }

  const key = `${caller.auth.shopId}|${url}`
  const headers = { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=600', vary: 'Cookie', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline', 'content-security-policy': "default-src 'none'; sandbox" }
  const cached = pictures.get(key)
  if (cached) return new Response(Buffer.from(cached), { status: 200, headers })

  if (await usedToday(caller, LIVE_EVENTS) >= LIMITS.liveDaily) return text('This shop has used its live browsing for today. It resets tomorrow.', 429)

  try {
    const bytes = await pictures.dedupe(key, async () => {
      const leave = gate.enter()
      if (!leave) throw new Error('busy')
      try {
        const outcome = await runLive(
          { url, prepared: [], scrollY: 0, viewport: 'desktop', actor: 'user' },
          { check: makeCheck(rules.ctx, 'user'), fetchResource: makeResourceFetcher(), authorize: async () => { throw new Error('no actions here') }, timeoutMs: 28_000 },
        )
        if (outcome.status === 'error') throw new Error(outcome.code === 'blocked' ? `blocked:${outcome.message}` : 'failed')
        if (outcome.status !== 'ok') throw new Error('failed')
        const image = decode(outcome.snapshot.image)
        if (!image) throw new Error('failed')
        await audit(caller, 'browser.visit', { url: outcome.snapshot.url, detail: 'Took a picture of the page' })
        pictures.set(key, image, image.byteLength)
        return image
      } finally { leave() }
    })
    return new Response(Buffer.from(bytes), { status: 200, headers })
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    if (message === 'busy') return text('Alpha is busy taking other pictures. Try again in a few seconds.', 503, { 'retry-after': '5' })
    if (message.startsWith('blocked:')) return text(message.slice(8), 403)
    return text('A picture of that page is not available right now.', 502)
  }
}
