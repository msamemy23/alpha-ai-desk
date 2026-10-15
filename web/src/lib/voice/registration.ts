/**
 * Getting a shop's texting number approved by the carriers.
 *
 * US carriers block business texts from numbers that are not registered. There are two ways:
 *   - a local number goes through "10DLC" registration (a brand, then a campaign);
 *   - a toll-free number goes through toll-free verification (one form).
 * Both are done by the shop owner in the Telnyx portal, and approval takes days. This file lists the steps in plain words,
 * works out how far along the shop is, and writes the answers they will paste into the forms, from the shop's own settings.
 * Nothing here talks to Telnyx and nothing here blocks the app: until approved, texts may be filtered by carriers.
 */
import { helpReply, OPT_OUT_LINE, prettyPhone, shopWord, startReply } from './prompt.ts'
import type { ShopProfile } from './prompt.ts'
import type { VoiceRules } from './rules.ts'

export type RegPath = 'unsure' | '10dlc' | 'toll_free'
export type RegStatus = 'not_started' | 'in_progress' | 'submitted' | 'approved' | 'rejected'

export const REG_PATHS: { value: RegPath; label: string; hint: string }[] = [
  { value: '10dlc', label: 'Local number (10DLC)', hint: 'A regular local number, like 713 or 832. Two parts: register your business, then your texting. Usually takes 1 to 3 weeks.' },
  { value: 'toll_free', label: 'Toll-free number', hint: 'A number starting 800, 833, 844, 855, 866, 877 or 888. One form. Usually takes 1 to 3 weeks.' },
]

export interface RegItem {
  id: string
  title: string
  help: string
  /** Done by the app: the answer comes from settings, not from a checkbox. */
  auto?: boolean
  /** Only for these paths. Empty means every path. */
  paths?: RegPath[]
  /** What you do after you have submitted: wait. Shown differently. */
  wait?: boolean
}

export const REG_ITEMS: RegItem[] = [
  { id: 'number', title: 'Texting number is saved here', help: 'Your Telnyx key and the number you text from are saved in Settings, under Communications.', auto: true },
  { id: 'profile', title: 'Messaging profile is saved here', help: 'Telnyx groups your number under a messaging profile. Its ID goes in Settings, under Communications.', auto: true },
  { id: 'webhook', title: 'Telnyx sends incoming texts to this app', help: 'In Telnyx, open your messaging profile and paste the address shown under Communications as the webhook address. Then send yourself a text and check it shows up in the inbox.' },
  { id: 'business', title: 'Business details are ready', help: 'Have these in front of you: legal business name, tax ID (EIN), street address, website, and a contact name, email and phone. A sole proprietor with no EIN can register as a sole proprietor.' },
  { id: 'website', title: 'Your website says how customers agree to texts', help: 'Carriers check for a page that names your business, has a privacy policy, and says customers may get texts and can reply STOP. The wording below can be pasted into your website or your paper intake form.' },
  { id: 'brand', title: 'Brand is registered in Telnyx', help: 'In the Telnyx portal go to Messaging, then 10DLC, then Brands, and add your business. Paste the answers from this page. There is a small one-time fee.', paths: ['10dlc'] },
  { id: 'campaign', title: 'Campaign is registered in Telnyx', help: 'Still under 10DLC, add a Campaign for your brand. Pick the use case that fits customer care. Paste the campaign description, sample messages and opt-in text from this page. There is a small monthly fee.', paths: ['10dlc'] },
  { id: 'assign', title: 'Number is attached to the campaign', help: 'In the campaign, add your texting number. Texts to customers are filtered by carriers until this is done.', paths: ['10dlc'] },
  { id: 'verification', title: 'Toll-free verification form is submitted', help: 'In the Telnyx portal go to Messaging, then Toll-Free Verification, and submit the form for your number. Paste the answers from this page.', paths: ['toll_free'] },
  { id: 'approved', title: 'Carriers have approved it', help: 'Telnyx emails you when the carriers decide. You do not need to do anything while you wait. If it is rejected, the email says why; fix that one thing and submit again.', wait: true },
]

export interface RegState {
  path: RegPath
  status: RegStatus
  items: Record<string, { done: boolean; at?: string }>
  refs: Record<string, string>
  notes: string
  submitted_at: string | null
  approved_at: string | null
}

export const EMPTY_REG: RegState = { path: 'unsure', status: 'not_started', items: {}, refs: {}, notes: '', submitted_at: null, approved_at: null }

