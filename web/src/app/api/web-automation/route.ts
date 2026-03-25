import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const BROWSERLESS_KEY = process.env.BROWSERLESS_API_KEY || ''
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''

// ── Fetch + parse page (no browser needed) ──
async function fetchAndParse(url: string, selector?: string): Promise<{ text: string; links: string[]; title: string }> {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(15000),
  })
  const html = await r.text()
  
  // Simple HTML text extraction (no cheerio needed)
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || ''
  
  // Strip scripts, styles, nav, footer
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
  
  // Extract text
  const text = clean
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim()
    .slice(0, 8000)
  
  // Extract links
  const links: string[] = []
  const linkMatches = html.matchAll(/href="([^"]+)"/gi)
  for (const m of linkMatches) {
    const href = m[1]
    if (href.startsWith('http') && !href.includes('javascript:')) {
      links.push(href)
    }
  }
  
  return { text, links: [...new Set(links)].slice(0, 20), title }
}

// ── AI analysis of scraped content ──
async function aiAnalyze(prompt: string): Promise<string> {
  const msgs = [{ role: 'user', content: prompt }]
  
  if (GROQ_API_KEY) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: msgs, max_tokens: 500 }),
      })
      const d = await r.json()
      if (r.ok) return d.choices?.[0]?.message?.content?.trim() || ''
    } catch { /* fallback */ }
  }
  
  if (OPENROUTER_API_KEY) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'google/gemini-2.5-flash-lite', messages: msgs, max_tokens: 500 }),
    })
    const d = await r.json()
    return d.choices?.[0]?.message?.content?.trim() || ''
  }
  
  return ''
}

