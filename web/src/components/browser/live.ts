// Live view: what the screen remembers about a page it is driving, and what one tap means.
// One tap is one action. Nothing here talks to the server; it only decides what to send and what to show.
import { looksLikeSecretValue } from '../../lib/browser/actions.ts'
import type { ApprovalDetails, LiveAction, PreparedStep } from '../../lib/browser/actions.ts'
import type { SnapControl, Snapshot } from '../../lib/browser/engine.ts'

export type Viewport = 'phone' | 'desktop'

export interface Notice { kind: 'info' | 'warn' | 'error'; text: string }

export interface PendingApproval {
  details: ApprovalDetails
  approvalId: string
  /** The one action to send again, with the approval, once it is granted. Null for a download (it has its own route). */
  action: LiveAction | null
  /** asking: waiting for the person. deciding: Approve or Deny is on its way. sending: approved, doing it. retry: approved but it did not go through. */
  phase: 'asking' | 'deciding' | 'sending' | 'retry'
  error: string
  actor: 'user' | 'ai'
}

export interface LiveState {
  viewport: Viewport
  /** The address the next call opens. */
  url: string
  snapshot: Snapshot | null
  /** Boxes already filled in on this page; they go back with every call so the page is put back the way it was. */
  prepared: PreparedStep[]
  scrollY: number
  busy: boolean
  selected: number | null
  did: string
  notice: Notice | null
  handoff: { reason: string; message: string } | null
  approval: PendingApproval | null
  /** Set only when no picture could be made at all. `blocked`: a site rule stopped it. */
  error: { message: string; setup: boolean; blocked: boolean } | null
  saved: string
}

export function initialLive(url: string, viewport: Viewport): LiveState {
  return {
    viewport, url, snapshot: null, prepared: [], scrollY: 0, busy: true, selected: null, did: '', notice: null,
    handoff: null, approval: null, error: null, saved: '',
  }
}

export type LiveEvent =
  | { type: 'start'; url: string; viewport: Viewport }
  | { type: 'busy' }
  | { type: 'reload' }
  | { type: 'ok'; snapshot: Snapshot; did: string }
  | { type: 'approval'; snapshot: Snapshot; details: ApprovalDetails; approvalId: string; action: LiveAction | null; actor: 'user' | 'ai' }
  | { type: 'handoff'; snapshot: Snapshot; reason: string; message: string }
  | { type: 'refused'; snapshot: Snapshot | null; message: string }
  | { type: 'failed'; message: string; setup: boolean; blocked?: boolean }
  | { type: 'select'; n: number | null }
  | { type: 'approvalPhase'; phase: PendingApproval['phase']; error?: string }
  | { type: 'approvalCleared'; notice?: Notice | null }
  | { type: 'saved'; text: string }
  | { type: 'dismiss' }

function withSnapshot(s: LiveState, snap: Snapshot): LiveState {
  return { ...s, snapshot: snap, url: snap.url, prepared: Array.isArray(snap.prepared) ? snap.prepared : [], scrollY: Number.isFinite(snap.scrollY) ? snap.scrollY : 0 }
}

export function liveReduce(state: LiveState | null, e: LiveEvent): LiveState {
  if (e.type === 'start') return initialLive(e.url, e.viewport)
  if (!state) return initialLive('', 'phone')
  const s = state
  switch (e.type) {
    case 'busy':
      return { ...s, busy: true, notice: null, handoff: null, error: null, saved: '' }
    case 'reload':
      return { ...s, prepared: [], scrollY: 0, busy: true, selected: null, notice: null, handoff: null, approval: null, error: null, saved: '' }
    case 'ok':
      return { ...withSnapshot(s, e.snapshot), busy: false, selected: null, did: e.did || '', notice: null, handoff: null, approval: null, error: null }
    case 'approval':
      return {
        ...withSnapshot(s, e.snapshot), busy: false, selected: null, notice: null, handoff: null, error: null,
        approval: { details: e.details, approvalId: e.approvalId, action: e.action, phase: 'asking', error: '', actor: e.actor },
      }
    case 'handoff':
      return { ...withSnapshot(s, e.snapshot), busy: false, selected: null, approval: null, error: null, notice: null, handoff: { reason: e.reason, message: e.message } }
    case 'refused': {
      const base = e.snapshot ? withSnapshot(s, e.snapshot) : s
      return { ...base, busy: false, approval: null, error: null, handoff: null, notice: { kind: 'warn', text: e.message } }
    }
    case 'failed':
      // An approved action that did not get through can be sent again with the same approval.
      if (s.approval && s.approval.phase === 'sending') return { ...s, busy: false, approval: { ...s.approval, phase: 'retry', error: e.message } }
      if (s.snapshot) return { ...s, busy: false, notice: { kind: 'error', text: e.message }, error: null }
      return { ...s, busy: false, approval: null, error: { message: e.message, setup: e.setup, blocked: e.blocked === true } }
    case 'select':
      return { ...s, selected: e.n }
    case 'approvalPhase':
      return s.approval ? { ...s, busy: e.phase === 'deciding' || e.phase === 'sending', approval: { ...s.approval, phase: e.phase, error: e.error ?? '' } } : s
    case 'approvalCleared':
      return { ...s, busy: false, approval: null, notice: e.notice ?? null }
    case 'saved':
      return { ...s, busy: false, saved: e.text }
    case 'dismiss':
      return { ...s, notice: null, saved: '' }
  }
}