export const REF_FIELDS: { id: string; label: string; paths: RegPath[] }[] = [
  { id: 'brand_id', label: 'Brand ID', paths: ['10dlc'] },
  { id: 'campaign_id', label: 'Campaign ID', paths: ['10dlc'] },
  { id: 'verification_id', label: 'Verification request ID', paths: ['toll_free'] },
]

const PATHS = new Set<RegPath>(['unsure', '10dlc', 'toll_free'])
const STATUSES = new Set<RegStatus>(['not_started', 'in_progress', 'submitted', 'approved', 'rejected'])

/** Reads whatever is stored. Never throws. */
export function normalizeReg(raw: unknown): RegState {
  const r: Record<string, any> = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  const known = new Set(REG_ITEMS.map(i => i.id))
  const items: RegState['items'] = {}
  if (r.items && typeof r.items === 'object') {
    for (const [k, v] of Object.entries(r.items as Record<string, any>)) {
      if (known.has(k) && v && typeof v === 'object' && v.done === true) items[k] = { done: true, ...(typeof v.at === 'string' ? { at: v.at.slice(0, 40) } : {}) }
    }
  }
  const refs: RegState['refs'] = {}
  if (r.refs && typeof r.refs === 'object') {
    for (const f of REF_FIELDS) {
      const v = (r.refs as Record<string, unknown>)[f.id]
      if (typeof v === 'string' && v.trim()) refs[f.id] = v.replace(/[^\w .:/-]/g, '').trim().slice(0, 80)
    }
  }
  return {
    path: PATHS.has(r.path) ? r.path : 'unsure',
    status: STATUSES.has(r.status) ? r.status : 'not_started',
    items, refs,
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 2000) : '',
    submitted_at: typeof r.submitted_at === 'string' ? r.submitted_at : null,
    approved_at: typeof r.approved_at === 'string' ? r.approved_at : null,
  }
}

export interface RegSettingsFacts { hasKey: boolean; hasNumber: boolean; hasProfile: boolean; number: string }

