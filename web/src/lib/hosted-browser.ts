import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { assertPublicUrl, fetchPublicUrl } from '@/lib/public-url'

export type BrowserAction = { type: 'navigate' | 'click' | 'fill' | 'select' | 'wait'; url?: string; selector?: string; value?: string; ms?: number }
export type BrowserStep = { action: string; screenshot: string; url: string; title: string }

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

/** A new isolated browser for each bounded task; no user-machine/browser access. */
export async function runHostedBrowser(url: string, input: unknown) {
  const actions = validateBrowserActions(input)
  await assertPublicUrl(url)
  for (const action of actions) if (action.type === 'navigate') await assertPublicUrl(action.url!)
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(), headless: 'shell',
    args: [...chromium.args, '--disable-background-networking', '--disable-quic', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND'],
    defaultViewport: { width: 1280, height: 800 },
  })
  const steps: BrowserStep[] = []
  const watchdog = setTimeout(() => { void browser.close().catch(() => {}) }, 40_000)
  const deadline = AbortSignal.timeout(35_000)
  let requests = 0
  let blockedSubmissions = 0
  try {
    const page = await browser.newPage()
    await page.setBypassServiceWorker(true)
    await page.setRequestInterception(true)
    page.setDefaultTimeout(5000)
    page.on('request', request => { void (async () => {
      try {
        if (++requests > 100 || deadline.aborted || !['GET', 'HEAD'].includes(request.method())) {
          if (!['GET', 'HEAD'].includes(request.method())) blockedSubmissions++
          await request.abort(); return
        }
        // No direct browser network path: every resource/redirect uses pinned,
        // public-only DNS, with a closed proxy for workers and other channels.
        const response = await fetchPublicUrl(request.url(), {
          method: request.method(), headers: { 'User-Agent': 'AlphaAI-Browser/1.0', Accept: request.headers().accept || '*/*' },
          signal: deadline, maxBytes: 3 * 1024 * 1024,
        })
        const headers = Object.fromEntries(response.headers)
        delete headers['content-encoding']; delete headers['transfer-encoding']; delete headers['content-length']; delete headers['set-cookie']
        await request.respond({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) })
      } catch { if (!request.isInterceptResolutionHandled()) await request.abort().catch(() => {}) }
    })() })
    page.on('dialog', dialog => { void dialog.dismiss() })
    const capture = async (action: string) => {
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
        const sensitive = await target.evaluate(el => {
          const text = [el.textContent, el.getAttribute('type'), el.getAttribute('name'), el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.getAttribute('href')].join(' ')
          return /password|one.time.code|credit.?card|cc-number|purchase|checkout|place.order|delete|subscribe|pay.now|sign.in|log.in|accept.terms/i.test(text)
        })
        if (sensitive) throw new Error('This step needs a user handoff. No credential, purchase, or destructive action was performed.')
        if (action.type === 'fill') await target.evaluate((el, value) => {
          if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error('Element is not a text field')
          const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')?.set
          setter?.call(el, value)
          el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
        }, action.value!)
        else if (action.type === 'select') await page.select(action.selector!, action.value!)
        else if (action.type === 'click') {
          await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 2000 }).catch(() => null), target.click()])
        }
      }
      await capture(`${action.type === 'fill' ? 'Prepared field' : action.type}: ${action.selector || action.url || ''}`)
      if (blockedSubmissions) throw new Error('An external submission was blocked. The task is not complete; finish this step on the website yourself.')
    }
    const text = await page.evaluate(() => document.body.innerText.slice(0, 6000))
    const controls = await page.evaluate(() => Array.from(document.querySelectorAll('a[href],input,textarea,select,button')).slice(0, 45).map(el => ({
      tag: el.tagName.toLowerCase(), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 120),
      id: el.id, name: el.getAttribute('name'), type: el.getAttribute('type'), href: el.getAttribute('href'),
    })))
    return { success: true, steps, text, controls, title: await page.title(), url: page.url(), mode: 'isolated-public-browser', notice: 'Public browsing and form preparation only. No accounts, cookies, or passwords are shared. External submissions require user handoff.' }
  } catch (error) {
    return { success: false, steps, error: error instanceof Error ? error.message : 'Browser task failed' }
  } finally { clearTimeout(watchdog); await browser.close().catch(() => {}) }
}
