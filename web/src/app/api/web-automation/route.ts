import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

// Fetch-based page reader
async function fetchRead(url: string): Promise<{ title: string; text: string; url: string }> {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*',
    }
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`)
  const html = await r.text()
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = titleMatch?.[1]?.trim() || url
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000)
  return { title, text, url }
}

// Create a Steel browser session and return the viewer URL
async function createSteelSession(url: string): Promise<{ sessionId: string; sessionViewerUrl: string; websocketUrl: string }> {
  const steelApiKey = process.env.STEEL_API_KEY
  if (!steelApiKey) throw new Error('STEEL_API_KEY not configured')

  // Create session
  const createRes = await fetch('https://api.steel.dev/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Steel-Api-Key': steelApiKey,
    },
    body: JSON.stringify({
      use_proxy: false,
      session_timeout: 900000,
    }),
  })
  if (!createRes.ok) {
    const err = await createRes.text()
    throw new Error(`Steel session create failed: ${err}`)
  }
  const session = await createRes.json()
  const sessionId = session.id
  const sessionViewerUrl = session.debugUrl ? `${session.debugUrl}?interactive=true&showControls=true` : session.session_viewer_url || session.sessionViewerUrl || `https://viewer.steel.dev?sessionId=${sessionId}`
  const websocketUrl = `wss://connect.steel.dev?apiKey=${steelApiKey}&sessionId=${sessionId}`

  return { sessionId, sessionViewerUrl, websocketUrl }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const { action, url, selector, value, script, query } = body as {
    action: string
    url?: string
    selector?: string
    value?: string
    script?: string
    query?: string
  }

  const sb = getServiceClient()
  const { data: settings } = await sb.from('settings').select('browserless_token').limit(1).single()
  const browserlessToken = settings?.browserless_token || process.env.BROWSERLESS_TOKEN

  try {
    switch (action) {
      // Create a Steel live browser session — returns viewer URL for iframe
      case 'steel_session': {
        if (!url) return fail('url required')
        try {
          const { sessionId, sessionViewerUrl, websocketUrl } = await createSteelSession(url)
          return ok({
            sessionId,
            sessionViewerUrl,
            websocketUrl,
            startUrl: url,
            message: `Live browser session started! Session ID: ${sessionId}`,
          })
        } catch (e) {
          return fail(`Steel session error: ${e instanceof Error ? e.message : 'unknown error'}`)
        }
      }

      // Read / scrape a webpage
      case 'read': {
        if (!url) return fail('url required')
        const result = await fetchRead(url)
        return ok(result)
      }

      // Navigate
      case 'navigate': {
        if (!url) return fail('url required')
        if (!browserlessToken) {
          try {
            const result = await fetchRead(url)
            return ok({ ...result, note: 'Used fetch fallback (no Browserless token).' })
          } catch (e) {
            return fail(`Could not read ${url}: ${e instanceof Error ? e.message : 'fetch error'}. Use webSearch tool for Google/social sites.`)
          }
        }
        const puppeteerScript = `
          module.exports = async ({ page }) => {
            await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle2', timeout: 30000 });
            const title = await page.title();
            const text = await page.evaluate(() => document.body.innerText.slice(0, 5000));
            return { data: { title, text, url: page.url() } };
          };
        `
        const blRes = await fetch(`https://chrome.browserless.io/function?token=${browserlessToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/javascript' },
          body: puppeteerScript,
        })
        if (!blRes.ok) return fail(`Browserless error: ${await blRes.text()}`)
        const result = await blRes.json()
        return ok(result.data || result)
      }

      case 'click':
      case 'fill':
      case 'screenshot':
      case 'run_script': {
        if (!browserlessToken) {
          return fail(`Browserless not configured for "${action}". Use webSearch or steel_session instead.`)
        }
        let puppeteerScript = ''
        if (action === 'click') {
          puppeteerScript = `module.exports = async ({ page }) => { await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle2' }); await page.click(${JSON.stringify(selector)}); const text = await page.evaluate(() => document.body.innerText.slice(0, 3000)); return { data: { clicked: true, resultText: text } }; };`
        } else if (action === 'fill') {
          const fields = (body.fields as Array<{selector: string; value: string}>) || [{selector, value}]
          const fillSteps = fields.map(f => `await page.type(${JSON.stringify(f.selector)}, ${JSON.stringify(f.value)});`).join('\n')
          puppeteerScript = `module.exports = async ({ page }) => { await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle2' }); ${fillSteps} ${body.submit_selector ? `await page.click(${JSON.stringify(body.submit_selector)});` : ''} const resultText = await page.evaluate(() => document.body.innerText.slice(0, 3000)); return { data: { filled: true, resultText } }; };`
        } else if (action === 'screenshot') {
          puppeteerScript = `module.exports = async ({ page }) => { await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle2' }); const screenshot = await page.screenshot({ encoding: 'base64' }); return { data: { screenshot: 'data:image/png;base64,' + screenshot, title: await page.title() } }; };`
        } else {
          puppeteerScript = `module.exports = async ({ page }) => { ${url ? `await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle2' });` : ''} ${script || ''} return { data: { done: true } }; };`
        }
        const blRes = await fetch(`https://chrome.browserless.io/function?token=${browserlessToken}`, {
          method: 'POST', headers: { 'Content-Type': 'application/javascript' }, body: puppeteerScript,
        })
        if (!blRes.ok) return fail(`Browserless error: ${await blRes.text()}`)
        return ok((await blRes.json()).data)
      }

      default:
        return fail(`Unknown action: ${action}. Use: read, navigate, click, fill, screenshot, run_script, steel_session`)
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Internal error', 500)
  }
}
