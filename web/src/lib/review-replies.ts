// Replies to Google reviews. Alpha drafts, the owner edits and approves, and the owner posts it on Google themselves.
// Nothing in this file (or anything that calls it) ever posts to Google.
//
// Pure: the route supplies the model call and the database, so every rule here is covered by tests.

import { hasEmoji, unsupportedClaims } from './automation-rules.ts'

export type ReplyStatus = 'draft' | 'approved' | 'posted' | 'dismissed'

export interface ReviewInput {
  reviewerName: string
  rating: number
  text: string
}

export interface ShopFacts {
  shopName: string
  shopPhone: string
}

const MAX_REVIEW = 5000
const MAX_REPLY = 2000

/** What the owner pasted, cleaned. A review can be a rating alone (Google lets people leave just stars). */
export function cleanReview(raw: unknown): { ok: true; value: ReviewInput } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rating = Math.round(Number(r.rating))
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return { ok: false, error: 'Choose how many stars the customer gave, from 1 to 5.' }
  const text = String(r.review_text ?? r.text ?? '').replace(/\r/g, '').trim()
  if (text.length > MAX_REVIEW) return { ok: false, error: `Keep the review under ${MAX_REVIEW.toLocaleString('en-US')} characters.` }
  const reviewerName = String(r.reviewer_name ?? r.reviewerName ?? '').trim().replace(/\s+/g, ' ').slice(0, 200)
  return { ok: true, value: { reviewerName, rating, text } }
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || ''

const SERIOUS = /\b(lawyer|attorney|sue|suing|lawsuit|police|injur(?:y|ed)|accident|crash(?:ed)?|unsafe|stolen|theft|stole|fraud|scam|ripped? off|bbb|better business|report(?:ed|ing)? (?:you|them)|damage[sd]?|broke|broken|never fixed|overcharg\w*)\b/i

/** Reasons the owner should read this one themselves before replying. */
export function reviewFlags(review: ReviewInput): string[] {
  const flags: string[] = []
  if (review.rating <= 2) flags.push('low_rating')
  if (SERIOUS.test(review.text)) flags.push('serious_claim')
  return flags
}

export const FLAG_WORDS: Record<string, string> = {
  low_rating: 'Low rating. Read the review yourself and make sure the reply fits what happened.',
  serious_claim: 'The review mentions damage, money, safety or the law. Check the facts before replying, and do not admit fault in public.',
  template: 'Written from a standard template because no AI key is set. Add the details that fit this customer.',
  emoji: 'The reply has an emoji. Remove it.',
  offer: 'The reply promises a price, discount or guarantee. Remove it unless you mean it.',
  phone: 'The reply has a phone number that is not your shop number.',
  long: 'The reply is long. Google replies read best at a few sentences.',
  empty: 'The reply is empty.',
}

export const flagWords = (code: string): string => FLAG_WORDS[code] || code

export function replySystemPrompt(shop: ShopFacts): string {
  const name = shop.shopName || 'the shop'
  return [
    `You write a short public reply to a Google review, from the owner of ${name}, an independent auto repair shop.`,
    'Rules:',
    '- Three to five sentences, under 90 words. Plain, warm, professional. No emoji, no hashtags, no exclamation-mark pile-ups.',
    '- Use only facts that are in the review. Never invent what work was done, a price, a discount, a refund, a guarantee, a warranty, a name or a date.',
    '- Thank the customer by first name when it is given.',
    shop.shopPhone
      ? `- For a complaint, apologise that the visit fell short, do not argue or admit fault, and invite them to call ${shop.shopPhone} so it can be made right.`
      : '- For a complaint, apologise that the visit fell short, do not argue or admit fault, and invite them to contact the shop directly.',
    '- Never mention a staff member by name unless the review does.',
    '- Output only the reply text, with no quotes, no label and no signature line.',
  ].join('\n')
}

