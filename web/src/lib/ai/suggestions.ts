/**
 * The "Try one of these" prompts on an empty chat. They are chosen, not fixed:
 *   - nothing is offered that the shop's own rules switch off (no "text a customer" when
 *     the owner has said the assistant may not contact customers);
 *   - what is offered follows the shop: a question about open jobs only when there are
 *     open jobs, win-back on a Monday, money owed on a Friday, the month's numbers at the
 *     turn of the month;
 *   - the owner's own recent questions come back as "Ask again", so a routine question is one tap.
 *
 * Pure module: no imports from '@/' so node:test can load it directly.
 */
import { decideAction, type AiRules } from './shop-rules.ts'
import { describeFailure } from './chat-failure.ts'

export type Suggestion = { id: string; icon: string; title: string; prompt: string; hint?: string }

export type SuggestionContext = {
  repairOnly?: boolean
  rules?: AiRules | null
  /** Number of open jobs, or null/undefined while it is not known. */
  openJobs?: number | null
  /** The owner's earlier questions, newest first. */
  recentAsks?: string[]
  now?: Date
  limit?: number
}

const REPAIR: Suggestion[] = [
  { id: 'repair-code', icon: 'manual', title: 'Look up a trouble code', prompt: '2005 Honda Civic P0420' },
  { id: 'repair-diagram', icon: 'manual', title: 'Find a brake diagram', prompt: '2018 Jeep Wrangler brake diagram' },
  { id: 'repair-procedure', icon: 'wrench', title: 'Get a brake procedure', prompt: '2004 Honda Accord all four brakes procedure' },
  { id: 'repair-checks', icon: 'inspect', title: 'Check what to test first', prompt: 'P0300 diagnostic checks for a 2012 Chevy Silverado' },
  { id: 'repair-spec', icon: 'parts', title: 'Find a part spec', prompt: '2016 Cadillac Escalade front lower control arm specs' },
]

const ESTIMATE: Suggestion = { id: 'estimate', icon: 'doc', title: 'Write an estimate', prompt: 'Build me an estimate for front brakes on a 2019 Toyota Camry' }
const OWED: Suggestion = { id: 'owed', icon: 'dollar', title: 'Who owes you money', prompt: "Who hasn't paid in over 30 days?" }
const TEXT: Suggestion = { id: 'text', icon: 'send', title: 'Text a customer their car is ready', prompt: 'Text a customer that their car is ready for pickup' }
const JOBS: Suggestion = { id: 'jobs', icon: 'wrench', title: 'See open jobs', prompt: 'What jobs are open right now?' }
const WINBACK: Suggestion = { id: 'winback', icon: 'customers', title: 'Win back customers', prompt: "Who hasn't been in for 90+ days?" }
const MONTH: Suggestion = { id: 'month', icon: 'growth', title: 'Check this month', prompt: 'How much revenue this month?' }
const NEW_JOB: Suggestion = { id: 'new-job', icon: 'wrench', title: 'Open a job', prompt: 'Open a job for a customer' }
const LOOKUP: Suggestion = { id: 'lookup', icon: 'customers', title: 'Look up a customer', prompt: "Look up a customer's history" }

function allowed(rules: AiRules | null | undefined, action: string): boolean {
  if (!rules) return true
  return decideAction(rules, action).allowed
}

/** How a question reads on a button: one line, trimmed. */
function cleanAsk(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function suggestPrompts(context: SuggestionContext = {}): Suggestion[] {
  const limit = Math.max(1, Math.min(8, context.limit ?? 6))
  if (context.repairOnly) return REPAIR.slice(0, limit)
  const rules = context.rules
  const now = context.now ?? new Date()
  const day = now.getDay() // 0 Sunday
  const hour = now.getHours()
  const date = now.getDate()

  const canDraft = allowed(rules, 'createInvoice')
  const canText = allowed(rules, 'message.sms')
  const canOpenJob = allowed(rules, 'createJob')

  const ranked: { item: Suggestion; score: number }[] = []
  const add = (item: Suggestion, score: number, hint?: string) => ranked.push({ item: hint ? { ...item, hint } : item, score })

  if (canDraft) add(ESTIMATE, 60)
  add(OWED, day === 5 && hour >= 12 ? 95 : 70)
  if (canText) add(TEXT, 50)
  if (typeof context.openJobs === 'number') {
    if (context.openJobs > 0) add(JOBS, 80, context.openJobs >= 10 ? '10+ open' : `${context.openJobs} open`)
    else if (canOpenJob) add(NEW_JOB, 75)
  } else {
    add(JOBS, 55)
  }
  add(WINBACK, day === 1 ? 90 : 45)
  add(MONTH, date >= 26 || date <= 3 ? 92 : 40)
  add(LOOKUP, 30)

  const picked = ranked.sort((a, b) => b.score - a.score).map(entry => entry.item)

  // The owner's own questions come back, but never twice and never a copy of a suggestion.
  const taken = new Set(picked.map(item => item.prompt.toLowerCase()))
  const again: Suggestion[] = []
  for (const raw of context.recentAsks || []) {
    const text = cleanAsk(raw)
    if (text.length < 8 || text.length > 140) continue
    const key = text.toLowerCase()
    if (taken.has(key)) continue
    taken.add(key)
    again.push({ id: `again-${again.length}`, icon: 'refresh', title: 'Ask again', prompt: text })
    if (again.length === 2) break
  }
  // Put recent questions near the top (after the strongest suggestion), then fill with the rest.
  const [first, ...rest] = picked
  return [first, ...again, ...rest].filter(Boolean).slice(0, limit)
}

export type HistoryChat = { id: string; messages: Array<{ role: string; content?: unknown; html?: string; repairResult?: unknown }> }

/**
 * The questions on the start screen's "Ask again" buttons, newest chat first: the first question of each earlier chat.
 * The chat that is open is left out, and so is any question whose answer was an error (it stays in History, but
 * offering it again only invites the same failure). A question the owner stopped, or never got a reply to, is still offered.
 */
export function recentAsksFrom(history: HistoryChat[], openChatId?: string | null, max = 8): string[] {
  const asks: string[] = []
  for (const chat of history) {
    if (chat.id === openChatId) continue
    const messages = chat.messages || []
    const at = messages.findIndex(m => m.role === 'user' && typeof m.content === 'string' && m.content !== '')
    if (at < 0) continue
    // The reply to that question is everything up to the next question; the last assistant text in it is the outcome.
    const next = messages.findIndex((m, i) => i > at && m.role === 'user')
    const replies = messages.slice(at + 1, next < 0 ? messages.length : next)
      .filter(m => m.role === 'assistant' && typeof m.content === 'string' && m.content !== '' && !m.html && !m.repairResult)
    const outcome = replies[replies.length - 1]
    if (outcome && describeFailure(String(outcome.content))?.kind === 'failed') continue
    asks.push(String(messages[at].content))
    if (asks.length >= max) break
  }
  return asks
}

/** A plain mid-month Wednesday. Used for the first paint so the server and the browser agree; the real day takes over after load. */
export const NEUTRAL_NOW = new Date(2026, 0, 14, 10, 0)
