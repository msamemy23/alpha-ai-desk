// Reading what the browser routes send back without trusting its shape. A missing or odd field becomes a safe default,
// never a crash. Anything that cannot be understood at all is null, and the screen says so in plain words.
import type { ApprovalDetails, ApprovalKind, ControlKind, LiveAction, PreparedStep } from '../../lib/browser/actions.ts'
import type { AgentStepResult } from '../../lib/browser/agent-run.ts'
import type { LiveOutcome, SnapControl, Snapshot } from '../../lib/browser/engine.ts'
import type { Block, Inline, ReaderDoc, SearchHit } from '../../lib/browser/reader.ts'
import type { SensitiveKind } from '../../lib/browser/actions.ts'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function cleanRuns(v: unknown): Inline[] {
  return list(v).flatMap(r => {
    if (!isObj(r) || typeof r.t !== 'string') return []
    const run: Inline = { t: r.t.slice(0, 4000) }
    if (typeof r.href === 'string') run.href = r.href.slice(0, 2048)
    if (typeof r.n === 'number' && Number.isFinite(r.n)) run.n = r.n
    if (r.b === true) run.b = true
    if (r.i === true) run.i = true
    if (r.code === true) run.code = true
    return [run]
  }).slice(0, 400)
}

const whole = (v: unknown, min: number, max: number, d: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d
}

/** One block of a page, rebuilt from only the parts that are understood. Anything else is not a block. */
function cleanBlock(raw: unknown): Block | null {
  if (!isObj(raw)) return null
  switch (raw.k) {
    case 'h': return { k: 'h', level: whole(raw.level, 1, 4, 3) as 1 | 2 | 3 | 4, runs: cleanRuns(raw.runs) }
    case 'p': return { k: 'p', runs: cleanRuns(raw.runs) }
    case 'quote': return { k: 'quote', runs: cleanRuns(raw.runs) }
    case 'li': return { k: 'li', depth: whole(raw.depth, 0, 6, 0), ordered: raw.ordered === true, index: whole(raw.index, 1, 100000, 1), runs: cleanRuns(raw.runs) }
    case 'pre': return { k: 'pre', text: str(raw.text, 20000) }
    case 'img': return { k: 'img', src: str(raw.src, 2048), alt: str(raw.alt, 300) }
    case 'table': return { k: 'table', header: raw.header === true, rows: list(raw.rows).slice(0, 200).map(row => list(row).slice(0, 30).map(c => str(c, 400))) }
    case 'form': return { k: 'form', summary: str(raw.summary, 300) }
    case 'facts': {
      const rows = list(raw.rows).flatMap(r => (Array.isArray(r) && r.length >= 2 ? [[str(r[0], 120), str(r[1], 400)] as [string, string]] : [])).slice(0, 60)
      return { k: 'facts', title: str(raw.title, 120), rows }
    }
    case 'hr': return { k: 'hr' }
    default: return null
  }
}

/** Reader view answer: { ok, doc, finalUrl, images }. */
export function cleanRead(body: unknown): { doc: ReaderDoc; finalUrl: string; images: boolean } | null {
  if (!isObj(body) || !isObj(body.doc)) return null
  const d = body.doc
  const blocks = list(d.blocks).slice(0, 1200).map(cleanBlock).filter((b): b is Block => b !== null)
  const inj = isObj(d.injection) ? d.injection : {}
  const url = str(d.url, 2048)
  const doc: ReaderDoc = {
    url, title: str(d.title, 300) || 'Untitled page', siteName: str(d.siteName, 120), description: str(d.description, 400), lang: str(d.lang, 12),
    blocks,
    links: list(d.links).flatMap(l => (isObj(l) && typeof l.href === 'string' ? [{ n: num(l.n), text: str(l.text, 200), href: str(l.href, 2048) }] : [])),
    forms: list(d.forms).flatMap(f => (isObj(f) ? [{ method: str(f.method, 8), action: str(f.action, 2048), fields: [], summary: str(f.summary, 300) }] : [])),
    text: str(d.text, 200000),
    truncated: d.truncated === true,
    signInRequired: d.signInRequired === true,
    hasFields: d.hasFields === true,
    // The excerpts are page text and are never shown, so they are not kept. Which kind of warning to give still needs `where`.
    injection: {
      suspected: inj.suspected === true,
      hits: list(inj.hits).flatMap(h => (isObj(h) ? [{ id: str(h.id, 40), label: str(h.label, 120), where: h.where === 'hidden' ? 'hidden' as const : 'visible' as const, excerpt: '' }] : [])).slice(0, 8),
      hiddenText: inj.hiddenText === true,
    },
    chars: num(d.chars),
  }
  return { doc, finalUrl: str(body.finalUrl, 2048) || url, images: body.images !== false }
}

