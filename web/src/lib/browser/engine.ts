/**
 * The live page engine: open a page in the locked browser, put back what was filled in, do ONE action, and report what the
 * page looks like now.
 *
 * Nothing stays running between calls. The screen keeps the address, the entries made so far (`prepared`) and the scroll
 * position, and sends them with every tap. Each call starts a fresh locked browser, replays the entries, acts, takes a
 * picture and closes. That fits a serverless host (no long-lived browser or socket) and means a crashed call loses nothing.
 *
 * Rules enforced here, not in the screen:
 *  - the page is read through a separate "isolated world", so its own scripts cannot lie about what a field is,
 *  - clicks and key presses are real input events at the spot the control is actually drawn; if something is drawn on
 *    top of it, nothing is clicked,
 *  - passwords, card numbers, security codes, bank details and one-time codes are never typed (see ./actions.ts),
 *  - anything that sends, buys, deletes, agrees or downloads stops and shows the exact action first; it only happens
 *    when `authorize` says a person approved that exact action,
 *  - one approved form submission is allowed through, to exactly the address that was shown, once.
 */
import type { Browser, CDPSession, Page } from 'puppeteer-core'
import { installNetworkGuard, launchLockedBrowser, waitForQuiet } from '../hosted-browser.ts'
import type { GuardOptions, ResourceFetcher, Viewport } from '../hosted-browser.ts'
import { PAGE_SCRIPT } from './page-script.ts'
import {
  canonicalAction, classifyClick, controlKind, controlLabel, describeApproval, fingerprint, isTypable, maskValue, sensitiveKind, vetFill,
} from './actions.ts'
import type {
  ApprovalDetails, ApprovalKind, ControlKind, ControlRef, FieldValue, FormMeta, LiveAction, LiveRequest, PreparedStep, RawControl, SensitiveKind,
} from './actions.ts'
import { cleanPageText, inspectPageText } from './untrusted.ts'
import { displayHost } from './url.ts'

export interface SnapControl {
  /** 1-based number in reading order; this is how the AI and the screen point at a control. */
  n: number
  ref: ControlRef
  kind: ControlKind
  label: string
  rect: { x: number; y: number; w: number; h: number }
  inView: boolean
  /** What the field holds right now, masked for anything sensitive. */
  value: string
  checked: boolean
  disabled: boolean
  options: string[]
  /** safe = just do it, approve = ask first, handoff = the person does this on the website. */
  risk: 'safe' | 'approve' | 'handoff'
  sensitive: SensitiveKind | null
  /** For links: the address it goes to. */
  href: string
}

export interface Snapshot {
  url: string
  host: string
  title: string
  status: number | null
  scrollY: number
  scrollHeight: number
  viewport: { w: number; h: number }
  /** A JPEG picture of what is on screen, as a data address. */
  image: string
  controls: SnapControl[]
  /** What a person sees on the page. Untrusted: wrap it before it goes near an AI. */
  text: string
  injection: { suspected: boolean; hits: string[]; hiddenText: boolean }
  signInRequired: boolean
  captcha: boolean
  downloads: Array<{ url: string; type: string; name: string }>
  blocked: Array<{ url: string; reason: string }>
  /** The entries that are still in place; the screen sends these back on the next call. */
  prepared: PreparedStep[]
  notes: string[]
}

export type LiveOutcome =
  | { status: 'ok'; snapshot: Snapshot; did?: string }
  | { status: 'approval'; snapshot: Snapshot; approval: ApprovalDetails; approvalId: string; canonical: string }
  | { status: 'handoff'; snapshot: Snapshot; reason: 'sign_in' | 'credential' | 'captcha'; message: string }
  | { status: 'refused'; snapshot: Snapshot | null; message: string }
  | { status: 'error'; code: 'blocked' | 'load' | 'timeout' | 'engine' | 'needs_update'; message: string }

export interface AuthorizeInput { kind: ApprovalKind; canonical: string; details: ApprovalDetails; approvalId?: string }
export type AuthorizeResult = { granted: true } | { granted: false; approvalId: string }

