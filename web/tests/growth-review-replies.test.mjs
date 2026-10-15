import test from 'node:test'
import assert from 'node:assert/strict'
import {
  approveReply, canMove, cleanReview, createReply, dismissReply, draftReply, listReplies, markPosted, redraftReply,
  replyFlags, reviewFlags, sanitizeDraft, saveReply, templateReply, viewOf,
} from '../src/lib/review-replies.ts'

const SHOP = { shopName: 'Northside Auto', shopPhone: '(713) 555-0188' }
const SHOP_ID = 'shop-1'

function fakeStore() {
  const rows = []
  let n = 0
  return {
    rows,
    async list(shopId) { return rows.filter(r => r.shop_id === shopId).slice().reverse() },
    async get(shopId, id) { return rows.find(r => r.shop_id === shopId && r.id === id) || null },
    async insert(row) {
      const r = { id: `r${++n}`, review_source: 'pasted', final_text: null, approved_by: null, approved_at: null, posted_at: null, status: 'draft', created_at: '2026-10-15T12:00:00Z', updated_at: '2026-10-15T12:00:00Z', ...row }
      rows.push(r)
      return r
    },
    async update(shopId, id, patch, from) {
      const r = rows.find(x => x.shop_id === shopId && x.id === id && from.includes(x.status))
      if (!r) return null
      Object.assign(r, patch)
      return r
    },
  }
}

const GOOD_REPLY = 'Marcus, thank you for the kind words about your brake job. We are glad the truck feels right, and we will see you at the next service.'
const model = text => async () => text

test('a pasted review is cleaned and a missing star rating is refused in plain words', () => {
  assert.equal(cleanReview({ rating: 5, review_text: '  Great work.  ', reviewer_name: ' Marcus   Bell ' }).value.reviewerName, 'Marcus Bell')
  assert.match(cleanReview({ rating: 0, review_text: 'x' }).error, /stars/i)
  assert.match(cleanReview({ rating: 'five' }).error, /stars/i)
  assert.equal(cleanReview({ rating: 4 }).ok, true, 'stars alone are a review')
  assert.match(cleanReview({ rating: 3, review_text: 'x'.repeat(5001) }).error, /5,000/)
})

test('low ratings and serious claims are flagged so the owner reads them first', () => {
  assert.deepEqual(reviewFlags({ reviewerName: '', rating: 5, text: 'Fast and fair.' }), [])
  assert.deepEqual(reviewFlags({ reviewerName: '', rating: 1, text: 'Awful.' }), ['low_rating'])
  assert.ok(reviewFlags({ reviewerName: '', rating: 4, text: 'They broke my mirror and I am talking to a lawyer' }).includes('serious_claim'))
})

test('the standard reply promises nothing and never uses a made-up shop name or number', () => {
  const happy = templateReply({ reviewerName: 'Dana Ruiz', rating: 5, text: 'Great' }, SHOP)
  assert.match(happy, /^Dana, thank you/)
  assert.match(happy, /Northside Auto/)
  assert.deepEqual(replyFlags(happy, { reviewerName: 'Dana', rating: 5, text: 'Great' }, SHOP), [])
  const sad = templateReply({ reviewerName: '', rating: 1, text: 'Bad' }, SHOP)
  assert.match(sad, /\(713\) 555-0188/)
  const noPhone = templateReply({ reviewerName: '', rating: 2, text: 'Bad' }, { shopName: '', shopPhone: '' })
  assert.doesNotMatch(noPhone, /undefined|\(\d{3}\)/)
  assert.match(noPhone, /contact the shop/)
})

test('replyFlags catches emoji, invented offers, someone else\'s phone number and rambling', () => {
  const review = { reviewerName: '', rating: 3, text: 'Slow but fine' }
  assert.ok(replyFlags('Thanks so much 😀', review, SHOP).includes('emoji'))
  assert.ok(replyFlags('Come back for 20% off and a free oil change.', review, SHOP).includes('offer'))
  assert.ok(replyFlags('Call us at (281) 555-0100 to talk.', review, SHOP).includes('phone'))
  assert.ok(!replyFlags('Call us at 713-555-0188 to talk.', review, SHOP).includes('phone'), 'the shop number in any format is fine')
  assert.ok(replyFlags('word '.repeat(130), review, SHOP).includes('long'))
  assert.deepEqual(replyFlags('', review, SHOP), ['empty'])
  // A price the customer mentioned may be repeated back.
  assert.ok(!replyFlags('Sorry the $450 bill felt too high.', { ...review, text: 'The $450 bill was too high' }, SHOP).includes('offer'))
})

test('model output is tidied: labels, quotes, markdown and emoji are removed', () => {
  assert.equal(sanitizeDraft('Reply: "**Thank you** for coming in 😀"'), 'Thank you for coming in')
  assert.equal(sanitizeDraft('```\nThanks!\n```'), 'Thanks!')
})