/** Search answer: { ok, query, hits, hidden }. */
export function cleanSearch(body: unknown): { query: string; hits: SearchHit[]; hidden: number } | null {
  if (!isObj(body) || !Array.isArray(body.hits)) return null
  const hits: SearchHit[] = body.hits.flatMap(h => {
    if (!isObj(h)) return []
    const url = str(h.url, 2048)
    if (!/^https?:\/\//i.test(url)) return []
    return [{ title: str(h.title, 200) || str(h.host, 120) || url, url, snippet: str(h.snippet, 400), host: str(h.host, 120) }]
  })
  return { query: str(body.query, 300), hits, hidden: Math.max(0, Math.round(num(body.hidden))) }
}

const CONTROL_KINDS = new Set<string>(['link', 'button', 'submit', 'text', 'search', 'email', 'tel', 'number', 'url', 'textarea', 'select', 'checkbox', 'radio', 'file', 'other'])
const SENSITIVE = new Set<string>(['password', 'card', 'security_code', 'otp', 'ssn', 'bank', 'identity'])

function cleanControl(raw: unknown, i: number): SnapControl | null {
  if (!isObj(raw) || !isObj(raw.ref)) return null
  const loc = str(raw.ref.loc, 500)
  const fp = str(raw.ref.fp, 40)
  if (!loc || !fp) return null
  const rect = isObj(raw.rect) ? raw.rect : {}
  const kind = CONTROL_KINDS.has(str(raw.kind, 20)) ? (str(raw.kind, 20) as ControlKind) : 'other'
  const risk = raw.risk === 'approve' || raw.risk === 'handoff' ? raw.risk : 'safe'
  const sens = str(raw.sensitive, 20)
  return {
    n: Number.isInteger(raw.n) ? (raw.n as number) : i + 1,
    ref: { loc, fp }, kind, label: str(raw.label, 120), rect: { x: num(rect.x), y: num(rect.y), w: num(rect.w), h: num(rect.h) },
    inView: raw.inView === true, value: str(raw.value, 200), checked: raw.checked === true, disabled: raw.disabled === true,
    options: list(raw.options).filter((o): o is string => typeof o === 'string').slice(0, 200).map(o => o.slice(0, 120)),
    risk, sensitive: SENSITIVE.has(sens) ? (sens as SensitiveKind) : null, href: str(raw.href, 600),
  }
}

function cleanPrepared(raw: unknown): PreparedStep[] {
  return list(raw).flatMap(p => {
    if (!isObj(p) || !isObj(p.ref)) return []
    if (p.kind !== 'fill' && p.kind !== 'select' && p.kind !== 'check') return []
    const loc = str(p.ref.loc, 500)
    const fp = str(p.ref.fp, 40)
    if (!loc || !fp || typeof p.value !== 'string') return []
    return [{ kind: p.kind, ref: { loc, fp }, value: p.value.slice(0, 2000) } as PreparedStep]
  })
}

export function cleanSnapshot(raw: unknown): Snapshot | null {
  if (!isObj(raw)) return null
  const url = str(raw.url, 2048)
  if (!url) return null
  const vp = isObj(raw.viewport) ? raw.viewport : {}
  const inj = isObj(raw.injection) ? raw.injection : {}
  const image = str(raw.image, 8_000_000)
  return {
    url, host: str(raw.host, 253), title: str(raw.title, 300), status: typeof raw.status === 'number' ? raw.status : null,
    scrollY: Math.max(0, num(raw.scrollY)), scrollHeight: Math.max(0, num(raw.scrollHeight)), viewport: { w: num(vp.w), h: num(vp.h) },
    // Only a picture the server made ever goes in an image tag.
    image: /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image) ? image : '',
    controls: list(raw.controls).map(cleanControl).filter((c): c is SnapControl => c !== null).slice(0, 200),
    text: str(raw.text, 20000),
    injection: { suspected: inj.suspected === true, hits: list(inj.hits).filter((h): h is string => typeof h === 'string').slice(0, 6), hiddenText: inj.hiddenText === true },
    signInRequired: raw.signInRequired === true, captcha: raw.captcha === true,
    downloads: list(raw.downloads).flatMap(d => (isObj(d) ? [{ url: str(d.url, 2048), type: str(d.type, 80), name: str(d.name, 120) }] : [])).slice(0, 5),
    blocked: list(raw.blocked).flatMap(b => (isObj(b) ? [{ url: str(b.url, 2048), reason: str(b.reason, 300) }] : [])).slice(0, 8),
    prepared: cleanPrepared(raw.prepared),
    notes: list(raw.notes).filter((n): n is string => typeof n === 'string').slice(0, 8).map(n => n.slice(0, 300)),
  }
}

const APPROVAL_KINDS = new Set<string>(['submit', 'purchase', 'send', 'download', 'delete', 'terms', 'open_site'])