export interface EngineDeps {
  check: NonNullable<GuardOptions['check']>
  fetchResource: ResourceFetcher
  /** Decides what happens to an action that needs a person: consume an approval that matches, or record a pending one. */
  authorize: (input: AuthorizeInput) => Promise<AuthorizeResult>
  /**
   * For the assistant: when the request has no action, look at the page first (no picture yet), let this choose one action,
   * then do it in the same browser. Return null to do nothing and just report the page.
   */
  decide?: (snapshot: Snapshot) => Promise<LiveAction | null>
  launcher?: Parameters<typeof launchLockedBrowser>[1]
  /** Whole-call time limit. */
  timeoutMs?: number
  /** Tests only: stop the engine and the page from sharing one reading of the clock. */
  settleMs?: number
}

const VIEWPORTS: Record<'phone' | 'desktop', Viewport> = {
  phone: { width: 390, height: 844, isMobile: true },
  desktop: { width: 1280, height: 800 },
}
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 AlphaDesk/1.0'
const SENSITIVE_STOP = 'Alpha does not type passwords, card numbers, security codes, bank details or one-time codes. Do this step on the website yourself.'

/* ---------- reading and driving the page through the isolated world ---------- */

class Inspector {
  private page: Page
  private client: CDPSession
  private ctx: number | null = null

  constructor(page: Page, client: CDPSession) {
    this.page = page
    this.client = client
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) this.ctx = null })
  }

  private async raw(expression: string, contextId: number): Promise<unknown> {
    const res = await this.client.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: false })
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'The page could not be read.')
    return res.result.value
  }

  private async ensure(): Promise<number> {
    if (this.ctx !== null) return this.ctx
    const tree = await this.client.send('Page.getFrameTree')
    const world = await this.client.send('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: 'alpha-reader', grantUniveralAccess: false })
    await this.raw(PAGE_SCRIPT, world.executionContextId)
    this.ctx = world.executionContextId
    return this.ctx
  }

  async call<T = unknown>(fn: 'collect' | 'locate' | 'setSelect' | 'focusAndClear' | 'focusOnly' | 'scrollTo', ...args: unknown[]): Promise<T> {
    const expression = `globalThis.__alpha.${fn}(${args.map(a => JSON.stringify(a === undefined ? null : a)).join(',')})`
    for (let attempt = 0; ; attempt++) {
      try {
        return (await this.raw(expression, await this.ensure())) as T
      } catch (e) {
        this.ctx = null
        if (attempt >= 1) throw e
        await new Promise(resolve => setTimeout(resolve, 150))
      }
    }
  }
}

interface Located {
  control: RawControl & { formFields?: Array<{ raw: RawControl; value: string }> }
  point: { x: number; y: number }
  covered: boolean
  forms: FormMeta[]
  captcha: boolean
}

interface Collected {
  url: string
  title: string
  scrollY: number
  scrollHeight: number
  viewport: { w: number; h: number }
  controls: Array<RawControl & { inView: boolean }>
  forms: FormMeta[]
  text: string
  hidden: string
  hasPassword: boolean
  captcha: boolean
}

function stripHash(url: string): string {
  const i = url.indexOf('#')
  return i === -1 ? url : url.slice(0, i)
}

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) }

function sameDocument(a: string, b: string): boolean { return stripHash(a) === stripHash(b) }

/* ---------- the call ---------- */