/* ---------- what a tap on a control does ---------- */

export type TapMode = 'open' | 'press' | 'type' | 'choose' | 'tick' | 'none'

export interface TapPlan {
  mode: TapMode
  enabled: boolean
  /** Why nothing can be done here, in plain words. */
  reason: string
  /** An approval card will come first. */
  asks: boolean
  /** The button text. */
  word: string
}

export const ROLE_WORDS = 'Your role can look at pages but not fill in or send anything.'
export const HANDOFF_FIELD_WORDS = 'Alpha never types passwords, card numbers, security codes or one-time codes. Do this step on the website yourself.'
export const HANDOFF_STEP_WORDS = 'This is a sign-in or human check. Do this step on the website yourself.'

const TYPABLE = ['text', 'search', 'email', 'tel', 'number', 'url', 'textarea']

export function planTap(c: SnapControl, canAct: boolean): TapPlan {
  const none = (reason: string): TapPlan => ({ mode: 'none', enabled: false, reason, asks: false, word: '' })
  if (!canAct) return none(ROLE_WORDS)
  if (c.disabled) return none('This is turned off on the page.')
  if (c.risk === 'handoff') return none(c.sensitive ? HANDOFF_FIELD_WORDS : HANDOFF_STEP_WORDS)
  const asks = c.risk === 'approve'
  if (c.kind === 'link') return { mode: 'open', enabled: true, reason: '', asks, word: 'Open link' }
  if (c.kind === 'button' || c.kind === 'submit') return { mode: 'press', enabled: true, reason: '', asks, word: 'Tap button' }
  if (TYPABLE.includes(c.kind)) return { mode: 'type', enabled: true, reason: '', asks: false, word: 'Fill in' }
  if (c.kind === 'select') return { mode: 'choose', enabled: true, reason: '', asks: false, word: 'Choose' }
  if (c.kind === 'checkbox' || c.kind === 'radio') return { mode: 'tick', enabled: true, reason: '', asks, word: c.kind === 'checkbox' && c.checked ? 'Clear the tick' : 'Tick' }
  return none('Alpha cannot use this kind of control.')
}

const KIND_WORD: Record<string, string> = {
  link: 'Link', button: 'Button', submit: 'Button', text: 'Box to type in', search: 'Search box', email: 'Email box', tel: 'Phone box',
  number: 'Number box', url: 'Address box', textarea: 'Box to type in', select: 'Drop-down list', checkbox: 'Tick box', radio: 'Choice', file: 'File picker', other: 'Control',
}

export function kindWord(kind: string): string {
  return KIND_WORD[kind] || 'Control'
}

export type Lamp = 'green' | 'amber' | 'red' | 'blue' | 'off'

/** The lamp and the word that go with what a control needs. */
export function riskWord(c: SnapControl): { lamp: Lamp; word: string } {
  if (c.risk === 'handoff') return { lamp: 'red', word: 'You do this on the website' }
  if (c.risk === 'approve') return { lamp: 'amber', word: 'Asks you first' }
  return { lamp: 'green', word: 'Safe to tap' }
}

/** The text to show for a control: its name, and what it holds if it is a box. */
export function controlTitle(c: SnapControl): string {
  const label = String(c.label || '').trim()
  return label || kindWord(c.kind)
}

/** Controls split into what is on the picture and what is further down the page. */
export function groupControls(snap: Snapshot | null): { shown: SnapControl[]; below: SnapControl[] } {
  const list = Array.isArray(snap?.controls) ? snap!.controls : []
  return { shown: list.filter(c => c.inView), below: list.filter(c => !c.inView) }
}

export interface HitBox { left: number; top: number; width: number; height: number }

/** Where a control sits on the picture, in percent, so it can be tapped on the picture itself. Null when it cannot be placed. */
export function hitBox(c: SnapControl, snap: Snapshot): HitBox | null {
  const vw = Number(snap?.viewport?.w)
  const vh = Number(snap?.viewport?.h)
  const r = c.rect
  if (!c.inView || !r || !(vw > 0) || !(vh > 0) || !(r.w > 0) || !(r.h > 0)) return null
  const left = Math.max(0, Math.min(100, (r.x / vw) * 100))
  const top = Math.max(0, Math.min(100, (r.y / vh) * 100))
  const width = Math.max(0, Math.min(100 - left, (r.w / vw) * 100))
  const height = Math.max(0, Math.min(100 - top, (r.h / vh) * 100))
  if (width < 0.5 || height < 0.5) return null
  return { left, top, width, height }
}

/* ---------- what is sent ---------- */

export const MAX_TYPED = 2000

/** Is this what the person typed fit to send? Returns a reason in plain words, or null. */
export function vetTyped(value: string): string | null {
  if (value.length > MAX_TYPED) return 'That is too long to type in. Shorten it and try again.'
  const secret = looksLikeSecretValue(value)
  if (secret === 'card') return 'That looks like a card number. Alpha does not type card numbers. Do this step on the website yourself.'
  if (secret === 'ssn') return 'That looks like a social security number. Alpha does not type it. Do this step on the website yourself.'
  if (secret === 'secret') return 'That looks like a password or secret key. Alpha does not type it.'
  return null
}

export function fillAction(c: SnapControl, value: string): LiveAction {
  return { kind: 'fill', ref: c.ref, value }
}
export function pressAction(c: SnapControl): LiveAction {
  return { kind: 'press', key: 'Enter', ref: c.ref }
}
export function clickAction(c: SnapControl): LiveAction {
  return { kind: 'click', ref: c.ref }
}
export function selectAction(c: SnapControl, value: string): LiveAction {
  return { kind: 'select', ref: c.ref, value }
}

export function scrollAction(s: LiveState, direction: 'up' | 'down'): LiveAction {
  const h = s.snapshot?.viewport?.h || (s.viewport === 'phone' ? 844 : 800)
  const dy = Math.max(200, Math.min(4000, Math.round(h * 0.8)))
  return { kind: 'scroll', dy: direction === 'down' ? dy : -dy }
}

export interface LiveBody {
  url: string
  prepared: PreparedStep[]
  action?: LiveAction
  actor: 'user' | 'ai'
  approvalId?: string
  scrollY: number
  viewport: Viewport
}

/** The request for one call. The server allows 30 kept entries, so only the newest 30 are sent. */
export function liveBody(s: LiveState, opts: { action?: LiveAction; approvalId?: string; actor?: 'user' | 'ai' } = {}): LiveBody {
  const body: LiveBody = {
    url: s.url,
    prepared: s.prepared.slice(-30),
    actor: opts.actor || 'user',
    scrollY: Math.max(0, Math.round(s.scrollY || 0)),
    viewport: s.viewport,
  }
  if (opts.action) body.action = opts.action
  if (opts.approvalId) body.approvalId = opts.approvalId
  return body
}

/** The lamp and the words for the top of Live view: who is driving and what it is doing. */
export function liveStatus(s: LiveState): { lamp: Lamp; word: string } {
  if (!s.snapshot) {
    if (s.error) return { lamp: 'red', word: 'Could not open the page' }
    return { lamp: 'blue', word: 'Opening the page' }
  }
  if (s.approval) return { lamp: 'amber', word: 'Waiting for your OK' }
  if (s.busy) return { lamp: 'blue', word: 'Working on the page' }
  if (s.handoff || s.snapshot.signInRequired || s.snapshot.captcha) return { lamp: 'amber', word: 'This step is for you' }
  return { lamp: 'blue', word: 'You are driving' }
}

export const SIGN_IN_WORDS = 'This site asks for a sign-in. Alpha does not sign in to websites or type passwords, card numbers or one-time codes. Open the site in your own browser to do that step.'

/** What to say when a page needs a sign-in or a person: the server's own words first, then what to do. */
export function handoffText(s: LiveState): { title: string; body: string } | null {
  if (s.handoff) {
    const title = s.handoff.reason === 'captcha' ? 'This site wants you to prove you are a person' : s.handoff.reason === 'credential' ? 'This step needs private details' : 'This step is a sign-in'
    return { title, body: s.handoff.message }
  }
  if (s.snapshot?.signInRequired) return { title: 'This site asks for a sign-in', body: SIGN_IN_WORDS }
  return null
}
