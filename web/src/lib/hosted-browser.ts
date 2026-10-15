import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { assertPublicUrl, fetchPublicUrl } from '@/lib/public-url'

/**
 * The locked-down headless browser Alpha uses for live pages.
 *
 * Why it is safe to run a real browser engine on the server:
 *  - the engine has NO network of its own: its only proxy is a closed port and it cannot look up names,
 *  - every request it makes is caught here and fetched by Alpha's own checked fetch (public addresses only, shop rules applied),
 *  - nothing is ever passed straight through to the network; each answer is handed back to the page by hand,
 *  - cookies are never sent or kept, downloads are never saved, and it is closed when the task ends or time runs out.
 * The checks that apply the shop's own rules are passed in (see ./browser/engine.ts); this file is the engine wrapper.
 */

export type BrowserAction = { type: 'navigate' | 'click' | 'fill' | 'select' | 'wait'; url?: string; selector?: string; value?: string; ms?: number }
export type BrowserStep = { action: string; screenshot: string; url: string; title: string }

export function assertBrowserPage(url: string, status?: number) {
  if (!/^https?:\/\//i.test(url) || (status !== undefined && status >= 400)) throw new Error('The requested page failed to load. The browser task did not complete.')
}

export function validateBrowserActions(input: unknown): BrowserAction[] {
  if (!Array.isArray(input) || input.length > 8) throw new Error('A browser task supports up to 8 actions')
  return input.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Invalid browser action')
    const action = value as BrowserAction
    if (!['navigate', 'click', 'fill', 'select', 'wait'].includes(action.type)) throw new Error('External submissions, purchases, and sign-in need a user handoff; Alpha can prepare the form')
    if (action.type === 'navigate' && (typeof action.url !== 'string' || action.url.length > 2048)) throw new Error('Navigation requires a public URL')
    if (['click', 'fill', 'select'].includes(action.type) && (typeof action.selector !== 'string' || !action.selector.trim() || action.selector.length > 300)) throw new Error('A specific page selector is required')
    if (['fill', 'select'].includes(action.type) && (typeof action.value !== 'string' || action.value.length > 2000)) throw new Error('Invalid field value')
    if (action.type === 'wait' && (typeof action.ms !== 'number' || !Number.isFinite(action.ms) || action.ms < 0 || action.ms > 2000)) throw new Error('Wait must be between 0 and 2000 ms')
    return action
  })
}

/* ---------- the locked engine ---------- */

export const LOCKED_FLAGS = [
  '--disable-background-networking', '--disable-quic', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
  '--host-resolver-rules=MAP * ~NOTFOUND',
  // Peer-to-peer connections use their own sockets. Force them through the closed proxy as well.
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-sync', '--disable-notifications', '--mute-audio', '--no-first-run', '--disable-extensions',
]

/** Runs before any page script in every frame: removes the ways a page could open a connection that is not a normal request. */
export const REMOVE_SIDE_CHANNELS = `
(function () {
  var kill = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'WebSocket', 'WebTransport', 'EventSource', 'SharedWorker'];
  kill.forEach(function (k) { try { Object.defineProperty(window, k, { value: undefined, configurable: false, writable: false }); } catch (e) {} });
  try { Object.defineProperty(navigator, 'sendBeacon', { value: function () { return false; }, configurable: false }); } catch (e) {}
  try { Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: false }); } catch (e) {}
})();
`

export interface Viewport { width: number; height: number; isMobile?: boolean }

/** A new isolated browser for each bounded task; no user-machine/browser access. */
export async function launchLockedBrowser(viewport: Viewport = { width: 1280, height: 800 }, launcher?: (args: string[], viewport: Viewport) => Promise<Browser>): Promise<Browser> {
  // The packaged browser turns off the same-origin rules for convenience. Alpha keeps them on: a page must not read other sites.
  const args = [...chromium.args.filter(flag => !/^--(disable-web-security|allow-running-insecure-content)/.test(flag)), ...LOCKED_FLAGS]
  if (launcher) return launcher(args, viewport)
  return puppeteer.launch({
    executablePath: await chromium.executablePath(), headless: 'shell', args,
    defaultViewport: { width: viewport.width, height: viewport.height, isMobile: !!viewport.isMobile, hasTouch: !!viewport.isMobile, deviceScaleFactor: 1 },
  })
}