export async function runLive(req: LiveRequest, deps: EngineDeps): Promise<LiveOutcome> {
  const stopFirst = await deps.check(req.url, { navigation: true })
  if (stopFirst) return { status: 'error', code: 'blocked', message: stopFirst }

  const viewport = VIEWPORTS[req.viewport]
  const total = deps.timeoutMs ?? 42_000
  const deadline = AbortSignal.timeout(total)
  let browser: Browser | undefined
  const watchdog = setTimeout(() => { void browser?.close().catch(() => {}) }, total + 8_000)

  try {
    browser = await launchLockedBrowser(viewport, deps.launcher)
    const page = await browser.newPage()
    const userAgent = req.viewport === 'phone' ? PHONE_UA : undefined
    if (userAgent) await page.setUserAgent(userAgent)

    // One approved submission may go through, once, to exactly one address.
    let postUrl: string | null = null
    const guard = await installNetworkGuard(page, {
      deadline, fetchResource: deps.fetchResource, check: deps.check, userAgent,
      allowPost: url => { if (postUrl !== null && stripHash(url) === postUrl) { postUrl = null; return true } return false },
    })
    page.setDefaultTimeout(8000)
    const client = await page.createCDPSession()
    const insp = new Inspector(page, client)
    const settle = deps.settleMs ?? 1

    const notes: string[] = []
    const prepared: PreparedStep[] = []

    const loadTarget = async (url: string) => {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
      } catch {
        // A page that reached the screen is fine even if it never finished loading.
        if (!page.url() || page.url() === 'about:blank') {
          const why = guard.blocked.find(b => stripHash(b.url) === stripHash(url))?.reason
          return why || 'The page could not be opened.'
        }
      }
      await waitForQuiet(guard, 400 * settle, 3500 * settle)
      if (!/^https?:/i.test(page.url())) return guard.blocked[0]?.reason || 'The page could not be opened.'
      return null
    }

    const failedLoad = await loadTarget(req.url)
    if (failedLoad) return { status: 'error', code: guard.blocked.length ? 'blocked' : 'load', message: failedLoad }
    if (guard.mainStatus !== null && guard.mainStatus >= 400) {
      return { status: 'error', code: 'load', message: `The website answered with an error (${guard.mainStatus}).` }
    }

    const locate = (ref: ControlRef, scroll = true) => insp.call<Located | null>('locate', ref.loc, scroll)

    /* put back what was filled in */
    let lastLabel = ''
    const applyStep = async (step: PreparedStep, actor: 'user' | 'ai'): Promise<string | null> => {
      const found = await locate(step.ref)
      if (!found) return 'A field that was filled in is no longer on the page.'
      lastLabel = cleanPageText(controlLabel(found.control), 60)
      if (fingerprint(found.control) !== step.ref.fp) return 'A field on the page changed, so Alpha did not fill it in again.'
      const refused = vetFill(found.control, step.value, actor)
      if (refused) return refused
      // A form with a password field is a sign-in form. Even its user name box is left to the person.
      if (found.forms[0]?.hasPassword) return 'This is a sign-in form. Alpha does not sign in to websites. Do this step on the website yourself.'
      const kind = controlKind(found.control)
      if (step.kind === 'select') {
        if (kind !== 'select') return 'That is not a drop-down list.'
        return (await insp.call<boolean>('setSelect', step.ref.loc, step.value)) ? null : 'That choice is not in the list.'
      }
      if (step.kind === 'check') {
        if (kind !== 'checkbox' && kind !== 'radio') return 'That is not a tick box.'
        const want = /^(true|1|on|yes|checked)$/i.test(step.value)
        if (found.control.checked === want) return null
        if (found.covered) return 'Something is drawn over that tick box, so Alpha left it alone.'
        // Agreeing to something is the person's choice, not a thing Alpha ticks on the side.
        if (classifyClick(found.control, { pageUrl: page.url(), forms: found.forms, captcha: found.captcha }).level !== 'safe') return 'This tick box agrees to something. Tick it on the website yourself.'
        await page.mouse.click(found.point.x, found.point.y)
        return null
      }
      if (!isTypable(kind)) return 'That is not a text field.'
      if (!(await insp.call<boolean>('focusAndClear', step.ref.loc))) return 'Alpha could not click into that field.'
      if (step.value === '') await page.keyboard.press('Backspace')
      else await client.send('Input.insertText', { text: step.value })
      return null
    }

    for (const step of req.prepared) {
      const why = await applyStep(step, 'user')
      if (why) notes.push(why)
      else prepared.push(step)
    }

    const snapshot = async (withImage = true): Promise<Snapshot> => {
      const data = await insp.call<Collected>('collect', { maxControls: 80, textLimit: 9000 })
      const forms = data.forms
      const controls: SnapControl[] = data.controls.map((raw, i) => {
        const risk = classifyClick(raw, { pageUrl: data.url, forms, captcha: data.captcha })
        return {
          n: i + 1,
          ref: { loc: raw.loc, fp: fingerprint(raw) },
          kind: controlKind(raw),
          label: cleanPageText(controlLabel(raw)),
          rect: raw.rect,
          inView: raw.inView,
          value: maskValue(raw, raw.value),
          checked: raw.checked,
          disabled: raw.disabled,
          options: raw.options.map(o => cleanPageText(o)),
          risk: risk.level,
          sensitive: sensitiveKind(raw),
          href: controlKind(raw) === 'link' ? raw.href.slice(0, 600) : '',
        }
      })
      const text = cleanPageText(data.text)
      const look = inspectPageText(text, data.hidden)
      const shot = withImage ? await page.screenshot({ type: 'jpeg', quality: 58, fullPage: false }) : null
      return {
        url: stripHash(data.url), host: displayHost(data.url), title: cleanPageText(data.title), status: guard.mainStatus,
        scrollY: data.scrollY, scrollHeight: data.scrollHeight, viewport: data.viewport,
        image: shot ? `data:image/jpeg;base64,${Buffer.from(shot).toString('base64')}` : '',
        controls, text, injection: { suspected: look.suspected, hits: [...new Set(look.hits.map(h => h.label))].slice(0, 6), hiddenText: look.hiddenText },
        signInRequired: data.hasPassword || controls.some(c => c.sensitive === 'password'),
        captcha: data.captcha,
        downloads: guard.downloads.slice(0, 5), blocked: guard.blocked.slice(0, 8), prepared, notes: [...notes],
      }
    }

    let action: LiveAction | undefined = req.action
    const startUrl = page.url()
    const finish = async (did?: string): Promise<LiveOutcome> => {
      if (guard.blockedPosts) notes.push('The page tried to send information in a way Alpha cannot do safely. Finish that step on the website yourself.')
      if (guard.downloads.length) notes.push('The page tried to download a file. Alpha did not save or open it.')
      if (deadline.aborted) return { status: 'error', code: 'timeout', message: 'The page took too long. Try again.' }
      // The picture and the entries refer to the page as it is now. If we landed somewhere else, the old entries no longer apply.
      if (!sameDocument(page.url(), startUrl)) prepared.length = 0
      return { status: 'ok', snapshot: await snapshot(), did }
    }

    if (!action && deps.decide) {
      if (req.scrollY > 0) await insp.call('scrollTo', req.scrollY)
      const chosen = await deps.decide(await snapshot(false))
      if (chosen) action = chosen
    }
    if (!action) {
      if (req.scrollY > 0) await insp.call('scrollTo', req.scrollY)
      return await finish()
    }

    /* one action */
    if (action.kind === 'scroll') {
      await insp.call('scrollTo', Math.max(0, req.scrollY + action.dy))
      await sleep(80)
      return await finish()
    }
    if (req.scrollY > 0) await insp.call('scrollTo', req.scrollY)

    if (action.kind === 'fill' || action.kind === 'select' || action.kind === 'check') {
      const step: PreparedStep = { kind: action.kind, ref: action.ref, value: action.value }
      const why = await applyStep(step, req.actor)
      if (why) return { status: 'refused', snapshot: await snapshot(), message: why }
      const at = prepared.findIndex(p => p.ref.loc === step.ref.loc)
      if (at >= 0) prepared.splice(at, 1)
      prepared.push(step)
      return await finish(`Filled in "${lastLabel}"`)
    }

    // A click or Enter key.
    const isEnter = action.kind === 'press'
    const ref = action.ref
    if (!ref) return { status: 'refused', snapshot: await snapshot(), message: 'Pick the field first, then press Enter.' }
    const found = await locate(ref)
    if (!found) return { status: 'refused', snapshot: await snapshot(), message: 'That is no longer on the page. Nothing was clicked.' }
    if (fingerprint(found.control) !== ref.fp) return { status: 'refused', snapshot: await snapshot(), message: 'The page changed, so Alpha did not click. Look again and choose.' }
    if (found.control.disabled) return { status: 'refused', snapshot: await snapshot(), message: 'That button is turned off on the page.' }
    if (found.covered) return { status: 'refused', snapshot: await snapshot(), message: 'Something is drawn over that control, so Alpha did not click it. Look at the page and try again.' }

    // A tap on a tick box or radio button is an entry like any other, so it is kept and put back on the next call.
    const tapKind = controlKind(found.control)
    if (!isEnter && (tapKind === 'checkbox' || tapKind === 'radio')) {
      const step: PreparedStep = { kind: 'check', ref, value: tapKind === 'radio' || !found.control.checked ? 'true' : 'false' }
      const why = await applyStep(step, req.actor)
      if (why) return { status: 'refused', snapshot: await snapshot(), message: why }
      const at = prepared.findIndex(p => p.ref.loc === step.ref.loc)
      if (at >= 0) prepared.splice(at, 1)
      prepared.push(step)
      return await finish(`${step.value === 'true' ? 'Ticked' : 'Cleared'} "${lastLabel}"`)
    }

    const risk = classifyClick(found.control, { pageUrl: page.url(), forms: found.forms, captcha: found.captcha }, isEnter)
    const targetLabel = cleanPageText(controlLabel(found.control), 60)
    if (risk.level === 'handoff') return { status: 'handoff', snapshot: await snapshot(), reason: risk.reason, message: risk.message }

    let expectPost: string | null = null
    if (risk.level === 'approve') {
      const form = found.forms[0]
      const label = controlLabel(found.control)
      const fields: FieldValue[] = risk.kind === 'download' ? [] : (found.control.formFields || []).map(f => ({ label: controlLabel(f.raw), value: maskValue(f.raw, f.value) }))
      const href = risk.kind === 'download' ? found.control.href || page.url() : page.url()
      const actionUrl = risk.kind === 'download' ? href : form?.action || page.url()
      const method = form?.method || 'get'
      const canonical = canonicalAction({ kind: risk.kind, url: risk.kind === 'download' ? href : page.url(), fp: risk.kind === 'download' ? '' : ref.fp, method, actionUrl, fields })
      const details = describeApproval(risk.kind, {
        host: displayHost(page.url()), url: stripHash(page.url()), label: cleanPageText(label), why: risk.why, fields: fields.map(f => ({ label: cleanPageText(f.label), value: cleanPageText(f.value) })),
        method, actionHost: form && !form.sameOrigin ? displayHost(form.action) : undefined,
      })
      if (risk.kind === 'download') {
        // Downloads are saved by the download route once approved; the page itself is never asked to download.
        details.url = href
        details.host = displayHost(href)
      }
      // A download is never performed here, so it never uses up an approval.
      const result = await deps.authorize({ kind: risk.kind, canonical, details, approvalId: risk.kind === 'download' ? undefined : req.approvalId })
      if (!result.granted || risk.kind === 'download') {
        return { status: 'approval', snapshot: await snapshot(), approval: details, approvalId: result.granted ? '' : result.approvalId, canonical }
      }
      if (method === 'post') expectPost = stripHash(actionUrl)
    }

    // Do it, with a real click or key press where the control is drawn.
    if (expectPost) postUrl = expectPost
    const navigated = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 9000 }).catch(() => null)
    if (isEnter) {
      if (!(await insp.call<boolean>('focusOnly', ref.loc))) return { status: 'refused', snapshot: await snapshot(), message: 'Alpha could not click into that field.' }
      await page.keyboard.press('Enter')
    } else {
      await page.mouse.click(found.point.x, found.point.y)
    }
    await Promise.race([navigated, sleep(1400 * settle)])
    postUrl = null
    await waitForQuiet(guard, 450 * settle, 3500 * settle)
    // New windows are never followed.
    for (const p of await browser.pages()) if (p !== page) await p.close().catch(() => {})
    return await finish(risk.level === 'approve' ? `Approved: ${isEnter ? 'pressed Enter in' : 'pressed'} "${targetLabel}"` : `${isEnter ? 'Pressed Enter in' : 'Tapped'} "${targetLabel}"`)
  } catch (error) {
    if (error instanceof Error && error.name === 'NeedsDatabaseUpdate') return { status: 'error', code: 'needs_update', message: 'Approvals need a database update before anything can be sent from here. Nothing was sent.' }
    if (error instanceof Error && /timeout|aborted/i.test(error.message)) return { status: 'error', code: 'timeout', message: 'The page took too long. Try again.' }
    return { status: 'error', code: 'engine', message: 'The page could not be shown right now. Try again in a moment.' }
  } finally {
    clearTimeout(watchdog)
    await browser?.close().catch(() => {})
  }
}

export type { LiveAction, LiveRequest }
