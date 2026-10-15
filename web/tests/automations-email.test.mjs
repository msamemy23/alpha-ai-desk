import test from 'node:test'
import assert from 'node:assert/strict'

process.env.UNSUBSCRIBE_SECRET = 'test-secret-for-unsubscribe-links'
const email = await import('../src/lib/marketing-email.ts')
const token = await import('../src/lib/unsubscribe-token.ts')
const { unsubscribePage } = await import('../src/lib/unsubscribe-page.ts')

const footer = { shopName: 'Bayou City Garage', address: '1200 Main St, Houston, TX 77002', phone: '(713) 555-0188', unsubscribe: 'https://app.example.com/api/outreach/unsubscribe?t=abc' }

test('a marketing email names the shop, shows its address and has a visible unsubscribe link', () => {
  const html = email.emailHtml('Hi Sam,\n\nYour oil change is due.', footer)
  assert.match(html, /Bayou City Garage/)
  assert.match(html, /1200 Main St, Houston, TX 77002/)
  assert.match(html, /href="https:\/\/app\.example\.com\/api\/outreach\/unsubscribe\?t=abc"/)
  assert.match(html, /Unsubscribe/)
  const text = email.emailPlainText('Hi Sam,\n\nYour oil change is due.', footer)
  assert.match(text, /1200 Main St/)
  assert.match(text, /unsubscribe\?t=abc/)
})

test('text from a customer or a draft can never inject markup into the email', () => {
  const html = email.emailHtml('<script>alert(1)</script> & "quotes"', { ...footer, shopName: 'Bob <b>& Sons' })
  assert.doesNotMatch(html, /<script>/)
  assert.doesNotMatch(html, /<b>/)
  assert.match(html, /&lt;script&gt;/)
})

test('the send carries the one-click unsubscribe headers and an idempotency key', async () => {
  let seen
  const fetcher = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }) }
  const r = await email.sendResendEmail({ apiKey: 'k', from: 'shop@example.com', to: 'sam@example.com', subject: 'Hi', html: '<p>x</p>', text: 'x', unsubscribeUrl: footer.unsubscribe, idempotencyKey: 'am:1' }, fetcher)
  assert.equal(r.id, 'em_1')
  assert.equal(seen.url, 'https://api.resend.com/emails')
  assert.equal(seen.init.headers['Idempotency-Key'], 'am:1')
  assert.equal(seen.body.headers['List-Unsubscribe'], `<${footer.unsubscribe}>`)
  assert.equal(seen.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
  assert.deepEqual(seen.body.to, ['sam@example.com'])
})

test('a service email has no unsubscribe headers', async () => {
  let body
  const fetcher = async (_u, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ id: 'em_2' }), { status: 200 }) }
  await email.sendResendEmail({ apiKey: 'k', from: 'a@b.co', to: 'c@d.co', subject: 's', html: 'h' }, fetcher)
  assert.equal(body.headers, undefined)
})

test('a refused or unreachable email says why, in the error', async () => {
  const refuse = async () => new Response(JSON.stringify({ message: 'The to field must be a valid email address' }), { status: 422 })
  await assert.rejects(email.sendResendEmail({ apiKey: 'k', from: 'a@b.co', to: 'nope', subject: 's', html: 'h' }, refuse), e => e instanceof email.EmailSendError && e.status === 422 && /valid email/.test(e.message))
  const down = async () => { throw new Error('socket hang up') }
  await assert.rejects(email.sendResendEmail({ apiKey: 'k', from: 'a@b.co', to: 'c@d.co', subject: 's', html: 'h' }, down), e => e instanceof email.EmailSendError && e.status === null)
})

// A tiny stand-in for the database: one table of opt-outs, or an error.
function fakeDb({ rows = [], error = null } = {}) {
  const store = [...rows]
  const q = (table) => {
    const state = { filters: {} }
    const api = {
      select: () => api,
      eq: (k, v) => { state.filters[k] = v; return api },
      maybeSingle: async () => {
        if (error) return { data: null, error }
        return { data: store.find(r => Object.entries(state.filters).every(([k, v]) => r[k] === v)) || null, error: null }
      },
      upsert: async (row) => { if (error) return { error }; if (!store.some(r => r.shop_id === row.shop_id && r.email_lower === row.email_lower)) store.push(row); return { error: null } },
      delete: () => ({ eq: (k1, v1) => ({ eq: async (k2, v2) => { const i = store.findIndex(r => r[k1] === v1 && r[k2] === v2); if (i >= 0) store.splice(i, 1); return { error: null } } }) }),
    }
    return api
  }
  return { from: q, store }
}

