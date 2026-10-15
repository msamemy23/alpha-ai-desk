/**
 * Guardrails for the AI receptionist and the text auto-reply.
 *
 * These are plain, deterministic checks that run on the server before and after the AI model:
 *  - what the customer said (is it angry, a safety problem, spam, a request for a person, an opt-out ...)
 *  - what the assistant is about to say (no prices, no promises about timing, no claiming to be a person ...)
 *
 * They do not depend on the model behaving. Pure TypeScript with only relative imports.
 */

export interface Signals {
  spam: boolean
  spamWhy: string
  safety: boolean
  emergency: boolean
  towing: boolean
  accident: boolean
  insurance: boolean
  legal: boolean
  angry: boolean
  customKeyword: string
  wantsHuman: boolean
  askedIfAi: boolean
  price: boolean
  status: boolean
  timing: boolean
  booking: boolean
  hours: boolean
  address: boolean
  optOutNatural: boolean
  goodbye: boolean
  ack: boolean
}

const has = (re: RegExp, text: string) => re.test(text)

const SAFETY = [
  /\b(brakes?|brake pedal|brake line)\b[^.!?]{0,40}\b(fail(ed|ing|ure)?|gone|out|not working|went to the floor|stopped working|don'?t work|won'?t work|no longer work)\b/i,
  /\bno brakes\b/i,
  /\b(smoke|smoking|on fire|caught fire|catching fire|flames?)\b/i,
  /\b(steering|steering wheel)\b[^.!?]{0,30}\b(locked|lock(ed)? up|came off|won'?t turn|not working|gone)\b/i,
  /\b(fuel|gas|gasoline) leak|leaking (fuel|gas|gasoline)\b/i,
  /\bcarbon monoxide\b/i,
  /\bwheels? (fell|came|coming) off\b/i,
  /\b(can'?t|cannot|unable to) (stop|steer)\b/i,
  /\bunsafe\b/i,
]
const EMERGENCY = [/\b(injur(ed|y|ies)|hurt|bleeding|ambulance|911|medical emergency|someone is hurt|unconscious)\b/i]
const TOWING = [
  /\b(tow(ed|ing)?|tow truck|flat ?bed|wrecker|roadside)\b/i,
  /\b(stranded|broke down|broken down|stuck (on|in|at) the (road|highway|freeway|shoulder|side|middle|parking))\b/i,
]
const ACCIDENT = [/\b(accident|crash(ed)?|collision|wreck(ed)?|rear[- ]?ended|t-?boned|hit and run|fender bender|totaled)\b/i, /\b(someone|a car|a truck|he|she|they) hit (me|my|the)\b/i]
const INSURANCE = [/\b(insurance|insurer|adjuster|deductible|geico|state farm|progressive|allstate|usaa|liberty mutual|farmers insurance|claim number|insurance claim|my claim)\b/i]
const LEGAL = [
  /\b(lawyer|attorney|sue|suing|lawsuit|legal action|small claims|court|police report|report you|better business|bbb|consumer protection|attorney general|chargeback|dispute the charge|dispute this charge)\b/i,
]
const ANGRY = [
  /\b(f+u+c+k\w*|sh[i1]+t\w*|b[i1]tch\w*|a+ss ?hole\w*|bastard\w*|damn(ed|it)?|goddamn\w*|pissed( off)?|crap|wtf|bullshit|bs)\b/i,
  /\b(furious|angry|upset|livid|outraged|disgusted|disgusting|unacceptable|ridiculous|absurd|outrageous|incompetent|idiots?|useless|horrible|terrible|awful|worst|scam(med)?|rip(ped)?[- ]?off|ripoff|fed up|sick of|tired of)\b/i,
  /\b(never (coming|using|again|going)|waste of (my )?(time|money)|want my money back|refund|money back|file a complaint|complaint|speak to (your )?manager|talk to (your )?manager)\b/i,
]
const WANTS_HUMAN = [
  /\b(real|live|actual) (person|human|agent|someone)\b/i,
  /\b(speak|talk|connect|transfer|put|get|patch)\b[^.!?]{0,25}\b(person|human|someone|somebody|manager|owner|mechanic|advisor|representative|agent|operator|employee|staff|technician)\b/i,
  /\b(operator|representative|human being|customer service)\b/i,
]
const ASKED_IF_AI = [
  /\b(are|r) (you|u) (a |an )?(real|human|person|robot|bot|ai|a\.i\.|machine|computer|automated|recording|artificial)\b/i,
  /\bis this (a |an )?(real|human|person|robot|bot|ai|machine|computer|recording|automated)\b/i,
  /\b(am i|is it) (talking|speaking|texting|chatting) (to|with) (a |an )?(real|human|person|robot|bot|ai|machine|computer)\b/i,
  /\b(are you|is this) (an? )?(automated|virtual)\b/i,
  /\bis (this|that) (a )?recording\b/i,
]
const PRICE = [
  /\b(how much|price|prices|pricing|cost|costs|quote|quoted|ballpark|charge|charges|cheap|cheaper|expensive|afford|fee|fees|discount|coupon|deal)\b/i,
  /\$\s?\d/,
  /\bgoing to run\b/i,
]
const STATUS = [/\b(status|update on|ready yet|done yet|finished yet|progress|any news|how('?s| is) my (car|truck|suv|van|vehicle))\b/i, /\b(is|are) (my|the) (car|truck|suv|van|vehicle)( \w+)? (ready|done|finished)\b/i]
const TIMING = [/\bhow long\b/i, /\bwhen (will|can|should|would)\b/i, /\beta\b/i]
const BOOKING = [
  /\b(appointment|appt|schedule|scheduling|book|booking|reserve|set up a time|make an appointment)\b/i,
  /\b(come in|bring (it|my \w+) in|drop (it|my \w+) off|drop[- ]?off|walk[- ]?in|fit me in|squeeze me in|next available|availability|available)\b/i,
  /\bcan i (come|bring)\b/i,
]
const HOURS = [/\b(hours?|opening|closing|what time do you|until when|when do you (open|close)|are you open|you open|still open|open (today|tomorrow|saturday|sunday|now))\b/i]
const ADDRESS = [/\b(where are you|address|directions?|how do i get|located|find you|cross street|your location)\b/i]
const OPT_OUT_NATURAL = [
  /\b(stop|quit|cease)\s+(texting|messaging|contacting|calling|sending|emailing)\b/i,
  /\bdo(n'?t| not)\s+(text|message|contact|call|email)\s+(me|us)\b/i,
  /\btake (me|us) off\b/i,
  /\bremove (me|us|my (number|phone))\b/i,
  /\bunsubscribe\b/i,
  /\bleave me alone\b/i,
  /\bno more (texts|messages|calls)\b/i,
]
const GOODBYE = [
  /\b(good ?bye|bye( bye)?|that'?s (all|it)|that is all|have a (good|great|nice|wonderful) (one|day|night|evening|weekend)|talk (to you )?later|take care|see ya|nothing else|i'?m (all )?(good|set)|all set|we'?re (all )?(good|set)|no,? (thank you|thanks))\b/i,
]
const ACK = /^(ok(ay)?|k|kk|thanks?( you)?( so much| very much)?|thx|ty|got it|sounds good|great|perfect|will do|cool|awesome|alright|all right|appreciate it|sweet|no worries|np)[.!,\s]*$/i

const SPAM_CALL = [
  /\b(extended|vehicle|car'?s?|auto) (service )?(warranty|coverage)\b[^.!?]{0,80}\b(expire|expir(ed|ing)|about to|final|last|notice|renew)\b/i,
  /\bthis is (not|a) (a )?(sales|courtesy|recorded|automated) (call|message)\b/i,
  /\b(google|yelp|bing) (listing|business|my business|maps|profile)\b[^.!?]{0,60}\b(verify|claim|suspend|remove|update|rank|page one|first page)\b/i,
  /\b(seo|search engine optimization|website (design|redesign|development)|web design|digital marketing|marketing (services|agency|company)|lead generation)\b/i,
  /\b(merchant (services|account)|credit card processing|processing fees|business (loan|funding|financing|capital|line of credit)|working capital|sba loan)\b/i,
  /\b(student loan|debt (relief|consolidation)|lower your (interest|rate|payment)|credit repair|credit score)\b/i,
  /\b(social security|irs|internal revenue|medicare|medicaid|arrest warrant|final notice)\b/i,
  /\byour account (has been|is) (suspended|compromised|locked|closed)\b/i,
  /\bpress (1|one|9|nine|the one key)\b/i,
  /\b(free (vacation|cruise|gift|trip)|you('?ve| have) (won|been selected)|claim your (prize|reward|gift))\b/i,
]
const LEGIT_BUSINESS = /\b(order|delivery|driver|invoice|account number|my car|my truck|my vehicle|appointment|estimate|repair|brake|oil change|tire|check engine|part number)\b/i

const SPAM_TEXT = [
  /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|rb\.gy|cutt\.ly|shorturl\.at)\b/i,
  /\b(click (here|the link|below)|claim your|congratulations|you('?ve| have) (won|been selected)|verify your (account|identity)|account (has been )?(suspended|locked|compromised)|usps|package (is )?(delayed|held)|crypto|bitcoin|investment opportunity|loan offer|dating|cash app me|wire transfer)\b/i,
  /\b(extended|vehicle|car'?s?|auto) (service )?(warranty|coverage)\b/i,
  /\b(seo|google (listing|business)|website (design|redesign)|digital marketing)\b/i,
]

const AUTOMATED_BODY = [
  /\b(this is an? )?(automated|auto[- ]?)(reply|response|message|assistant|text)\b/i,
  /\bauto[- ]?reply\b/i,
  /\bdo not reply\b|\bdon'?t reply\b|\bno[- ]?reply\b/i,
  /\bmsg ?(&|and)? ?data rates\b|\bmessage frequency\b|\bmsg freq\b/i,
  /\breply (stop|help)\b[^.!?]{0,40}\b(opt|unsubscribe|cancel|help|end|info)\b/i,
  /\b(this (number|mailbox|line|inbox) is not monitored)\b/i,
  /\bout of (the )?office\b|\bcurrently unavailable\b|\bwill respond (as soon|when|shortly)\b/i,
  /\b(thank you for (contacting|texting|messaging|reaching)|thanks for (contacting|texting|messaging|reaching))\b[^.!?]{0,80}\b(we will|we'?ll|we have received|your message has been)\b/i,
  /\byour message has been received\b/i,
  /\b(virtual|ai|automated) (assistant|agent|receptionist)\b[^.!?]{0,40}\b(for|at|of)\b/i,
]

export interface ClassifyOptions {
  channel: 'call' | 'sms'
  customKeywords?: string[]
}

export function classify(raw: string, opts: ClassifyOptions): Signals {
  const text = String(raw || '').replace(/\s+/g, ' ').trim()
  const lettersOnly = text.replace(/[^A-Za-z]/g, '')
  const shouting = lettersOnly.length >= 14 && lettersOnly.replace(/[^A-Z]/g, '').length / lettersOnly.length > 0.75
  const exclaim = (text.match(/!/g) || []).length >= 3
  const anyOf = (list: RegExp[]) => list.some(re => has(re, text))

  let spam = false
  let spamWhy = ''
  const spamList = opts.channel === 'call' ? SPAM_CALL : SPAM_TEXT
  const hit = spamList.find(re => has(re, text))
  if (hit && !(opts.channel === 'call' && LEGIT_BUSINESS.test(text))) { spam = true; spamWhy = String(hit.exec(text)?.[0] || '').slice(0, 60) }

  let customKeyword = ''
  for (const k of opts.customKeywords || []) {
    const kw = k.trim().toLowerCase()
    if (kw && text.toLowerCase().includes(kw)) { customKeyword = k.trim(); break }
  }

  return {
    spam, spamWhy,
    safety: anyOf(SAFETY),
    emergency: anyOf(EMERGENCY),
    towing: anyOf(TOWING),
    accident: anyOf(ACCIDENT),
    insurance: anyOf(INSURANCE),
    legal: anyOf(LEGAL),
    angry: anyOf(ANGRY) || shouting || exclaim,
    customKeyword,
    wantsHuman: anyOf(WANTS_HUMAN),
    askedIfAi: anyOf(ASKED_IF_AI),
    price: anyOf(PRICE),
    status: anyOf(STATUS),
    timing: anyOf(TIMING),
    booking: anyOf(BOOKING),
    hours: anyOf(HOURS),
    address: anyOf(ADDRESS),
    optOutNatural: anyOf(OPT_OUT_NATURAL),
    goodbye: anyOf(GOODBYE),
    ack: ACK.test(text),
  }
}

/** The topics that always need a person, in the order they are handled. Honors the shop's switches. */
export type PersonTopic = 'safety' | 'towing' | 'accident' | 'insurance' | 'legal' | 'angry' | 'keyword' | 'asked'

export function personTopics(s: Signals, topics: { angry: boolean; safety: boolean; towing: boolean; accident: boolean; insurance: boolean; legal: boolean }): PersonTopic[] {
  const out: PersonTopic[] = []
  if ((s.safety || s.emergency) && topics.safety) out.push('safety')
  if (s.towing && topics.towing) out.push('towing')
  if (s.accident && topics.accident) out.push('accident')
  if (s.insurance && topics.insurance) out.push('insurance')
  if (s.legal && topics.legal) out.push('legal')
  if (s.angry && topics.angry) out.push('angry')
  if (s.customKeyword) out.push('keyword')
  if (s.wantsHuman) out.push('asked')
  return out
}

export const TOPIC_REASON: Record<PersonTopic, string> = {
  safety: 'Safety problem',
  towing: 'Towing or stranded',
  accident: 'Accident',
  insurance: 'Insurance',
  legal: 'Legal or dispute',
  angry: 'Upset customer',
  keyword: 'Keyword you set',
  asked: 'Asked for a person',
}

/* ---------- text keywords and senders ---------- */

export type SmsKeyword = 'stop' | 'start' | 'help'

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'])
const START_WORDS = new Set(['START', 'UNSTOP', 'SUBSCRIBE', 'OPTIN'])
const HELP_WORDS = new Set(['HELP', 'INFO'])

/** STOP, START and HELP are whole-message commands. "stop the car" is not one. */
export function smsKeyword(text: string): SmsKeyword | null {
  const cmd = String(text || '').trim().toUpperCase().replace(/[^A-Z]/g, '')
  if (STOP_WORDS.has(cmd)) return 'stop'
  if (START_WORDS.has(cmd)) return 'start'
  if (HELP_WORDS.has(cmd)) return 'help'
  return null
}

/** A short code, a name instead of a number, or something that is not a normal phone number: never get an AI reply. */
export function isAutomatedSenderAddress(from: string): boolean {
  const raw = String(from || '').trim()
  if (!raw) return true
  if (/[A-Za-z]/.test(raw)) return true
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10) return true
  if (digits.length === 11 && !digits.startsWith('1')) return true
  if (digits.length > 11) return true
  return false
}

/** Messages that look written by another bot or a business auto-responder. Replying would start a loop. */
export function looksAutomated(body: string): boolean {
  const text = String(body || '')
  return AUTOMATED_BODY.some(re => re.test(text))
}

/** True when the same words were already sent in `recent`, so a reply would only repeat a loop. */
export function isRepeat(body: string, recent: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const n = norm(body)
  if (!n) return false
  return recent.some(r => norm(r) === n)
}

/** True when what was heard is mostly the assistant's own words coming back through the line. */
export function isEchoOfAssistant(heard: string, assistantLines: string[]): boolean {
  const incoming = String(heard || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!incoming) return false
  for (const line of assistantLines) {
    const ai = String(line || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (ai.length < 10) continue
    if (ai.includes(incoming) && incoming.split(' ').length >= 2) return true
    if (incoming.length >= 20 && incoming.includes(ai.slice(0, 30))) return true
    const aiWords = new Set(ai.split(' '))
    const words = incoming.split(' ')
    if (words.length > 3) {
      const matched = words.filter(w => aiWords.has(w)).length
      if (matched / words.length > 0.7) return true
    }
  }
  return false
}

/* ---------- what the assistant says ---------- */

const PRICE_REPLY = [
  /\$\s?\d/,
  /\b\d[\d,]*(\.\d+)?\s?(dollars?|bucks|usd)\b/i,
  /\b(costs?|runs?|charge[sd]?|priced?|price is|total is|starts? at|starting at|as low as|between)\s+(about |around |roughly |approximately |at )?\$?\d/i,
  /\b(about|around|roughly|approximately)\s+\d[\d,]*\s*(k|dollars?|bucks)\b/i,
  /\bfree (estimates?|diagnos\w+|inspections?|checks?|quotes?|oil|alignments?|of charge)\b/i,
  /\b(at )?no (charge|cost)\b|\bcomplimentary\b|\bwe('?ll| will) waive\b/i,
]
const TIME_PROMISE = [
  /\b(will|should|going to|gonna|'ll) be (ready|done|finished|completed|fixed|back)\b/i,
  /\b(ready|done|finished|completed|fixed|back) (by|on|at|in|within|before|after|around) /i,
  /\b(call|text|contact|reach|get back to|follow up with|be in touch with|respond to|reply to|ring)( you)?( back)? (within|in|by|at|before|after|around|right away|immediately|shortly|asap|today|tonight|tomorrow|this (morning|afternoon|evening)|first thing|in a few|in the next)\b/i,
  /\b(within|in|after|takes?|take) (about |around |roughly |approximately )?(\d+|an?|one|two|three|four|five|a few|a couple( of)?|several) ?(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/i,
  /\b(right away|immediately|shortly|as soon as possible|asap|first thing)\b/i,
  /\b(by|before) (end of (the )?day|close of business|noon|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(:\d{2})? ?(am|pm))\b/i,
  /\b(today|tonight|tomorrow)\b[^.!?]{0,25}\b(done|ready|finished|fixed|call you|text you)\b/i,
]
const HUMAN_CLAIM = [
  /\b(i'?m|i am|this is|you'?re (talking|speaking|chatting) (to|with)) (a |an )?(real |live |actual )?(person|human|man|woman|guy|girl)\b/i,
  /\bi'?m not (an? )?(ai|a\.i\.|robot|bot|virtual|automated)\b/i,
  /\bnot (an? )?(ai|robot|bot)\b/i,
  /\bno,? i'?m (a )?(real|human)\b/i,
]
const DIAGNOSIS = [
  /\b(sounds like|probably|most likely|likely|could be|might be|may be|it'?s (probably|likely|just)|that'?s (probably|likely|just)|definitely|sounds to me like)\b[^.!?]{0,40}\b(alternator|starter|battery|head gasket|transmission|catalytic|water pump|radiator|thermostat|brake pads?|rotors?|calipers?|control arm|ball joints?|tie rods?|wheel bearing|o2 sensor|oxygen sensor|spark plugs?|ignition coils?|fuel pump|injectors?|timing belt|serpentine belt|cv axle|struts?|shocks?|tensioner|compressor|evaporator|condenser|clutch|differential|drive ?shaft|engine|motor|computer|ecu)\b/i,
  /\b(safe|fine|okay|ok|alright) to (drive|keep driving|continue driving|ride)\b/i,
  /\b(not|isn'?t|unsafe|dangerous) (safe )?to drive\b|\bdon'?t drive\b|\bstop driving\b|\bdo not drive\b/i,
  /\bwill (fix|solve|cure) (it|that|the problem)\b/i,
]

export type ReplyViolation = 'no_prices' | 'no_time_promises' | 'no_human_claim' | 'no_diagnosis' | 'blocked_phrase' | 'too_long'

function sentences(text: string): string[] {
  // Split after . ! ? only when a space follows, so "$79.99" and "5:00 p.m." stay in one piece. Nothing is dropped.
  return text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean)
}

function sentenceViolations(sentence: string, blocked: string[]): ReplyViolation[] {
  const v: ReplyViolation[] = []
  if (PRICE_REPLY.some(re => re.test(sentence))) v.push('no_prices')
  if (TIME_PROMISE.some(re => re.test(sentence))) v.push('no_time_promises')
  if (HUMAN_CLAIM.some(re => re.test(sentence))) v.push('no_human_claim')
  if (DIAGNOSIS.some(re => re.test(sentence))) v.push('no_diagnosis')
  const lower = sentence.toLowerCase()
  if (blocked.some(b => b && lower.includes(b.toLowerCase()))) v.push('blocked_phrase')
  return v
}

export interface PolicyContext {
  channel: 'call' | 'sms'
  blockedPhrases: string[]
  /** What to say when every sentence had to be removed. Already has the shop's own wording. */
  fallback: { prices: string; timing: string; diagnosis: string; human: string; generic: string }
}

export interface PolicyResult { text: string; violations: ReplyViolation[]; changed: boolean }

const MAX_SMS = 320
const MAX_CALL = 420

/** Truncates at the last full sentence that fits. */
export function limitLength(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false }
  const parts = sentences(text)
  let out = ''
  for (const s of parts) {
    if ((out + ' ' + s).trim().length > max) break
    out = (out + ' ' + s).trim()
  }
  if (!out) out = text.slice(0, max - 1).replace(/\s+\S*$/, '').trim() + '…'
  return { text: out, cut: true }
}

/**
 * Removes anything the assistant must never say. A sentence with a price, a timing promise, a claim to be a person,
 * a diagnosis or a blocked phrase is dropped. If nothing is left, a safe sentence for the first problem is used instead.
 */
export function enforceReplyPolicy(reply: string, ctx: PolicyContext): PolicyResult {
  const clean = String(reply || '').replace(/\s+/g, ' ').trim()
  if (!clean) return { text: '', violations: [], changed: false }
  const keep: string[] = []
  const violations: ReplyViolation[] = []
  for (const s of sentences(clean)) {
    const found = sentenceViolations(s, ctx.blockedPhrases)
    if (found.length) { for (const f of found) if (!violations.includes(f)) violations.push(f) } else keep.push(s)
  }
  let text = keep.join(' ').trim()
  if (!text && violations.length) {
    const first = violations[0]
    text = first === 'no_prices' ? ctx.fallback.prices
      : first === 'no_time_promises' ? ctx.fallback.timing
      : first === 'no_diagnosis' ? ctx.fallback.diagnosis
      : first === 'no_human_claim' ? ctx.fallback.human
      : ctx.fallback.generic
  }
  const limited = limitLength(text, ctx.channel === 'sms' ? MAX_SMS : MAX_CALL)
  if (limited.cut) violations.push('too_long')
  return { text: limited.text, violations, changed: violations.length > 0 || limited.text !== clean }
}

/** True when the words say the speaker is an AI (used to check an answer to "are you a robot?"). */
export function admitsAi(text: string): boolean {
  return /\b(ai|a\.i\.|artificial|virtual assistant|automated assistant|computer program|not a (real )?person|not a human)\b/i.test(text)
}

/** Removes markdown, quotes, stage directions and thinking tags that the voice or a text should never contain. */
export function cleanModelText(text: string): string {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[a-z]*\n?|```/gi, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/^[-*#>]+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}
