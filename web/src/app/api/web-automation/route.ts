// v3-fixed-regex
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getRouteShop, unauthorized } from '@/lib/api-auth'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { assertPublicUrl, tryPublicUrl } from '@/lib/public-url'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type ParsedPage = { text: string; links: string[]; title: string; error?: string }

type AutomationSettings = {
  browserless_token?: unknown
  ai_api_key?: unknown
  ai_base_url?: unknown
  ai_model?: unknown
}

// -- Fetch + parse page (no browser needed) --
async function fetchAndParse(url: string, selector?: string): Promise<ParsedPage> {
  try {
    let currentUrl = await assertPublicUrl(url)
    let r: Response | null = null
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      r = await fetch(currentUrl.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000),
        redirect: 'manual',
      })
      if (r.status < 300 || r.status >= 400) break
      const location = r.headers.get('location')
      const nextUrl = location ? await tryPublicUrl(location, currentUrl) : null
      if (!nextUrl) return { text: '', links: [], title: '', error: 'Redirected to a non-public URL' }
      currentUrl = nextUrl
      if (redirect === 3) return { text: '', links: [], title: '', error: 'Too many redirects' }
    }
    if (!r) return { text: '', links: [], title: '', error: 'Page fetch failed' }
    if (!r.ok) return { text: '', links: [], title: '', error: `Page returned ${r.status}` }
    const html = await r.text()

    // Simple HTML text extraction with safe regex
    let title = ''
    try {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
      title = titleMatch?.[1]?.trim() || ''
    } catch { title = '' }

    // Strip scripts, styles, nav, footer - use simple string replacements as fallback
    let clean = html
    try {
      clean = clean.replace(/<script[\s\S]*?<\/script>/gi, '')
      clean = clean.replace(/<style[\s\S]*?<\/style>/gi, '')
      clean = clean.replace(/<nav[\s\S]*?<\/nav>/gi, '')
      clean = clean.replace(/<footer[\s\S]*?<\/footer>/gi, '')
      clean = clean.replace(/<header[\s\S]*?<\/header>/gi, '')
    } catch { /* regex failed on this content, continue with raw html */ }

    // Extract text
    let text = ''
    try {
      text = clean
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .trim()
        .slice(0, 8000)
    } catch {
      text = html.slice(0, 8000)
    }

    // Extract links
    const links: string[] = []
    try {
      const linkMatches = html.matchAll(/href="([^"]+)"/gi)
      for (const m of linkMatches) {
        const href = m[1]
        if (href.startsWith('http') && !href.includes('javascript:')) {
          links.push(href)
        }
      }
    } catch { /* ignore link extraction errors */ }

    return { text, links: [...new Set(links)].slice(0, 20), title }
  } catch (e) {
    return { text: '', links: [], title: '', error: `Failed to fetch: ${(e as Error).message}` }
  }
}

// -- AI analysis of scraped content --
async function aiAnalyze(prompt: string, settings: AutomationSettings = {}): Promise<string> {
  const apiKey = typeof settings.ai_api_key === 'string' ? settings.ai_api_key.trim() : ''
  if (!apiKey) return ''
  const baseUrl = normalizeAiBaseUrl(settings.ai_base_url || AI_BASE_URLS.OPENROUTER)
  const model = normalizeAiModel(settings.ai_model, baseUrl)
  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 500 }),
      signal: AbortSignal.timeout(20000),
    })
    const d = await r.json().catch(() => ({}))
    return r.ok ? (d.choices?.[0]?.message?.content?.trim() || '') : ''
  } catch {
    return ''
  }
}

interface BrowserAction {
  type: 'navigate' | 'click' | 'fill' | 'select' | 'wait' | 'submit'
  selector?: string
  value?: string
  url?: string
  ms?: number
}

interface BrowserStep {
  action: string
  screenshot: string
  url: string
  title: string
}

interface BrowserResult {
  success: boolean
  error?: string
  screenshot?: string
  steps?: BrowserStep[]
  text?: string
  title?: string
  requiresSetup?: boolean
}