export function replyUserPrompt(review: ReviewInput): string {
  const who = firstName(review.reviewerName)
  return [
    who ? `Reviewer first name: ${who}` : 'Reviewer name: not given',
    `Stars: ${review.rating} of 5`,
    review.text ? `Review text:\n"""\n${review.text}\n"""` : 'The customer left stars only, with no text.',
  ].join('\n')
}

/** Used when no AI key is set or the AI cannot be reached. Plain, safe words that promise nothing. */
export function templateReply(review: ReviewInput, shop: ShopFacts): string {
  const who = firstName(review.reviewerName)
  const hi = who ? `${who}, thank you` : 'Thank you'
  const name = shop.shopName || 'our shop'
  if (review.rating >= 4) {
    return `${hi} for taking the time to leave a review. We are glad you had a good experience at ${name}, and we look forward to seeing you again.`
  }
  if (review.rating === 3) {
    return `${hi} for your feedback. We want every visit to be a great one, and we are taking what you said seriously. ${shop.shopPhone ? `If you would like to talk it over, please call us at ${shop.shopPhone}.` : 'If you would like to talk it over, please contact the shop directly.'}`
  }
  return `${who ? `${who}, we` : 'We'} are sorry your visit did not go the way it should have. We would like to understand what happened and make it right. ${shop.shopPhone ? `Please call us at ${shop.shopPhone}` : 'Please contact the shop directly'} so we can talk it through.`
}

