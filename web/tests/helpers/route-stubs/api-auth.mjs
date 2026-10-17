// The signed-in shop for a route test comes from globalThis.__routeAuth (null means signed out).
export async function getAuthedShop() { return globalThis.__routeAuth ?? null }
export const unauthorized = () => new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } })
export const forbidden = () => new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } })
