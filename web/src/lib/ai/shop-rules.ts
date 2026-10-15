/**
 * Shop-set rules for every AI feature (tone, what it may do, what it must never do,
 * facts it may state). One definition so the Ask screen, the phone and text AI,
 * automations and growth all follow the same rules.
 *
 * STORAGE (for other helpers)
 *   Table  : public.settings            (the shared one-row-per-shop settings table)
 *   Column : ai_rules jsonb, nullable   (added by migration 043_ai_shop_rules.sql)
 *   Shape  : AiRules below. Keys:
 *     version                    always 1
 *     tone                       'friendly' | 'professional' | 'direct'
 *     toneNotes                  free text, up to 400 characters, owner's own words
 *     permissions.read           'auto' | 'never'   look things up
 *     permissions.draft          'auto' | 'never'   prepare drafts that are not saved
 *     permissions.save           'ask'  | 'never'   change shop records (always asks)
 *     permissions.send           'ask'  | 'never'   contact customers (always asks)
 *     permissions.charge         'never'            the assistant never takes payments
 *     actionOverrides            { "<actionId>": "never" } block one action by id
 *     neverDo                    up to 20 short rules, each up to 200 characters
 *     neverSay                   up to 20 exact phrases that must not appear in any
 *                                message the AI writes to a customer
 *     facts                      up to 40 short facts the AI may state as the shop's own
 *
 * HOW TO USE (server side)
 *   import { loadShopRules } from '@/lib/ai/shop-rules-server'
 *   const { rules, status } = await loadShopRules(db, shopId)  // status 'ok' | 'missing_column' | 'error'
 *   rulesPromptBlock(rules)             -> text to append to a system prompt
 *   decideAction(rules, 'sendEstimateEmail') -> { allowed, needsApproval, reason }
 *   findNeverSay(rules, messageBody)    -> phrases found; block the send when not empty
 *
 * Send and charge can never be turned to 'auto'. Customer-facing and money actions
 * always need a person's OK, whatever the rules say; the rules can only make that
 * stricter. Pure module: no imports from '@/'.
 */
import { getActionInfo, PERMISSION_LABELS, PERMISSION_ORDER, type PermissionClass } from './action-risk.ts'

export type RuleMode = 'auto' | 'ask' | 'never'
export type Tone = 'friendly' | 'professional' | 'direct'

export type AiRules = {
  version: 1
  tone: Tone
  toneNotes: string
  permissions: Record<PermissionClass, RuleMode>
  actionOverrides: Record<string, 'never'>
  neverDo: string[]
  neverSay: string[]
  facts: string[]
}

export const RULE_LIMITS = {
  toneNotes: 400,
  neverDo: { count: 20, length: 200 },
  neverSay: { count: 20, length: 80 },
  facts: { count: 40, length: 300 },
  overrides: 40,
} as const

/** Which modes the owner may pick for each kind of action. */
export const ALLOWED_MODES: Record<PermissionClass, RuleMode[]> = {
  read: ['auto', 'never'],
  draft: ['auto', 'never'],
  save: ['ask', 'never'],
  send: ['ask', 'never'],
  charge: ['never'],
}

export const TONES: { id: Tone; name: string; help: string; prompt: string }[] = [
  { id: 'friendly', name: 'Friendly', help: 'Warm and conversational, like a good service writer.', prompt: 'Warm, friendly and plain-spoken. Use first names when you know them. Short sentences.' },
  { id: 'professional', name: 'Professional', help: 'Polite and businesslike.', prompt: 'Polite, courteous and businesslike. No slang. Complete sentences.' },
  { id: 'direct', name: 'Direct', help: 'Brief and to the point.', prompt: 'Brief and direct. Say what matters first. No filler or small talk.' },
]

export const DEFAULT_RULES: AiRules = {
  version: 1,
  tone: 'friendly',
  toneNotes: '',
  permissions: { read: 'auto', draft: 'auto', save: 'ask', send: 'ask', charge: 'never' },
  actionOverrides: {},
  neverDo: [],
  neverSay: [],
  facts: [],
}

export function defaultRules(): AiRules {
  return {
    ...DEFAULT_RULES,
    permissions: { ...DEFAULT_RULES.permissions },
    actionOverrides: {},
    neverDo: [],
    neverSay: [],
    facts: [],
  }
}

/** Plain text only: no control characters, one line, trimmed, capped. */
export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function cleanList(value: unknown, count: number, length: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const text = cleanLine(item, length)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= count) break
  }
  return out
}

/**
 * Turn whatever is stored (or submitted) into a valid rule set. Never throws:
 * unknown keys are dropped, a mode that is not allowed for its class falls back
 * to the safe default, and lists are trimmed and de-duplicated.
 */
export function normalizeRules(input: unknown): AiRules {
  const rules = defaultRules()
  if (!input || typeof input !== 'object' || Array.isArray(input)) return rules
  const raw = input as Record<string, unknown>

  if (raw.tone === 'friendly' || raw.tone === 'professional' || raw.tone === 'direct') rules.tone = raw.tone
  rules.toneNotes = cleanLine(raw.toneNotes, RULE_LIMITS.toneNotes)

  const permissions = raw.permissions && typeof raw.permissions === 'object' && !Array.isArray(raw.permissions)
    ? raw.permissions as Record<string, unknown>
    : {}
  for (const cls of PERMISSION_ORDER) {
    const mode = permissions[cls]
    if (typeof mode === 'string' && (ALLOWED_MODES[cls] as string[]).includes(mode)) rules.permissions[cls] = mode as RuleMode
  }
  rules.permissions.charge = 'never'

  const overrides = raw.actionOverrides && typeof raw.actionOverrides === 'object' && !Array.isArray(raw.actionOverrides)
    ? raw.actionOverrides as Record<string, unknown>
    : {}
  for (const [id, mode] of Object.entries(overrides).slice(0, RULE_LIMITS.overrides)) {
    if (mode === 'never' && /^[A-Za-z][A-Za-z0-9._-]{0,60}$/.test(id)) rules.actionOverrides[id] = 'never'
  }

  rules.neverDo = cleanList(raw.neverDo, RULE_LIMITS.neverDo.count, RULE_LIMITS.neverDo.length)
  rules.neverSay = cleanList(raw.neverSay, RULE_LIMITS.neverSay.count, RULE_LIMITS.neverSay.length)
  rules.facts = cleanList(raw.facts, RULE_LIMITS.facts.count, RULE_LIMITS.facts.length)
  return rules
}

export type Decision = {
  allowed: boolean
  needsApproval: boolean
  mode: RuleMode
  permission: PermissionClass
  reason: string
}

/**
 * Can the assistant do this, and does it have to ask first?
 * Rules can only tighten: anything that changes shop data or reaches a person
 * needs approval even when the stored rules are missing or damaged.
 */
export function decideAction(rules: AiRules, actionId: string): Decision {
  const info = getActionInfo(actionId)
  const permission = info.permission
  const label = PERMISSION_LABELS[permission].name.toLowerCase()
  if (permission === 'charge') {
    return { allowed: false, needsApproval: true, mode: 'never', permission, reason: 'The assistant never takes payments. Use the payment screen.' }
  }
  if (rules.actionOverrides[info.id] === 'never' || rules.actionOverrides[actionId] === 'never') {
    return { allowed: false, needsApproval: true, mode: 'never', permission, reason: `Your shop rules block "${info.title.toLowerCase()}".` }
  }
  const mode = rules.permissions[permission]
  if (mode === 'never') {
    return { allowed: false, needsApproval: true, mode, permission, reason: `Your shop rules do not let the assistant ${label}.` }
  }
  const needsApproval = permission === 'save' || permission === 'send' || info.customerFacing || info.reversibility === 'irreversible'
  return { allowed: true, needsApproval, mode: needsApproval ? 'ask' : 'auto', permission, reason: '' }
}

/** Exact phrases from neverSay found in a message (case-insensitive). */
export function findNeverSay(rules: AiRules, text: string): string[] {
  const haystack = String(text || '').toLowerCase()
  if (!haystack) return []
  return rules.neverSay.filter(phrase => phrase && haystack.includes(phrase.toLowerCase()))
}