export type ResourceFetcher = (url: string, init: { method: string; headers: Record<string, string>; body?: Buffer; signal: AbortSignal; maxBytes: number }) => Promise<Response>

export interface GuardOptions {
  deadline: AbortSignal
  /** Fetches one resource for the page. Defaults to the public-only pinned fetch. */
  fetchResource?: ResourceFetcher
  /** The shop's rules for every request, including each redirect. Return a reason to block, or null. `navigation` is true for the address of the page itself. */
  check?: (url: string, info: { navigation: boolean }) => Promise<string | null> | string | null
  /** True once, for one approved form submission to exactly the address that was shown. Any other POST from the page is refused. */
  allowPost?: (url: string) => boolean
  userAgent?: string
  maxRequests?: number
  maxResponseBytes?: number
  maxTotalBytes?: number
}

export interface GuardState {
  requests: number
  inflight: number
  bytes: number
  blocked: Array<{ url: string; reason: string }>
  blockedPosts: number
  downloads: Array<{ url: string; type: string; name: string }>
  mainStatus: number | null
}

// Types the engine will draw. Anything else loaded as a page is treated as a download and never handed over.
const RENDERABLE = /^(text\/|application\/(xhtml\+xml|xml|json|javascript|x-javascript|ld\+json|manifest\+json|wasm)|image\/|font\/|application\/(font|vnd\.ms-fontobject|x-font))/i
const PASS_HEADERS = ['content-type', 'location', 'content-language', 'last-modified', 'etag', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'timing-allow-origin']
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 AlphaDesk/1.0'
const SKIP_TYPES = new Set(['media', 'ping', 'eventsource', 'websocket', 'prefetch', 'cspviolationreport', 'signedexchange', 'texttrack'])

export async function installNetworkGuard(page: Page, opts: GuardOptions): Promise<GuardState> {
  const state: GuardState = { requests: 0, inflight: 0, bytes: 0, blocked: [], blockedPosts: 0, downloads: [], mainStatus: null }
  const maxRequests = opts.maxRequests ?? 120
  const maxResponse = opts.maxResponseBytes ?? 3 * 1024 * 1024
  const maxTotal = opts.maxTotalBytes ?? 14 * 1024 * 1024
  await page.setBypassServiceWorker(true)
  await page.setRequestInterception(true)
  await page.evaluateOnNewDocument(REMOVE_SIDE_CHANNELS)
  page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}) })
  page.on('requestfinished', () => { state.inflight = Math.max(0, state.inflight - 1) })
  page.on('requestfailed', () => { state.inflight = Math.max(0, state.inflight - 1) })
  page.on('request', request => { void (async () => {
    state.inflight++
    try {
      const method = request.method()
      const isPost = method === 'POST'
      if (++state.requests > maxRequests || opts.deadline.aborted || state.bytes > maxTotal) { await request.abort(); return }
      if (!['GET', 'HEAD'].includes(method) && !(isPost && request.isNavigationRequest() && opts.fetchResource && opts.allowPost?.(request.url()))) {
        state.blockedPosts++
        await request.abort('blockedbyclient'); return
      }
      if (SKIP_TYPES.has(request.resourceType())) { await request.abort('blockedbyclient'); return }
      if (/^data:/i.test(request.url())) {
        const data = request.isNavigationRequest() && request.frame() === page.mainFrame() ? null : decodeDataUrl(request.url())
        if (!data) { await request.abort('blockedbyclient'); return }
        state.bytes += data.body.length
        await request.respond({ status: 200, headers: { 'content-type': data.type }, body: data.body }); return
      }
      const reason = opts.check ? await opts.check(request.url(), { navigation: request.isNavigationRequest() && request.frame() === page.mainFrame() }) : null
      if (reason) { state.blocked.push({ url: request.url().slice(0, 300), reason }); await request.abort('blockedbyclient'); return }
      // No direct browser network path: every resource/redirect uses pinned,
      // public-only DNS, with a closed proxy for workers and other channels.
      const init = {
        method, headers: { 'User-Agent': opts.userAgent || DEFAULT_USER_AGENT, Accept: request.headers().accept || '*/*', 'Accept-Language': request.headers()['accept-language'] || 'en-US,en;q=0.9', ...(isPost ? { 'Content-Type': request.headers()['content-type'] || 'application/x-www-form-urlencoded' } : {}) } as Record<string, string>,
        body: isPost ? Buffer.from(request.postData() || '') : undefined,
        signal: opts.deadline, maxBytes: maxResponse,
      }
      const response = opts.fetchResource
        ? await opts.fetchResource(request.url(), init)
        : await fetchPublicUrl(request.url(), { method, headers: init.headers, signal: opts.deadline, maxBytes: maxResponse })
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) state.mainStatus = response.status
      const type = response.headers.get('content-type') || ''
      const disposition = response.headers.get('content-disposition') || ''
      const redirect = response.status >= 300 && response.status < 400
      if (!redirect && (/attachment/i.test(disposition) || (request.isNavigationRequest() && type && !RENDERABLE.test(type)))) {
        const name = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disposition)?.[1] || request.url().split('?')[0].split('/').pop() || 'file'
        state.downloads.push({ url: request.url().slice(0, 500), type: type.slice(0, 80), name: decodeURIComponentSafe(name).slice(0, 120) })
        await request.respond({ status: 204, headers: {}, body: '' }); return
      }
      const headers: Record<string, string> = {}
      for (const key of PASS_HEADERS) { const v = response.headers.get(key); if (v) headers[key] = v }
      const body = redirect ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer())
      state.bytes += body.length
      await request.respond({ status: response.status, headers, body })
    } catch { if (!request.isInterceptResolutionHandled()) await request.abort().catch(() => {}) }
  })() })
  return state
}