// ── Browserless full automation (form fill, click, screenshot) ──
async function runBrowserTask(task: string, url: string, actions: BrowserAction[]): Promise<BrowserResult> {
  if (!BROWSERLESS_KEY) {
    return { success: false, error: 'Full browser automation requires BROWSERLESS_API_KEY. Add it in Vercel environment variables. Get a free key at browserless.io', requiresSetup: true }
  }
  
  // Build Puppeteer script that captures screenshots at each step
  const actionsCode = actions.map((a, i) => {
    let actionCode = ''
    let actionLabel = ''
    if (a.type === 'navigate') { actionCode = `await page.goto('${a.url}', {waitUntil:'networkidle2',timeout:15000});`; actionLabel = `Navigate to ${a.url}` }
    else if (a.type === 'click') { actionCode = `await page.click('${a.selector}');await page.waitForTimeout(800);`; actionLabel = `Click ${a.selector}` }
    else if (a.type === 'fill') { actionCode = `await page.type('${a.selector}', '${(a.value||'').replace(/'/g, "\\'")}', {delay:30});`; actionLabel = `Fill ${a.selector}` }
    else if (a.type === 'select') { actionCode = `await page.select('${a.selector}', '${a.value}');`; actionLabel = `Select ${a.value}` }
    else if (a.type === 'wait') { actionCode = `await page.waitForTimeout(${a.ms || 1000});`; actionLabel = `Wait ${a.ms||1000}ms` }
    else if (a.type === 'submit') { actionCode = `await page.click('${a.selector}');await page.waitForTimeout(2000);`; actionLabel = `Submit form` }
    if (!actionCode) return ''
    return `
      try {
        ${actionCode}
        steps.push({action:'${actionLabel}',screenshot:(await page.screenshot({type:'png',fullPage:false})).toString('base64'),url:page.url(),title:await page.title()});
      } catch(stepErr) {
        steps.push({action:'Failed: ${actionLabel} — '+stepErr.message,screenshot:'',url:page.url(),title:await page.title()});
      }`
  }).join('\n    ')

  const script = `
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setViewport({width:1280,height:800});
    const steps = [];
    try {
      await page.goto('${url}', {waitUntil:'networkidle2',timeout:15000});
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
    const r = await fetch(`https://production-sfo.browserless.io/function?token=${BROWSERLESS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: script, context: {} }),
      signal: AbortSignal.timeout(25000),
    })
    const result = await r.json()
    return { success: true, ...result }
  } catch (e) {
    return { success: false, error: (e as Error).message }
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

// ── Log automation run ──
async function logRun(type: string, task: string, result: string, success: boolean) {
  try {
    const sb = getServiceClient()
    await sb.from('web_automation_logs').insert({
      type, task: task.slice(0, 500), result: result.slice(0, 1000),
      success, created_at: new Date().toISOString()
    })
  } catch { /* ignore if table doesn't exist */ }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { task, url, type = 'scrape', actions = [], query } = body

    // ── SCRAPE: fetch a page and extract info ──
    if (type === 'scrape' || type === 'read') {
      if (!url) return NextResponse.json({ ok: false, error: 'URL required for scrape' }, { status: 400 })
      
      const { text, links, title } = await fetchAndParse(url)
      
      // AI analysis if task provided
      let analysis = ''
      if (task) {
        analysis = await aiAnalyze(
          `You scraped a web page. Here is the content:\n\nTitle: ${title}\nURL: ${url}\n\nContent:\n${text}\n\n---\nUser task: ${task}\n\nAnswer the task based on the page content. Be specific and concise.`
        )
      }
      
      await logRun('scrape', task || url, analysis || text.slice(0, 200), true)
      const scrapeScreenshotUrl = `https://image.thum.io/get/width/1280/${encodeURIComponent(url)}`
      return NextResponse.json({ ok: true, type: 'scrape', title, url, text: text.slice(0, 3000), links, analysis, steps: [{ action: `Opened: ${title || url}`, screenshotUrl: scrapeScreenshotUrl, url, title }] })
    }

    // ── SEARCH: search the web and read results ──
    if (type === 'search') {
      const searchQuery = query || task
      if (!searchQuery) return NextResponse.json({ ok: false, error: 'Query required' }, { status: 400 })
      
      // Use Serper if available, otherwise Google scrape
      const serperKey = process.env.SERPER_API_KEY || ''
      let results: Array<{title: string; url: string; snippet: string}> = []
      
      if (serperKey) {
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: searchQuery, num: 5 }),
        })
        const d = await r.json()
        results = (d.organic || []).map((item: {title: string; link: string; snippet: string}) => ({
          title: item.title, url: item.link, snippet: item.snippet
        }))
      }
      
      let analysis = ''
      if (task && results.length > 0) {
        const content = results.map(r => `${r.title}\n${r.snippet}`).join('\n\n')
        analysis = await aiAnalyze(`Search results for "${searchQuery}":\n\n${content}\n\nTask: ${task}\n\nAnswer based on the search results.`)
      }
      
      await logRun('search', searchQuery, analysis, true)
      const searchSteps = results.slice(0, 3).map((r: {title: string; url: string; snippet: string}) => ({ action: r.title || r.url, screenshotUrl: `https://image.thum.io/get/width/1280/${encodeURIComponent(r.url)}`, url: r.url, title: r.title }))
      return NextResponse.json({ ok: true, type: 'search', query: searchQuery, results, analysis, steps: searchSteps })
    }

    // ── PARTS PRICE: search parts across multiple suppliers ──
    if (type === 'parts_price') {
      const partQuery = query || task
      if (!partQuery) return NextResponse.json({ ok: false, error: 'Part query required' }, { status: 400 })
      
      const serperKey = process.env.SERPER_API_KEY || ''
      let priceInfo = ''
      
      if (serperKey) {
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: `${partQuery} auto part price site:napaonline.com OR site:oreillyauto.com OR site:autozone.com`, num: 6 }),
        })
        const d = await r.json()
        const organic = d.organic || []
        priceInfo = organic.map((item: {title: string; snippet: string; link: string}) =>
          `${item.title}: ${item.snippet} (${item.link})`
        ).join('\n')
      }
      
      const analysis = await aiAnalyze(
        `Find the best price for this auto part: "${partQuery}"\n\nSearch results:\n${priceInfo || 'No results found'}\n\nExtract prices, part numbers, and recommend the best option. Format as a clean list.`
      )
      
      await logRun('parts_price', partQuery, analysis, true)
      return NextResponse.json({ ok: true, type: 'parts_price', query: partQuery, analysis, raw: priceInfo })
    }

    // ── MONITOR: check competitor pricing or reviews ──
    if (type === 'monitor_competitor') {
      const target = url || task
      if (!target) return NextResponse.json({ ok: false, error: 'URL or competitor name required' }, { status: 400 })
      
      let pageData = { text: '', title: '', links: [] as string[] }
      if (target.startsWith('http')) {
        pageData = await fetchAndParse(target)
      }
      
      const analysis = await aiAnalyze(
        `Analyze this competitor auto shop information:\n\nTarget: ${target}\nContent: ${pageData.text.slice(0, 3000)}\n\nExtract: services offered, prices listed, special offers, contact info, hours. What can Alpha International Auto Center do better?`
      )
      
      await logRun('monitor', target, analysis, true)
      return NextResponse.json({ ok: true, type: 'monitor', target, analysis })
    }

    // ── FULL BROWSER: requires browserless.io ──
    if (type === 'browser' || type === 'fill_form' || type === 'click') {
      if (!url) return NextResponse.json({ ok: false, error: 'URL required' }, { status: 400 })
      
      const result = await runBrowserTask(task, url, actions)
      
      let analysis = ''
      if (result.success && result.text && task) {
        analysis = await aiAnalyze(`Task was: ${task}\n\nPage after automation:\n${result.text}\n\nDid the task succeed? What happened? What should I do next?`)
      }
      
      await logRun('browser', task, result.error || analysis, result.success)
      return NextResponse.json({ ok: result.success, type: 'browser', ...result, analysis })
    }

    // ── FORM FILL HELPER: AI figures out the selectors ──
    if (type === 'smart_fill') {
      if (!url) return NextResponse.json({ ok: false, error: 'URL required' }, { status: 400 })
      
      // First scrape the page to understand the form structure
      const { text, title } = await fetchAndParse(url)
      
      // Extract form fields with AI
      const formAnalysis = await aiAnalyze(
        `This is a web form page: ${title}\n\nPage content:\n${text.slice(0, 3000)}\n\nTask: ${task}\n\nIdentify the form fields and what data should go in each field. Format as JSON: {fields: [{label, value, type}]}`
      )
      
      await logRun('smart_fill', task, formAnalysis, true)
      return NextResponse.json({ 
        ok: true, 
        type: 'smart_fill', 
        url, 
        title,
        analysis: formAnalysis,
        note: 'Form structure analyzed. Use type:browser with actions to fill it, or add BROWSERLESS_API_KEY for automated form submission.'
      })
    }

    return NextResponse.json({ ok: false, error: 'Unknown automation type. Use: scrape, search, parts_price, monitor_competitor, browser, smart_fill' }, { status: 400 })
  } catch (e) {
    console.error('Web automation error:', e)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export async function GET() {
  const hasBrowserless = !!process.env.BROWSERLESS_API_KEY
  const hasSerper = !!process.env.SERPER_API_KEY
  
  return NextResponse.json({
    ok: true,
    status: 'active',
    capabilities: {
      scrape: { available: true, description: 'Fetch and read any public webpage' },
      search: { available: hasSerper, description: 'Web search via Serper', setup: hasSerper ? null : 'Add SERPER_API_KEY to env vars' },
      parts_price: { available: hasSerper, description: 'Search auto parts prices across NAPA/OReilly/AutoZone' },
      monitor_competitor: { available: true, description: 'Scrape and analyze competitor websites' },
      browser: { available: hasBrowserless, description: 'Full browser automation: fill forms, click buttons, submit', setup: hasBrowserless ? null : 'Add BROWSERLESS_API_KEY from browserless.io (free tier available)' },
      smart_fill: { available: true, description: 'AI analyzes form structure and prepares fill instructions' },
    }
  })
}