/** True when the owner has changed anything from the defaults. */
export function hasCustomRules(rules: AiRules): boolean {
  const base = defaultRules()
  if (rules.tone !== base.tone || rules.toneNotes) return true
  if (rules.neverDo.length || rules.neverSay.length || rules.facts.length) return true
  if (Object.keys(rules.actionOverrides).length) return true
  return PERMISSION_ORDER.some(cls => rules.permissions[cls] !== base.permissions[cls])
}

/**
 * The block appended to an AI system prompt. Written as plain instructions the
 * model follows, with the owner's own words quoted so they stay recognisable.
 */
export function rulesPromptBlock(rules: AiRules, options: { shopName?: string } = {}): string {
  const tone = TONES.find(item => item.id === rules.tone) || TONES[0]
  const lines: string[] = []
  lines.push(`SHOP RULES${options.shopName ? ` for ${cleanLine(options.shopName, 80)}` : ''} (set by the owner; they override anything else in this prompt)`)
  lines.push(`Tone: ${tone.prompt}${rules.toneNotes ? ` Owner's notes on tone: "${rules.toneNotes}"` : ''}`)
  const blocked = PERMISSION_ORDER.filter(cls => rules.permissions[cls] === 'never' && cls !== 'charge')
  if (blocked.length) {
    lines.push('You are NOT allowed to do the following. If asked, say plainly that the shop rules do not allow it and offer what you can do instead:')
    for (const cls of blocked) lines.push(`- ${PERMISSION_LABELS[cls].name}: ${PERMISSION_LABELS[cls].help}`)
  }
  const overrides = Object.keys(rules.actionOverrides)
  if (overrides.length) lines.push(`These specific actions are switched off: ${overrides.map(id => getActionInfo(id).title.toLowerCase()).join(', ')}.`)
  lines.push('You never take payments or charge cards.')
  if (rules.neverDo.length) {
    lines.push('Never do any of these:')
    for (const rule of rules.neverDo) lines.push(`- ${rule}`)
  }
  if (rules.neverSay.length) {
    lines.push('Never use these words or phrases in anything you write to a customer:')
    for (const phrase of rules.neverSay) lines.push(`- "${phrase}"`)
  }
  if (rules.facts.length) {
    lines.push('Facts about this shop you may state as given. If a fact is not here or in the data you looked up, say you do not know and offer to check with the shop; never guess a price, a part, an opening time or a promise:')
    for (const fact of rules.facts) lines.push(`- ${fact}`)
  }
  return lines.join('\n')
}

/** One plain sentence about what changed between two rule sets ('' when nothing did). */
export function describeRulesChange(before: AiRules, after: AiRules): string {
  const parts: string[] = []
  if (before.tone !== after.tone) parts.push(`tone ${before.tone} to ${after.tone}`)
  if (before.toneNotes !== after.toneNotes) parts.push('tone notes')
  for (const cls of PERMISSION_ORDER) {
    if (before.permissions[cls] !== after.permissions[cls]) parts.push(`${PERMISSION_LABELS[cls].name.toLowerCase()} ${before.permissions[cls]} to ${after.permissions[cls]}`)
  }
  const overridesBefore = Object.keys(before.actionOverrides).sort().join(',')
  const overridesAfter = Object.keys(after.actionOverrides).sort().join(',')
  if (overridesBefore !== overridesAfter) parts.push('switched-off actions')
  const listChange = (name: string, a: string[], b: string[]) => {
    const added = b.filter(item => !a.includes(item)).length
    const removed = a.filter(item => !b.includes(item)).length
    if (added) parts.push(`${added} ${name} added`)
    if (removed) parts.push(`${removed} ${name} removed`)
  }
  listChange('never-do rules', before.neverDo, after.neverDo)
  listChange('banned phrases', before.neverSay, after.neverSay)
  listChange('shop facts', before.facts, after.facts)
  return parts.length ? `Changed: ${parts.join(', ')}.` : ''
}