test('the opt-out list is checked case-insensitively and shop by shop', async () => {
  const db = fakeDb({ rows: [{ shop_id: 's1', email_lower: 'sam@example.com' }] })
  assert.equal(await email.isEmailOptedOut(db, 's1', ' Sam@Example.com '), true)
  assert.equal(await email.isEmailOptedOut(db, 's2', 'sam@example.com'), false)
  await email.recordEmailOptOut(db, 's2', 'New@Example.com', 'link')
  assert.equal(await email.isEmailOptedOut(db, 's2', 'new@example.com'), true)
  await email.removeEmailOptOut(db, 's2', 'new@example.com')
  assert.equal(await email.isEmailOptedOut(db, 's2', 'new@example.com'), false)
})

test('when consent cannot be checked, or the opt-out table is missing, a strict check refuses instead of guessing', async () => {
  const broken = fakeDb({ error: { code: '500', message: 'boom' } })
  await assert.rejects(email.isEmailOptedOut(broken, 's1', 'a@b.co'), /could not be checked/)
  const missing = fakeDb({ error: { code: '42P01', message: 'relation "email_opt_outs" does not exist' } })
  assert.equal(await email.isEmailOptedOut(missing, 's1', 'a@b.co'), false)
  await assert.rejects(email.isEmailOptedOut(missing, 's1', 'a@b.co', { strict: true }), /database update/)
})

test('an address is masked on the unsubscribe page', () => {
  assert.equal(email.maskEmail('sam@example.com'), 's**@example.com')
  assert.equal(email.maskEmail('not an email'), '')
})

test('an unsubscribe link only works for the address and shop it was made for', () => {
  const t = token.createUnsubscribeToken('shop-1', 'Sam@Example.com')
  assert.deepEqual(token.verifyUnsubscribeToken(t), { shopId: 'shop-1', email: 'sam@example.com' })
  const [payload, sig] = t.split('.')
  const other = Buffer.from(JSON.stringify({ s: 'shop-1', e: 'victim@example.com' })).toString('base64url')
  assert.equal(token.verifyUnsubscribeToken(`${other}.${sig}`), null)
  assert.equal(token.verifyUnsubscribeToken(`${payload}.${sig.slice(0, -2)}xx`), null)
  assert.equal(token.verifyUnsubscribeToken('garbage'), null)
  assert.equal(token.verifyUnsubscribeToken(undefined), null)
  assert.match(token.unsubscribeUrl('https://app.example.com/', t), /^https:\/\/app\.example\.com\/api\/outreach\/unsubscribe\?t=/)
})

test('the unsubscribe page asks first, confirms after, and offers to undo', () => {
  const ask = unsubscribePage({ state: 'confirm', shopName: 'Bayou City Garage', email: 's**@example.com', token: 'tok' })
  assert.match(ask, /method="post"/)
  assert.match(ask, /name="t" value="tok"/)
  assert.match(ask, /name="action" value="unsubscribe"/)
  const done = unsubscribePage({ state: 'done', shopName: 'Bayou City Garage', email: 's**@example.com', token: 'tok' })
  assert.match(done, /will not email/)
  assert.match(done, /name="action" value="resubscribe"/)
  const bad = unsubscribePage({ state: 'invalid' })
  assert.doesNotMatch(bad, /<form/)
})

test('a hostile shop name or token cannot break out of the page', () => {
  const page = unsubscribePage({ state: 'confirm', shopName: '<img src=x onerror=alert(1)>', email: 'a**@b.co', token: '"><script>x</script>' })
  assert.doesNotMatch(page, /<img src=x/)
  assert.doesNotMatch(page, /<script>x/)
})