test('an AI draft that invents an offer is replaced by the plain template and marked as such', async () => {
  const review = { reviewerName: 'Marcus Bell', rating: 4, text: 'Brakes feel great' }
  const ok = await draftReply(review, SHOP, model(GOOD_REPLY))
  assert.equal(ok.by, 'ai')
  assert.equal(ok.text, GOOD_REPLY)
  const offer = await draftReply(review, SHOP, model('Thanks! Here is 15% off your next visit.'))
  assert.equal(offer.by, 'owner')
  assert.ok(offer.flags.includes('template'))
  assert.doesNotMatch(offer.text, /15%/)
  const wrongPhone = await draftReply(review, SHOP, model('Thanks Marcus. Call (832) 555-0111 any time.'))
  assert.ok(wrongPhone.flags.includes('template'))
  const broken = await draftReply(review, SHOP, async () => { throw new Error('timeout') })
  assert.ok(broken.flags.includes('template'))
  const empty = await draftReply(review, SHOP, model('   '))
  assert.ok(empty.flags.includes('template'))
  const none = await draftReply(review, SHOP, null)
  assert.ok(none.flags.includes('template'))
})

test('the whole path: draft, edit, approve, mark posted, and each step only from the right place', async () => {
  const store = fakeStore()
  const made = await createReply(store, SHOP_ID, SHOP, model(GOOD_REPLY), { rating: 5, review_text: 'Brakes feel great', reviewer_name: 'Marcus Bell' })
  assert.equal(made.status, 'draft')
  assert.equal(made.drafted_by, 'ai')
  assert.equal(made.reply, GOOD_REPLY)
  assert.match(made.status_words, /approval/i)

  assert.equal((await markPosted(store, SHOP_ID, made.id, SHOP)).status, 409, 'cannot post before approving')
  const edited = await saveReply(store, SHOP_ID, made.id, SHOP, 'Marcus, thank you. We appreciate you trusting us with your truck.')
  assert.match(edited.reply, /trusting us/)
  const approved = await approveReply(store, SHOP_ID, made.id, 'user-1', SHOP, new Date('2026-10-15T13:00:00Z'))
  assert.equal(approved.status, 'approved')
  assert.equal(store.rows[0].approved_by, 'user-1')
  assert.equal(store.rows[0].approved_at, '2026-10-15T13:00:00.000Z')

  // Editing an approved reply sends it back for approval.
  const reopened = await saveReply(store, SHOP_ID, made.id, SHOP, 'Marcus, thank you again.')
  assert.equal(reopened.status, 'draft')
  assert.equal(store.rows[0].approved_at, null)
  await approveReply(store, SHOP_ID, made.id, 'user-1', SHOP)
  const posted = await markPosted(store, SHOP_ID, made.id, SHOP, new Date('2026-10-15T14:00:00Z'))
  assert.equal(posted.status, 'posted')
  assert.equal(posted.posted_at, '2026-10-15T14:00:00.000Z')

  assert.equal((await saveReply(store, SHOP_ID, made.id, SHOP, 'new text')).status, 409, 'a posted reply is final')
  assert.equal((await dismissReply(store, SHOP_ID, made.id, SHOP)).status, 409)
  assert.equal((await redraftReply(store, SHOP_ID, made.id, SHOP, model(GOOD_REPLY))).status, 409)
})

test('another shop can never read or change a reply', async () => {
  const store = fakeStore()
  const made = await createReply(store, SHOP_ID, SHOP, null, { rating: 2, review_text: 'Not happy' })
  assert.equal((await approveReply(store, 'shop-2', made.id, 'u', SHOP)).status, 404)
  assert.equal((await dismissReply(store, 'shop-2', made.id, SHOP)).status, 404)
  assert.deepEqual(await listReplies(store, 'shop-2', SHOP), [])
  assert.equal(store.rows[0].status, 'draft')
})

test('a redraft replaces the owner\'s edits, only before approval; an empty edit is refused', async () => {
  const store = fakeStore()
  const made = await createReply(store, SHOP_ID, SHOP, null, { rating: 5, review_text: 'Great', reviewer_name: 'Dana' })
  assert.ok(made.flags.some(f => f.code === 'template'))
  await saveReply(store, SHOP_ID, made.id, SHOP, 'My own words, thank you Dana.')
  assert.equal((await saveReply(store, SHOP_ID, made.id, SHOP, '   ')).status, 400)
  const again = await redraftReply(store, SHOP_ID, made.id, SHOP, model('Dana, thank you for the five stars. We are glad we could help.'))
  assert.match(again.reply, /five stars/)
  assert.equal(store.rows[0].final_text, null)
  await approveReply(store, SHOP_ID, made.id, 'u', SHOP)
  assert.equal((await redraftReply(store, SHOP_ID, made.id, SHOP, model('x'))).status, 409)
})

test('the screen sees flags for what is written now, so fixing a reply clears its warning', async () => {
  const store = fakeStore()
  const made = await createReply(store, SHOP_ID, SHOP, null, { rating: 5, review_text: 'Great' })
  const row = store.rows[0]
  row.final_text = 'Thanks! Here is 10% off your next visit.'
  assert.ok(viewOf(row, SHOP).flags.some(f => f.code === 'offer'))
  row.final_text = 'Thanks for coming in.'
  assert.ok(!viewOf(row, SHOP).flags.some(f => f.code === 'offer'))
  assert.ok(!viewOf(row, SHOP).flags.some(f => f.code === 'template'), 'once the owner rewrites it, it is no longer the standard text')
  assert.equal(made.status, 'draft')
})

test('nothing in the reply code can post to Google', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/lib/review-replies.ts', import.meta.url), 'utf8') + readFileSync(new URL('../src/app/api/growth/review-replies/route.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /googleapis|mybusiness|business\.google|accounts\/.*\/reviews/i)
  assert.ok(canMove('posted', 'approved') && !canMove('posted', 'draft'))
})
