import { describeRefusal } from '@/lib/browser/guard'
import { createPairing, enqueueCommand, getCommand, listHosts, revokeHost, validateCommand, PAIRING_MINUTES, PROTOCOL_VERSION } from '@/lib/browser/host-store'
import { audit, loadShopRules, openRoute, problem, readJson, reply } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'

/** The computers paired with this shop, and (with ?command=) how one request to a computer is going. */
export async function GET(req: Request) {
  const gate = await openRoute(req, { scope: 'host', need: 'browse' })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const commandId = new URL(req.url).searchParams.get('command')
  if (commandId) {
    if (!caller.canAct) return problem('Your role can look at pages but not use a connected computer.', 403)
    const cmd = await getCommand(caller.db, caller.auth.shopId, commandId)
    return cmd ? reply({ ok: true, command: cmd }) : problem('That request was not found.', 404)
  }
  const list = await listHosts(caller.db, caller.auth.shopId)
  return reply({ ok: true, items: list.items, missing: list.missing, protocol: PROTOCOL_VERSION, pairingMinutes: PAIRING_MINUTES })
}

export async function POST(req: Request) {
  const body = await readJson(req) as { action?: unknown; name?: unknown; hostId?: unknown; kind?: unknown; payload?: unknown } | null
  if (!body || typeof body.action !== 'string') return problem('That request was not understood.', 400)
  const manage = body.action === 'pair' || body.action === 'revoke'
  const gate = await openRoute(req, { scope: 'host', need: manage ? 'manage' : 'act', write: true })
  if (!gate.ok) return gate.response
  const { caller } = gate

  if (body.action === 'pair') {
    const made = await createPairing(caller.db, caller.auth.shopId, caller.auth.userId, typeof body.name === 'string' ? body.name : '')
    if (!made.ok) return problem(made.error, made.missing ? 409 : 500, { needsUpdate: made.missing })
    await audit(caller, 'browser.host', { detail: 'Started pairing a computer' })
    return reply({ ok: true, hostId: made.hostId, code: made.code, expiresAt: made.expiresAt })
  }
  if (body.action === 'revoke') {
    if (typeof body.hostId !== 'string') return problem('That computer was not found.', 400)
    const done = await revokeHost(caller.db, caller.auth.shopId, body.hostId)
    if (!done.ok) return problem(done.error, done.missing ? 409 : 404, { needsUpdate: done.missing })
    await audit(caller, 'browser.host', { detail: 'Disconnected a computer' })
    return reply({ ok: true })
  }
  if (body.action === 'command') {
    if (typeof body.hostId !== 'string') return problem('Pick a computer.', 400)
    const rules = await loadShopRules(caller, req)
    const valid = validateCommand(body.kind, body.payload, url => describeRefusal(url, rules.ctx, 'user'))
    if (!valid.ok) return problem(valid.error, 400)
    const queued = await enqueueCommand(caller.db, caller.auth.shopId, caller.auth.userId, body.hostId, valid)
    if (!queued.ok) return problem(queued.error, queued.missing ? 409 : 400, { needsUpdate: queued.missing })
    await audit(caller, 'browser.host', { url: valid.kind === 'open' ? String(valid.payload.url) : undefined, detail: `Asked a connected computer to ${valid.kind === 'open' ? 'open a page' : valid.kind}` })
    return reply({ ok: true, commandId: queued.id })
  }
  return problem('That request was not understood.', 400)
}