export function cleanApprovalDetails(raw: unknown): ApprovalDetails | null {
  if (!isObj(raw)) return null
  const kind = str(raw.kind, 20)
  if (!APPROVAL_KINDS.has(kind)) return null
  return {
    kind: kind as ApprovalKind, title: str(raw.title, 80), summary: str(raw.summary, 800), host: str(raw.host, 253), url: str(raw.url, 2048),
    fields: list(raw.fields).flatMap(f => (isObj(f) ? [{ label: str(f.label, 80), value: str(f.value, 200) }] : [])).slice(0, 12), why: str(raw.why, 300),
  }
}

const CODES = new Set(['blocked', 'load', 'timeout', 'engine', 'needs_update'])

/** The live view answer: { ok, outcome }. */
export function cleanLive(body: unknown): LiveOutcome | null {
  if (!isObj(body) || !isObj(body.outcome)) return null
  const o = body.outcome
  const status = str(o.status, 12)
  if (status === 'error') {
    const code = str(o.code, 20)
    return { status: 'error', code: (CODES.has(code) ? code : 'engine') as 'blocked' | 'load' | 'timeout' | 'engine' | 'needs_update', message: str(o.message, 400) || 'The page could not be shown right now. Try again in a moment.' }
  }
  const snapshot = cleanSnapshot(o.snapshot)
  if (status === 'refused') return { status: 'refused', snapshot, message: str(o.message, 400) || 'Nothing was done.' }
  if (!snapshot) return null
  if (status === 'ok') return { status: 'ok', snapshot, did: str(o.did, 300) || undefined }
  if (status === 'handoff') {
    const reason = str(o.reason, 12)
    return { status: 'handoff', snapshot, reason: reason === 'credential' || reason === 'captcha' ? reason : 'sign_in', message: str(o.message, 400) }
  }
  if (status === 'approval') {
    const approval = cleanApprovalDetails(o.approval)
    if (!approval) return null
    return { status: 'approval', snapshot, approval, approvalId: str(o.approvalId, 64), canonical: '' }
  }
  return null
}

function cleanStep(raw: unknown): { n: number; did: string; result: string } {
  const r = isObj(raw) ? raw : {}
  return { n: Number.isInteger(r.n) ? (r.n as number) : 1, did: str(r.did, 300), result: str(r.result, 300) }
}

/** One step of Ask Alpha: { ok, result }. */
export function cleanAgent(body: unknown): AgentStepResult | null {
  if (!isObj(body) || !isObj(body.result)) return null
  const r = body.result
  const status = str(r.status, 20)
  if (status === 'error') return { status: 'error', message: str(r.message, 400) || 'Alpha could not do that step.' }
  const step = cleanStep(r.step)
  const snapshot = r.snapshot === null || r.snapshot === undefined ? null : cleanSnapshot(r.snapshot)
  if (status === 'continue') {
    const nav = str(r.navigateTo, 2048)
    return { status: 'continue', step, snapshot, ...(/^https?:\/\//i.test(nav) ? { navigateTo: nav } : {}) }
  }
  if (status === 'done') {
    if (!snapshot) return null
    return { status: 'done', answer: str(r.answer, 1200), evidence: str(r.evidence, 600), verified: r.verified === true, step, snapshot }
  }
  if (status === 'needs_user') return { status: 'needs_user', message: str(r.message, 500) || 'Alpha needs you to do this step.', step, snapshot }
  if (status === 'needs_approval') {
    const approval = cleanApprovalDetails(r.approval)
    const approvalId = str(r.approvalId, 64)
    const resume = isObj(r.resume) ? r.resume : {}
    if (!approval || !approvalId) return null
    if (resume.kind === 'open') return { status: 'needs_approval', step, snapshot, approval, approvalId, resume: { kind: 'open', url: str(resume.url, 2048) } }
    if (resume.kind === 'live' && isObj(resume.action)) {
      const action = cleanAction(resume.action)
      if (!action) return null
      return { status: 'needs_approval', step, snapshot, approval, approvalId, resume: { kind: 'live', action } }
    }
    return null
  }
  return null
}

function cleanRef(raw: unknown): { loc: string; fp: string } | null {
  if (!isObj(raw)) return null
  const loc = str(raw.loc, 500)
  const fp = str(raw.fp, 40)
  return loc && fp ? { loc, fp } : null
}

/** An action the server named, checked before it is sent back. */
export function cleanAction(raw: Record<string, unknown>): LiveAction | null {
  const ref = cleanRef(raw.ref)
  if ((raw.kind === 'fill' || raw.kind === 'select' || raw.kind === 'check') && ref && typeof raw.value === 'string') return { kind: raw.kind, ref, value: raw.value.slice(0, 2000) }
  if (raw.kind === 'click' && ref) return { kind: 'click', ref }
  if (raw.kind === 'press' && raw.key === 'Enter') return ref ? { kind: 'press', key: 'Enter', ref } : { kind: 'press', key: 'Enter' }
  if (raw.kind === 'scroll' && typeof raw.dy === 'number' && Number.isFinite(raw.dy)) return { kind: 'scroll', dy: Math.max(-4000, Math.min(4000, Math.round(raw.dy))) }
  return null
}