/** A number that starts 800, 833, 844, 855, 866, 877 or 888 is toll-free. Returns null when it cannot tell. */
export function guessPath(number: string): RegPath | null {
  const d = String(number || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  if (d.length !== 10) return null
  return /^8(00|33|44|55|66|77|88)/.test(d) ? 'toll_free' : '10dlc'
}

export interface RegStepView extends RegItem { done: boolean; automatic: boolean }
export interface RegView {
  path: RegPath
  status: RegStatus
  steps: RegStepView[]
  doneCount: number
  totalCount: number
  nextStep: RegStepView | null
  /** "ready" once everything but the wait is done. */
  headline: string
  detail: string
  pathGuess: RegPath | null
}

export function computeRegistration(state: RegState, facts: RegSettingsFacts): RegView {
  const guess = guessPath(facts.number)
  const path: RegPath = state.path === 'unsure' ? guess || 'unsure' : state.path
  const mine = REG_ITEMS.filter(i => !i.paths || path === 'unsure' || i.paths.includes(path))
  const steps: RegStepView[] = mine.map(i => {
    let done = state.items[i.id]?.done === true
    if (i.id === 'number') done = facts.hasKey && facts.hasNumber
    if (i.id === 'profile') done = facts.hasProfile
    if (i.id === 'approved') done = state.status === 'approved'
    return { ...i, done, automatic: i.auto === true }
  })
  const doneCount = steps.filter(s => s.done).length
  const next = steps.find(s => !s.done && !s.wait) || null
  let headline: string
  let detail: string
  if (state.status === 'approved') {
    headline = 'Approved'
    detail = 'Carriers have approved your number for business texts.'
  } else if (state.status === 'rejected') {
    headline = 'Needs a fix'
    detail = state.notes ? `Carriers sent it back. Your note: ${state.notes}` : 'Carriers sent it back. Open the email from Telnyx, fix the one thing it names, and submit again.'
  } else if (state.status === 'submitted') {
    headline = 'Waiting for carriers'
    detail = 'It is submitted. Telnyx emails you when carriers decide, usually within a few weeks. Texts may be filtered until then.'
  } else if (next) {
    headline = path === 'unsure' ? 'Pick your number type' : `${doneCount} of ${steps.length} steps done`
    detail = path === 'unsure' ? 'Local numbers use 10DLC. Toll-free numbers use toll-free verification. The steps differ.' : `Next: ${next.title}.`
  } else {
    headline = 'Ready to submit'
    detail = 'Everything is in place. Mark it as submitted once you have sent it in Telnyx.'
  }
  return { path, status: state.status, steps, doneCount, totalCount: steps.length, nextStep: next, headline, detail, pathGuess: guess }
}

/** True when carriers are known to have approved the number. */
export function isApproved(state: RegState): boolean { return state.status === 'approved' }

/* ---------------- the words they paste into the forms ---------------- */

export interface RegCopy { id: string; title: string; where: string; text: string }

export function registrationCopy(shop: ShopProfile, rules: VoiceRules, webhookUrl: string): RegCopy[] {
  const who = shopWord(shop)
  const num = shop.phone ? prettyPhone(shop.phone) : '[your texting number]'
  const first = rules.texts_mode === 'off' ? '' : ' An AI assistant may answer first and says so in its first message.'
  const sample1 = `${who}: Hi, this is the virtual assistant for ${who}. I'm an AI. Thanks for texting. What kind of vehicle is it and what is it doing? ${OPT_OUT_LINE}`
  const sample2 = `${who}: Your appointment is set for [day] at [time]. Reply STOP to stop texts.`
  const sample3 = `${who}: Your vehicle is ready for pickup. We are open [hours]. Reply STOP to stop texts.`
  return [
    {
      id: 'use_case', title: 'What you use texting for', where: 'Campaign description, or toll-free "use case summary"',
      text: `${who} is an independent auto repair shop. We text our own customers about their vehicle repairs: appointment confirmations and reminders, estimate and invoice links, vehicle-ready notices, and answers to questions they text us first.${first} We do not send third-party marketing and we do not sell or share phone numbers.`,
    },
    {
      id: 'opt_in', title: 'How customers agree to texts', where: 'Opt-in or "message flow" field',
      text: `Customers agree to receive texts when they give us their mobile number at the shop counter or on our intake form, which states: "By giving us your mobile number you agree to receive text messages from ${who} about your service, such as appointments, estimates and invoices. Message frequency varies. Message and data rates may apply. Reply STOP to stop, HELP for help." Customers also start a conversation by texting our number first. We keep a record of every STOP and never text a number that has stopped.`,
    },
    {
      id: 'intake_wording', title: 'Wording for your intake form and website', where: 'Paste on your website and paper forms',
      text: `By giving us your mobile number you agree to receive text messages from ${who} about your service, such as appointments, estimates and invoices. Message frequency varies. Message and data rates may apply. Reply STOP to stop or HELP for help. Your number is never sold or shared for marketing.`,
    },
    {
      id: 'samples', title: 'Sample messages', where: 'Sample message fields (use three)',
      text: [sample1, sample2, sample3].join('\n\n'),
    },
    {
      id: 'keywords', title: 'STOP and HELP replies', where: 'Opt-out and help message fields',
      text: `STOP: "You're unsubscribed from ${who} texts. No more messages will be sent. Reply START to turn texts back on."\nHELP: "${helpReply(shop)}"\nSTART: "${startReply(shop)}"`,
    },
    {
      id: 'business', title: 'Business details to have ready', where: 'Brand or verification form',
      text: [
        `Business name: ${shop.name || '[legal business name]'}`,
        `Phone: ${num}`,
        `Address: ${shop.address || '[street address]'}`,
        `Email: ${shop.email || '[business email]'}`,
        'Website: [your website with a privacy policy]',
        'Tax ID (EIN): [your EIN, or choose sole proprietor]',
        'Industry: Automotive repair',
        'Expected volume: under 1,000 texts a month for a single shop (adjust to match yours)',
      ].join('\n'),
    },
    {
      id: 'webhook', title: 'Where Telnyx sends incoming texts', where: 'Messaging profile, webhook address',
      text: webhookUrl || 'Save your app address in the deployment settings first.',
    },
  ]
}

/** Combines what is saved with a change from the screen, stamping the time on steps that just became done. */
export function mergeRegistration(current: RegState, change: Record<string, any>, nowIso: string): RegState {
  const merged = normalizeReg({
    ...current, ...change,
    items: { ...current.items, ...(change.items && typeof change.items === 'object' ? change.items : {}) },
    refs: { ...current.refs, ...(change.refs && typeof change.refs === 'object' ? change.refs : {}) },
  })
  for (const item of REG_ITEMS) {
    if (merged.items[item.id]?.done && !current.items[item.id]?.done) merged.items[item.id] = { done: true, at: nowIso }
    else if (merged.items[item.id]?.done && current.items[item.id]?.at) merged.items[item.id] = { done: true, at: current.items[item.id].at }
  }
  merged.submitted_at = merged.status === 'submitted' || merged.status === 'approved' ? current.submitted_at || nowIso : null
  merged.approved_at = merged.status === 'approved' ? current.approved_at || nowIso : null
  return merged
}