// This textual guard runs inside Browserless for subresources and redirects.
// The initial URL and every explicit navigate action are also DNS-validated on
// our server before the remote browser is allowed to run.
function hasBlockedBrowserHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test') || host === '0.0.0.0' || host === '::1' || host === '[::1]' || host.includes(':') || /^(0|10|127)\./.test(host) || /^169\.254\./.test(host) || /^192\.0\.2\./.test(host) || /^192\.168\./.test(host) || /^198\.51\.100\./.test(host) || /^203\.0\.113\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
}

// -- Browserless full automation --
async function runBrowserTask(task: string, url: string, actions: BrowserAction[], browserlessKey: string): Promise<BrowserResult> {
  if (!browserlessKey) {
    return { success: false, error: 'Full browser automation is not configured for this shop. Add a Browserless token in Settings.', requiresSetup: true }
  }
  const js = (value: unknown) => JSON.stringify(String(value ?? ''))
  const actionsCode = actions.map((a) => {
    let actionCode = ''
    let actionLabel = ''
    const selector = js(a.selector || '')
    const value = js(a.value || '')
    const actionUrl = js(a.url || '')
    const waitMs = Number.isFinite(Number(a.ms)) ? Math.min(Math.max(Math.floor(Number(a.ms)), 0), 15000) : 1000
    if (a.type === 'navigate') { actionCode = `await page.goto(${actionUrl}, {waitUntil:'networkidle2',timeout:15000});`; actionLabel = `Navigate to ${String(a.url || '')}` }
    else if (a.type === 'click') { actionCode = `await page.click(${selector});await page.waitForTimeout(800);`; actionLabel = `Click ${String(a.selector || '')}` }
    else if (a.type === 'fill') { actionCode = `await page.click(${selector});await page.evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, await page.$(${selector}), ${value});`; actionLabel = `Fill ${String(a.selector || '')}` }
    else if (a.type === 'select') { actionCode = `await page.select(${selector}, ${value});`; actionLabel = `Select ${String(a.value || '')}` }
    else if (a.type === 'wait') { actionCode = `await page.waitForTimeout(${waitMs});`; actionLabel = `Wait ${waitMs}ms` }
    else if (a.type === 'submit') { actionCode = `await page.click(${selector});await page.waitForTimeout(2000);`; actionLabel = 'Submit form' }
    if (!actionCode) return ''
    const successLabel = JSON.stringify(actionLabel)
    const failureLabel = JSON.stringify(`Failed: ${actionLabel}`)
    return `
      try {
        ${actionCode}
        steps.push({action:${successLabel},screenshot:(await page.screenshot({type:'png',fullPage:false})).toString('base64'),url:page.url(),title:await page.title()});
      } catch(stepErr) {
        steps.push({action:${failureLabel}+' — '+String(stepErr?.message || stepErr),screenshot:'',url:page.url(),title:await page.title()});
      }`
  }).join('\n    ')

  const blockedHostFunction = hasBlockedBrowserHost.toString()
  const script = `
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setViewport({width:1280,height:800});
    const hasBlockedBrowserHost = ${blockedHostFunction};
    await page.setRequestInterception(true);
    page.on('request', request => {
      try {
        const requested = new URL(request.url());
        if (!['http:', 'https:'].includes(requested.protocol) || hasBlockedBrowserHost(requested.hostname)) {
          request.abort();
        } else {
          request.continue();
        }
      } catch (_) {
        request.abort();
      }
    });
    const steps = [];
    try {
      await page.goto(${JSON.stringify(url)}, {waitUntil:'networkidle2',timeout:15000});
      steps.push({action:'Opened page',screenshot:(await page.screenshot({type:'png',fullPage:false})).toString('base64'),url:page.url(),title:await page.title()});
      ${actionsCode}
      const text = await page.evaluate(() => document.body.innerText.slice(0,3000));
      const finalTitle = await page.title();
      await browser.close();
      const lastStep = steps[steps.length-1];
      return {steps, screenshot:lastStep?lastStep.screenshot:'', text, title:finalTitle, success:true};
    } catch(e) {
      try { steps.push({action:'Error: '+e.message,screenshot:(await page.screenshot({type:'png',fullPage:false})).toString('base64'),url:page.url(),title:await page.title()}); } catch(_){}
      await browser.close();
      return {success:false, error:e.message, steps};
    }
  `
  try {
    const r = await fetch(`https://production-sfo.browserless.io/function?token=${browserlessKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: script, context: {} }),
      signal: AbortSignal.timeout(25000),
    })
    if (!r.ok) return { success: false, error: `Browserless returned ${r.status}` }
    const result = await r.json()
    return { success: result.success !== false, ...result }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

// -- Log automation run --
async function logRun(shopId: string, type: string, task: string, result: string, success: boolean) {
  try {
    const sb = getServiceClient()
    await sb.from('web_automation_logs').insert({ shop_id: shopId, type, task: task.slice(0, 500), result: result.slice(0, 1000), success, created_at: new Date().toISOString() })
  } catch { /* ignore if table doesn't exist */ }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    const { data: settings, error: settingsError } = await getServiceClient()
      .from('settings')
      .select('browserless_token,ai_api_key,ai_base_url,ai_model')
      .eq('shop_id', auth.shopId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (settingsError) return NextResponse.json({ ok: false, error: 'Shop automation settings could not be loaded' }, { status: 500 })
    const shopSettings = (settings || {}) as AutomationSettings
    const task = typeof body?.task === 'string' ? body.task.trim().slice(0, 4000) : ''
    const url = typeof body?.url === 'string' ? body.url.trim() : ''
    const type = typeof body?.type === 'string' ? body.type : 'scrape'
    const actions = Array.isArray(body?.actions) ? body.actions.slice(0, 20) : []
    const query = typeof body?.query === 'string' ? body.query.trim().slice(0, 500) : ''
    const validateUrl = async (value: string) => {
      if (!value) return 'URL required'
      try {
        await assertPublicUrl(value)
      } catch (error) {
        return error instanceof Error ? error.message : 'Valid public URL required'
      }
      return null
    }
    if (url) {
      const urlError = await validateUrl(url)
      if (urlError) return NextResponse.json({ ok: false, error: urlError }, { status: 400 })
    }
    for (const action of actions) {
      if (action && action.type === 'navigate') {
        const actionError = await validateUrl(typeof action.url === 'string' ? action.url.trim() : '')
        if (actionError) return NextResponse.json({ ok: false, error: `Navigate action rejected: ${actionError}` }, { status: 400 })
      }
    }
    const log = (kind: string, label: string, result: string, success: boolean) => logRun(auth.shopId, kind, label, result, success)

    // -- SCRAPE: fetch a page and extract info --
    if (type === 'scrape' || type === 'read') {
      if (!url) return NextResponse.json({ ok: false, error: 'URL required for scrape' }, { status: 400 })
      const { text, links, title, error: fetchError } = await fetchAndParse(url)
      if (fetchError) {
        await log('scrape', task || url, fetchError, false)
        return NextResponse.json({ ok: false, error: fetchError }, { status: 502 })
      }
      let analysis = ''
      if (task) {
        analysis = await aiAnalyze(`You scraped a web page.\n\nTitle: ${title}\nURL: ${url}\n\nContent:\n${text}\n\n---\nUser task: ${task}\n\nAnswer the task based on the page content. Be specific and concise.`, shopSettings)
      }
      await log('scrape', task || url, analysis || text.slice(0, 200), true)
      const scrapeScreenshotUrl = `/api/screenshot?url=${encodeURIComponent(url)}`
      const scrapeSteps = [
        { action: `Navigating to ${url}...`, screenshotUrl: scrapeScreenshotUrl, url, title: title || url },
        { action: `Reading page: ${title || url}`, screenshotUrl: scrapeScreenshotUrl, url, title: title || url },
        ...(analysis ? [{ action: `Analyzed: ${analysis.slice(0, 120)}${analysis.length > 120 ? '...' : ''}`, screenshotUrl: scrapeScreenshotUrl, url, title: title || url }] : [])
      ]
      return NextResponse.json({ ok: true, type: 'scrape', title, url, text: text.slice(0, 3000), links, analysis, steps: scrapeSteps })
    }

    // -- SEARCH --
    if (type === 'search') {
      const searchQuery = (query || task).slice(0, 500)
      if (!searchQuery) return NextResponse.json({ ok: false, error: 'Query required' }, { status: 400 })
      const serperKey = process.env.SERPER_API_KEY || ''
      let results: Array<{title: string; url: string; snippet: string}> = []
      if (serperKey) {
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: searchQuery, num: 5 }),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          const message = d?.message || d?.error || `Search provider returned ${r.status}`
          await log('search', searchQuery, message, false)
          return NextResponse.json({ ok: false, search_succeeded: false, error: message }, { status: 502 })
        }
        results = (d.organic || []).map((item: {title: string; link: string; snippet: string}) => ({ title: item.title, url: item.link, snippet: item.snippet }))
      }
      let analysis = ''
      if (task && results.length > 0) {
        const content = results.map(r => `${r.title}\n${r.snippet}`).join('\n\n')
        analysis = await aiAnalyze(`Search results for "${searchQuery}":\n\n${content}\n\nTask: ${task}\n\nAnswer based on the search results.`, shopSettings)
      }
      const searchSucceeded = results.length > 0
      await log('search', searchQuery, analysis || (searchSucceeded ? 'Search completed' : 'No verified results'), searchSucceeded)
      const searchSteps: Array<{action: string; screenshotUrl: string; url: string; title: string}> = searchSucceeded ? [{
        action: `Searching for: "${searchQuery}"...`,
        screenshotUrl: `/api/screenshot?url=${encodeURIComponent(`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`)}`,
        url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
        title: `Google: ${searchQuery}`,
      }] : []
      if (searchSucceeded) {
        results.slice(0, 2).forEach((r: {title: string; url: string; snippet: string}) => {
          searchSteps.push({ action: `Found: ${r.title || r.url} -- ${(r.snippet||'').slice(0,80)}`, screenshotUrl: `/api/screenshot?url=${encodeURIComponent(r.url)}`, url: r.url, title: r.title })
        })
        if (analysis) searchSteps.push({ action: analysis.slice(0, 140), screenshotUrl: searchSteps[searchSteps.length-1]?.screenshotUrl || '', url: searchSteps[searchSteps.length-1]?.url || '', title: 'Summary' })
      }
      return NextResponse.json({
        ok: true,
        type: 'search',
        query: searchQuery,
        results,
        analysis,
        search_succeeded: searchSucceeded,
        notice: searchSucceeded ? undefined : 'No verified search results were returned. Configure SERPER_API_KEY to enable web search.',
        steps: searchSteps,
      })
    }

    // -- PARTS PRICE --
    if (type === 'parts_price') {
      const partQuery = (query || task).slice(0, 500)
      if (!partQuery) return NextResponse.json({ ok: false, error: 'Part query required' }, { status: 400 })
      const serperKey = process.env.SERPER_API_KEY || ''
      let priceInfo = ''
      if (serperKey) {
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: `${partQuery} auto part price site:napaonline.com OR site:oreillyauto.com OR site:autozone.com`, num: 6 }),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          const message = d?.message || d?.error || `Price search provider returned ${r.status}`
          await log('parts_price', partQuery, message, false)
          return NextResponse.json({ ok: false, price_verified: false, error: message }, { status: 502 })
        }
        const organic = d.organic || []
        priceInfo = organic.map((item: {title: string; snippet: string; link: string}) => `${item.title}: ${item.snippet} (${item.link})`).join('\n')
      }
      const analysis = priceInfo ? await aiAnalyze(`Find the best price for this auto part: "${partQuery}"\n\nSearch results:\n${priceInfo}\n\nExtract prices, part numbers, and recommend the best option.`, shopSettings) : ''
      const priceVerified = Boolean(priceInfo)
      await log('parts_price', partQuery, analysis || (priceVerified ? 'Price results found' : 'No verified price results'), priceVerified)
      return NextResponse.json({
        ok: true,
        type: 'parts_price',
        query: partQuery,
        analysis,
        raw: priceInfo,
        price_verified: priceVerified,
        notice: priceVerified ? undefined : 'No verified price results were returned. Configure SERPER_API_KEY to enable live pricing.',
      })
    }

    // -- MONITOR COMPETITOR --
    if (type === 'monitor_competitor') {
      const target = url || task
      if (!target) return NextResponse.json({ ok: false, error: 'URL or competitor name required' }, { status: 400 })
      let pageData: ParsedPage = { text: '', title: '', links: [] }
      if (target.startsWith('http')) {
        const targetError = await validateUrl(target)
        if (targetError) return NextResponse.json({ ok: false, error: targetError }, { status: 400 })
        pageData = await fetchAndParse(target)
        if (pageData.error) return NextResponse.json({ ok: false, error: pageData.error }, { status: 502 })
      }
      const analysis = await aiAnalyze(`Analyze this competitor auto shop information:\n\nTarget: ${target}\nContent: ${pageData.text.slice(0, 3000)}\n\nExtract: services offered, prices listed, special offers, contact info, hours.`, shopSettings)
      await log('monitor', target, analysis, true)
      return NextResponse.json({ ok: true, type: 'monitor', target, analysis })
    }

    // -- FULL BROWSER --
    if (type === 'browser' || type === 'fill_form' || type === 'click') {
      if (!url) return NextResponse.json({ ok: false, error: 'URL required' }, { status: 400 })
      if (!['browser', 'click'].includes(type) && type !== 'fill_form') return NextResponse.json({ ok: false, error: 'Unsupported browser action' }, { status: 400 })
      if (!body?.approval || body.approval !== 'confirm') {
        return NextResponse.json({ ok: false, approvalRequired: true, error: 'Browser actions require explicit approval' }, { status: 409 })
      }
      const result = await runBrowserTask(task, url, actions, typeof shopSettings.browserless_token === 'string' ? shopSettings.browserless_token.trim() : '')
      let analysis = ''
      if (result.success && result.text && task) {
        analysis = await aiAnalyze(`Task was: ${task}\n\nPage after automation:\n${result.text}\n\nDid the task succeed?`, shopSettings)
      }
      await log('browser', task, result.error || analysis, result.success)
      return NextResponse.json({ ok: result.success, type: 'browser', ...result, analysis })
    }

    // -- SMART FILL --
    if (type === 'smart_fill') {
      if (!url) return NextResponse.json({ ok: false, error: 'URL required' }, { status: 400 })
      const { text, title, error: fetchError } = await fetchAndParse(url)
      if (fetchError) return NextResponse.json({ ok: false, error: fetchError }, { status: 502 })
      const formAnalysis = await aiAnalyze(`This is a web form page: ${title}\n\nPage content:\n${text.slice(0, 3000)}\n\nTask: ${task}\n\nIdentify the form fields and what data should go in each field.`, shopSettings)
      await log('smart_fill', task, formAnalysis, true)
      return NextResponse.json({ ok: true, type: 'smart_fill', url, title, analysis: formAnalysis })
    }

    return NextResponse.json({ ok: false, error: 'Unknown automation type' }, { status: 400 })
  } catch (e) {
    console.error('Web automation error:', e)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const auth = await getRouteShop(req, new URL(req.url).searchParams.get('shop_id'))
  if (!auth) return unauthorized()
  const { data: settings } = await getServiceClient()
    .from('settings')
    .select('browserless_token')
    .eq('shop_id', auth.shopId)
    .limit(1)
    .maybeSingle()
  const hasBrowserless = Boolean(settings?.browserless_token)
  const hasSerper = !!process.env.SERPER_API_KEY
  return NextResponse.json({
    ok: true,
    status: 'active',
    capabilities: {
      scrape: { available: true, description: 'Fetch and read any public webpage' },
      search: { available: hasSerper, description: 'Web search via Serper' },
      parts_price: { available: hasSerper, description: 'Search auto parts prices' },
      monitor_competitor: { available: true, description: 'Scrape and analyze competitor websites' },
      browser: { available: hasBrowserless, description: 'Full browser automation' },
      smart_fill: { available: true, description: 'AI analyzes form structure' },
    }
  })
}
