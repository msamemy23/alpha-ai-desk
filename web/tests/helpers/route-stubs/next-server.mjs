// A small stand-in for next/server so a route handler can be called directly in a test.
export class NextRequest extends Request {
  constructor(input, init) { super(input, init); this.nextUrl = new URL(typeof input === 'string' ? input : input.url) }
}
export const NextResponse = {
  json(body, init = {}) {
    return new Response(JSON.stringify(body), { status: init.status || 200, headers: { 'content-type': 'application/json', ...(init.headers || {}) } })
  },
}