/** Tidy what a model returned: no quotes, labels, markdown or emoji. */
export function sanitizeDraft(raw: unknown): string {
  let t = String(raw ?? '').replace(/\r/g, '').trim()
  t = t.replace(/^```[a-z]*\n?|```$/gim, '').trim()
  t = t.replace(/^(?:reply|response|draft)\s*:\s*/i, '')
  t = t.replace(/^["“”']+|["“”']+$/g, '').trim()
  t = t.replace(/\*\*|__|^#+\s*/gm, '')
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim()
  return t.slice(0, MAX_REPLY)
}

const digits = (v: string): string => v.replace(/\D/g, '')

/**
 * Problems with a reply, whoever wrote it. These are warnings the owner sees beside the text, in plain words.
 * `facts` are things the reply may say (the review itself and the shop's own details).
 */
export function replyFlags(reply: string, review: ReviewInput, shop: ShopFacts): string[] {
  const out: string[] = []
  const text = reply.trim()
  if (!text) return ['empty']
  if (hasEmoji(text)) out.push('emoji')
  if (unsupportedClaims(text, review.text, shop.shopPhone, shop.shopName).length) out.push('offer')
  const shopDigits = digits(shop.shopPhone).slice(-10)
  for (const m of text.matchAll(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g)) {
    if (!shopDigits || digits(m[0]).slice(-10) !== shopDigits) { out.push('phone'); break }
  }
  if ([...text.matchAll(/\S+/g)].length > 120) out.push('long')
  return out
}

export interface ModelCall { (system: string, user: string): Promise<string> }

export interface Drafted {
  text: string
  by: 'ai' | 'owner'
  flags: string[]
}

/**
 * Draft a reply. The model's words are used only when they pass the checks; otherwise the plain template is used
 * and marked as such, so a bad AI answer never reaches the owner as if it were fine.
 */
export async function draftReply(review: ReviewInput, shop: ShopFacts, model: ModelCall | null): Promise<Drafted> {
  const base = reviewFlags(review)
  const fallback = (): Drafted => ({ text: templateReply(review, shop), by: 'owner', flags: [...base, 'template'] })
  if (!model) return fallback()
  let raw = ''
  try {
    raw = sanitizeDraft(await model(replySystemPrompt(shop), replyUserPrompt(review)))
  } catch {
    return fallback()
  }
  if (!raw) return fallback()
  const problems = replyFlags(raw, review, shop).filter(f => f === 'offer' || f === 'phone' || f === 'empty')
  if (problems.length) return fallback()
  return { text: raw, by: 'ai', flags: [...base, ...replyFlags(raw, review, shop)] }
}

// ── Moving a reply along ──────────────────────────────────────────────────

/** Which statuses a reply may move from, for each action. */
export const MOVES: Record<'save' | 'approve' | 'posted' | 'dismiss' | 'redraft', ReplyStatus[]> = {
  save: ['draft', 'approved'],
  redraft: ['draft'],
  approve: ['draft', 'approved'],
  posted: ['approved'],
  dismiss: ['draft', 'approved'],
}

export function canMove(action: keyof typeof MOVES, from: string): boolean {
  return MOVES[action].includes(from as ReplyStatus)
}

export const STATUS_WORDS: Record<ReplyStatus, string> = {
  draft: 'Needs your approval',
  approved: 'Approved. Post it on Google',
  posted: 'Posted on Google',
  dismissed: 'Set aside',
}

// ── Storage and the steps an owner takes ──────────────────────────────────

export interface ReplyRow {
  id: string
  shop_id: string
  reviewer_name: string | null
  rating: number
  review_text: string
  review_source: 'pasted' | 'google'
  draft_text: string
  final_text: string | null
  drafted_by: 'ai' | 'owner'
  flags: string[]
  status: ReplyStatus
  approved_by: string | null
  approved_at: string | null
  posted_at: string | null
  created_at: string
  updated_at: string
}

export interface ReplyStore {
  list(shopId: string): Promise<ReplyRow[]>
  get(shopId: string, id: string): Promise<ReplyRow | null>
  insert(row: Pick<ReplyRow, 'shop_id' | 'reviewer_name' | 'rating' | 'review_text' | 'draft_text' | 'drafted_by' | 'flags'>): Promise<ReplyRow>
  /** Changes a reply only while it is in one of the `from` statuses. Null when someone else moved it first. */
  update(shopId: string, id: string, patch: Partial<Pick<ReplyRow, 'draft_text' | 'final_text' | 'drafted_by' | 'flags' | 'status' | 'approved_by' | 'approved_at' | 'posted_at'>>, from: ReplyStatus[]): Promise<ReplyRow | null>
}

export type Failure = { ok: false; status: number; error: string }
const fail = (status: number, error: string): Failure => ({ ok: false, status, error })

export const textOf = (row: Pick<ReplyRow, 'draft_text' | 'final_text'>): string => (row.final_text ?? row.draft_text) || ''

const reviewOf = (row: ReplyRow): ReviewInput => ({ reviewerName: row.reviewer_name || '', rating: row.rating, text: row.review_text })

export interface ReplyView {
  id: string
  reviewer_name: string
  rating: number
  review_text: string
  reply: string
  drafted_by: 'ai' | 'owner'
  status: ReplyStatus
  status_words: string
  flags: Array<{ code: string; words: string }>
  approved_at: string | null
  posted_at: string | null
  created_at: string
}

export function viewOf(row: ReplyRow, shop: ShopFacts): ReplyView {
  // Flags are worked out again from what is written now, so editing the reply clears the ones that no longer apply.
  const live = new Set([...reviewFlags(reviewOf(row)), ...replyFlags(textOf(row), reviewOf(row), shop)])
  if (row.flags?.includes('template') && row.final_text === null) live.add('template')
  return {
    id: row.id,
    reviewer_name: row.reviewer_name || '',
    rating: row.rating,
    review_text: row.review_text,
    reply: textOf(row),
    drafted_by: row.drafted_by,
    status: row.status,
    status_words: STATUS_WORDS[row.status] || row.status,
    flags: [...live].map(code => ({ code, words: flagWords(code) })),
    approved_at: row.approved_at,
    posted_at: row.posted_at,
    created_at: row.created_at,
  }
}

export async function listReplies(store: ReplyStore, shopId: string, shop: ShopFacts): Promise<ReplyView[]> {
  return (await store.list(shopId)).map(r => viewOf(r, shop))
}

export async function createReply(store: ReplyStore, shopId: string, shop: ShopFacts, model: ModelCall | null, raw: unknown): Promise<ReplyView | Failure> {
  const cleaned = cleanReview(raw)
  if (!cleaned.ok) return fail(400, cleaned.error)
  const review = cleaned.value
  const drafted = await draftReply(review, shop, model)
  const row = await store.insert({
    shop_id: shopId,
    reviewer_name: review.reviewerName || null,
    rating: review.rating,
    review_text: review.text,
    draft_text: drafted.text,
    drafted_by: drafted.by,
    flags: drafted.flags,
  })
  return viewOf(row, shop)
}

/** Write a fresh draft. The owner's earlier edits are replaced, so this only works before approval. */
export async function redraftReply(store: ReplyStore, shopId: string, id: string, shop: ShopFacts, model: ModelCall | null): Promise<ReplyView | Failure> {
  const row = await store.get(shopId, id)
  if (!row) return fail(404, 'That review was not found.')
  if (!canMove('redraft', row.status)) return fail(409, 'This reply was already approved or set aside, so it cannot be rewritten.')
  const drafted = await draftReply(reviewOf(row), shop, model)
  const next = await store.update(shopId, id, { draft_text: drafted.text, final_text: null, drafted_by: drafted.by, flags: drafted.flags }, MOVES.redraft)
  return next ? viewOf(next, shop) : fail(409, 'Someone changed this reply first. Reload and try again.')
}

/** The owner's own wording. Editing an approved reply sends it back for approval. */
export async function saveReply(store: ReplyStore, shopId: string, id: string, shop: ShopFacts, text: unknown): Promise<ReplyView | Failure> {
  const t = sanitizeDraft(text)
  if (!t) return fail(400, 'Write the reply first.')
  const row = await store.get(shopId, id)
  if (!row) return fail(404, 'That review was not found.')
  if (!canMove('save', row.status)) return fail(409, 'This reply was already posted or set aside, so it cannot be edited.')
  const next = await store.update(shopId, id, { final_text: t, status: 'draft', approved_by: null, approved_at: null }, MOVES.save)
  return next ? viewOf(next, shop) : fail(409, 'Someone changed this reply first. Reload and try again.')
}

export async function approveReply(store: ReplyStore, shopId: string, id: string, userId: string | null, shop: ShopFacts, now: Date = new Date()): Promise<ReplyView | Failure> {
  const row = await store.get(shopId, id)
  if (!row) return fail(404, 'That review was not found.')
  if (!canMove('approve', row.status)) return fail(409, 'This reply was already posted or set aside.')
  if (!textOf(row).trim()) return fail(400, 'Write the reply first.')
  const next = await store.update(shopId, id, { status: 'approved', approved_by: userId, approved_at: now.toISOString() }, MOVES.approve)
  return next ? viewOf(next, shop) : fail(409, 'Someone changed this reply first. Reload and try again.')
}

/** The owner says they pasted it into Google. Alpha cannot check, and never posts it for them. */
export async function markPosted(store: ReplyStore, shopId: string, id: string, shop: ShopFacts, now: Date = new Date()): Promise<ReplyView | Failure> {
  const row = await store.get(shopId, id)
  if (!row) return fail(404, 'That review was not found.')
  if (!canMove('posted', row.status)) return fail(409, 'Approve the reply first, then post it on Google.')
  const next = await store.update(shopId, id, { status: 'posted', posted_at: now.toISOString() }, MOVES.posted)
  return next ? viewOf(next, shop) : fail(409, 'Someone changed this reply first. Reload and try again.')
}

export async function dismissReply(store: ReplyStore, shopId: string, id: string, shop: ShopFacts): Promise<ReplyView | Failure> {
  const row = await store.get(shopId, id)
  if (!row) return fail(404, 'That review was not found.')
  if (!canMove('dismiss', row.status)) return fail(409, 'This reply was already posted or set aside.')
  const next = await store.update(shopId, id, { status: 'dismissed' }, MOVES.dismiss)
  return next ? viewOf(next, shop) : fail(409, 'Someone changed this reply first. Reload and try again.')
}
