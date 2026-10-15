/**
 * Who answered the phone: the AI assistant, a person, or nobody. Built from the call log and the AI assistant's own log.
 *
 * What the logs can and cannot say is part of the answer. The AI log records that it handled a call, not how long it ran or
 * whether the caller booked, so this counts calls handled and never claims appointments or dollars.
 */
import { dayOfStamp } from './report-docs.ts'
import type { AiCall } from './report-load.ts'
import { inRange } from './reports.ts'
import type { Range, ReportCall } from './reports.ts'

export const SHORT_SECONDS = 15
const MISSED_WORDS = /miss|no.?answer|unanswer|busy|cancel|fail|abandon|voicemail/i

export interface CallSplit {
  /** Every incoming call in the period. */
  inbound: number
  /** The AI assistant picked up and handled it. */
  byAi: number
  /** A person talked to the caller. */
  byPeople: number
  /** Nobody talked to the caller: a missed call, or one that ended in under 15 seconds. */
  missed: number
  /** Whole percent of incoming calls the AI handled. Null when there were no incoming calls. */
  aiPct: number | null
  /** Whole percent of incoming calls nobody answered. Null when there were no incoming calls. */
  missedPct: number | null
  /** Ids of the call log rows behind each count, so the screen can show which calls. */
  missedIds: string[]
}

export function callSplit(history: ReportCall[], ai: AiCall[], range: Range): CallSplit {
  const aiIds = new Set(ai.map(a => a.id))
  const seen = new Set<string>()
  const out: CallSplit = { inbound: 0, byAi: 0, byPeople: 0, missed: 0, aiPct: null, missedPct: null, missedIds: [] }
  for (const c of history) {
    if (c.callId) seen.add(c.callId)
    if (c.direction !== 'inbound' && c.direction !== 'in') continue
    const day = dayOfStamp(c.start)
    if (!day || !inRange(day, range)) continue
    out.inbound += 1
    if (c.callId && aiIds.has(c.callId)) out.byAi += 1
    else if (MISSED_WORDS.test(c.status || '') || c.seconds < SHORT_SECONDS) { out.missed += 1; out.missedIds.push(c.id) }
    else out.byPeople += 1
  }
  // Calls only the AI log knows about (the phone company's record never arrived).
  for (const a of ai) {
    if (!a.inbound || seen.has(a.id)) continue
    const day = dayOfStamp(a.start)
    if (!day || !inRange(day, range)) continue
    out.inbound += 1; out.byAi += 1
  }
  if (out.inbound > 0) {
    out.aiPct = Math.round((out.byAi / out.inbound) * 100)
    out.missedPct = Math.round((out.missed / out.inbound) * 100)
  }
  return out
}

/**
 * The phone company's call log plus the calls only the AI assistant's log knows about, as one list of incoming calls.
 * The Reports screen and the emailed summary both use this, so they count the same calls.
 */
export function withAiOnlyCalls(history: ReportCall[], ai: AiCall[]): ReportCall[] {
  const seen = new Set(history.map(c => c.callId).filter(Boolean))
  const extra: ReportCall[] = ai.filter(a => a.inbound && !seen.has(a.id)).map(a => ({ id: `ai-${a.id}`, direction: 'inbound', seconds: 60, start: a.start }))
  return extra.length ? [...history, ...extra] : history
}

export const CALL_SPLIT_NOTE =
  'The AI assistant\'s log records that it handled a call, not how long it ran or what the caller decided, so this counts calls handled. It does not count appointments booked or money earned from them.'