/** A picture, style sheet or font written into the page itself. Nothing to fetch: the bytes are in the address. */
function decodeDataUrl(url: string): { type: string; body: Buffer } | null {
  const head = /^data:([^,;]*)((?:;[^,;]*)*),/i.exec(url.slice(0, 300))
  if (!head) return null
  const rest = url.slice(head[0].length)
  if (rest.length > 2_000_000) return null
  try {
    const body = /;base64/i.test(head[2]) ? Buffer.from(rest, 'base64') : Buffer.from(decodeURIComponent(rest))
    return { type: head[1] || 'text/plain', body }
  } catch { return null }
}

function decodeURIComponentSafe(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

/** Wait until the page has stopped loading things for a moment (or give up). */
export async function waitForQuiet(state: GuardState, quietMs = 500, maxMs = 3500): Promise<void> {
  const start = Date.now()
  let quietSince = Date.now()
  while (Date.now() - start < maxMs) {
    await new Promise(resolve => setTimeout(resolve, 100))
    if (state.inflight > 0) quietSince = Date.now()
    else if (Date.now() - quietSince >= quietMs) return
  }
}

/* ---------- the older action-list API, kept for Ask Alpha ---------- */

export interface HostedHooks {
  check?: GuardOptions['check']
  fetchResource?: ResourceFetcher
  /** Called before a click, fill or select with what the target is. Return a message to refuse it. */
  vet?: (step: { action: BrowserAction; element: { tag: string; type: string; name: string; id: string; label: string; text: string; href: string; autocomplete: string; placeholder: string; inForm: boolean; formMethod: string; formHasPassword: boolean }; value?: string }) => string | null
  /** Cleans page text before it is returned (invisible characters, block markers). */
  cleanText?: (text: string) => string
}

/** A new isolated browser for each bounded task; no user-machine/browser access. */
export async function runHostedBrowser(url: string, input: unknown, hooks: HostedHooks = {}) {
  const actions = validateBrowserActions(input)
  await assertPublicUrl(url)
  for (const action of actions) if (action.type === 'navigate') await assertPublicUrl(action.url!)
  const browser = await launchLockedBrowser({ width: 1280, height: 800 })
  const steps: BrowserStep[] = []
  const watchdog = setTimeout(() => { void browser.close().catch(() => {}) }, 40_000)
  const deadline = AbortSignal.timeout(35_000)
  try {
    const page = await browser.newPage()
    const guard = await installNetworkGuard(page, { deadline, fetchResource: hooks.fetchResource, check: hooks.check })
    page.setDefaultTimeout(5000)
    const capture = async (action: string) => {
      assertBrowserPage(page.url())
      const shot = await page.screenshot({ type: 'jpeg', quality: 45, fullPage: false })
      steps.push({ action, screenshot: `data:image/jpeg;base64,${Buffer.from(shot).toString('base64')}`, url: page.url(), title: await page.title() })
      if (steps.length > 5) steps.splice(1, 1)
    }
    const first = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    if (!first || !first.ok()) throw new Error(`Page could not be opened (${first?.status() || 'network blocked'})`)
    await capture('Opened in Alpha’s browser')
    for (const action of actions) {
      if (deadline.aborted) throw new Error('Browser task reached its time limit')
      if (action.type === 'navigate') {
        const response = await page.goto(action.url!, { waitUntil: 'domcontentloaded', timeout: 12000 })
        if (!response?.ok()) throw new Error('Navigation failed')
      } else if (action.type === 'wait') await new Promise(resolve => setTimeout(resolve, action.ms))
      else {
        const target = await page.$(action.selector!)
        if (!target) throw new Error(`Element not found: ${action.selector}`)
        const info = await target.evaluate(el => {
          const form = (el as HTMLInputElement).form || el.closest('form')
          return {
            tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') || '').toLowerCase(), name: el.getAttribute('name') || '', id: el.id || '',
            label: el.getAttribute('aria-label') || '', text: (el.textContent || '').trim().slice(0, 120), href: el.getAttribute('href') || '',
            autocomplete: el.getAttribute('autocomplete') || '', placeholder: el.getAttribute('placeholder') || '',
            inForm: !!form, formMethod: form ? (form.getAttribute('method') || 'get').toLowerCase() : '',
            formHasPassword: !!form && !!form.querySelector('input[type="password" i]'),
          }
        })
        const sensitive = /password|one.time.code|credit.?card|cc-number|purchase|checkout|place.order|delete|subscribe|pay.now|sign.in|log.in|accept.terms/i.test([info.text, info.type, info.name, info.autocomplete, info.label, info.href].join(' '))
        if (sensitive) throw new Error('This step needs a user handoff. No credential, purchase, or destructive action was performed.')
        const refused = hooks.vet ? hooks.vet({ action, element: info, value: action.value }) : null
        if (refused) throw new Error(refused)
        if (action.type === 'fill') await target.evaluate((el, value) => {
          if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error('Element is not a text field')
          const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')?.set
          setter?.call(el, value)
          el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
        }, action.value!)
        else if (action.type === 'select') await page.select(action.selector!, action.value!)
        else if (action.type === 'click') {
          const navigates = await target.evaluate(el => el instanceof HTMLAnchorElement && !!el.href && new URL(el.href).href.split('#')[0] !== location.href.split('#')[0])
          const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: navigates ? 15000 : 2000 })
          const [response] = await Promise.all([navigates ? navigation : navigation.catch(() => null), target.click()])
          assertBrowserPage(page.url(), response?.status())
        }
      }
      await capture(`${action.type === 'fill' ? 'Prepared field' : action.type}: ${action.selector || action.url || ''}`)
      if (guard.blockedPosts) throw new Error('An external submission was blocked. The task is not complete; finish this step on the website yourself.')
    }
    const clean = hooks.cleanText || ((t: string) => t)
    const text = clean(await page.evaluate(() => document.body.innerText.slice(0, 6000)))
    const controls = await page.evaluate(() => Array.from(document.querySelectorAll('a[href],input,textarea,select,button')).slice(0, 45).map(el => ({
      tag: el.tagName.toLowerCase(), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 120),
      id: el.id, name: el.getAttribute('name'), type: el.getAttribute('type'), href: el.getAttribute('href'),
    })))
    return { success: true, steps, text, controls, title: await page.title(), url: page.url(), mode: 'isolated-public-browser', notice: 'Public browsing and form preparation only. No accounts, cookies, or passwords are shared. External submissions require user handoff.' }
  } catch (error) {
    return { success: false, steps, error: error instanceof Error ? error.message : 'Browser task failed' }
  } finally { clearTimeout(watchdog); await browser.close().catch(() => {}) }
}
