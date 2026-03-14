import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

// Web Automation API
// Supports: navigate, read, click, fill, screenshot, scrape, search
// Uses Browserless.io for real browser automation (set BROWSERLESS_TOKEN in env)
// Falls back to fetch-based scraping for simple reads

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

      // Read / scrape a webpage (no JS required)
      case 'read': {
        if (!url) return fail('url required')
        const r = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,*/*',
          }
        })
        if (!r.ok) return fail(`HTTP ${r.status} from ${url}`)
        const html = await r.text()
        // Extract readable text from HTML
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000)
        return ok({ url, text, length: text.length })
      }

      // Full browser automation via Browserless
      case 'navigate':
      case 'click':
      case 'fill':
      case 'screenshot':
      case 'run_script': {
        if (!browserlessToken) {
          return fail('Browserless token not configured. Add BROWSERLESS_TOKEN to settings or environment variables. Get a free token at browserless.io')
        }

        // Use Browserless /function endpoint to run custom Puppeteer code
        let puppeteerScript = ''

        if (action === 'navigate' || action === 'read_js') {
          puppeteerScript = `
            module.exports = async ({ page }) => {
              await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle2', timeout: 30000 });
              const title = await page.title();
              const text = await page.evaluate(() => document.body.innerText.slice(0, 5000));
              const currentUrl = page.url();
              return { data: { title, text, url: currentUrl } };
            };
          `
        } else if (action === 'click') {
          puppeteerScript = `
            module.exports = async ({ page }) => {
              await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle2', timeout: 30000 });
              await page.click(${JSON.stringify(selector)});
              await page.waitForTimeout(1000);
              const text = await page.evaluate(() => document.body.innerText.slice(0, 3000));
              return { data: { clicked: true, resultText: text } };
            };
          `
        } else if (action === 'fill') {
          // fill can take multiple fields: fields = [{selector, value}]
          const fields = (body.fields as Array<{selector: string; value: string}>) || [{selector, value}]
          const fillSteps = fields.map(f =>
            `await page.type(${JSON.stringify(f.selector)}, ${JSON.stringify(f.value)});`
          ).join('\n')
          puppeteerScript = `
            module.exports = async ({ page }) => {
              await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle2', timeout: 30000 });
              ${fillSteps}
              ${body.submit_selector ? `await page.click(${JSON.stringify(body.submit_selector)});` : ''}
              await page.waitForTimeout(2000);
              const resultText = await page.evaluate(() => document.body.innerText.slice(0, 3000));
              return { data: { filled: true, resultText } };
            };
          `
        } else if (action === 'screenshot') {
          puppeteerScript = `
            module.exports = async ({ page }) => {
              await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle2', timeout: 30000 });
              const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });
              const title = await page.title();
              return { data: { screenshot: 'data:image/png;base64,' + screenshot, title } };
            };
          `
        } else if (action === 'run_script') {
          puppeteerScript = `
            module.exports = async ({ page }) => {
              ${url ? `await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle2', timeout: 30000 });` : ''}
              ${script || 'const result = await page.evaluate(() => document.body.innerText.slice(0, 3000));'}
              return { data: { done: true } };
            };
          `
        }

        const blRes = await fetch(`https://chrome.browserless.io/function?token=${browserlessToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/javascript' },
          body: puppeteerScript,
        })

        if (!blRes.ok) {
          const errText = await blRes.text()
          return fail(`Browserless error: ${errText}`)
        }

        const result = await blRes.json()
        return ok(result.data || result)
      }

      // Search Google via scraping
      case 'google_search': {
        if (!query) return fail('query required')
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query as string)}&num=10`
        const r = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
            'Accept': 'text/html',
          }
        })
        const html = await r.text()
        // Extract search result snippets
        const snippets: string[] = []
        const matches = html.matchAll(/<div class="[^"]*">([^<]{30,300})<\/div>/g)
        for (const m of matches) {
          const clean = m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim()
          if (clean.length > 30 && !clean.includes('{') && snippets.length < 10) {
            snippets.push(clean)
          }
        }
        return ok({ query, results: snippets, searched: true })
      }

      default:
        return fail(`Unknown action: ${action}. Use: read, navigate, click, fill, screenshot, run_script, google_search`)
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Internal error', 500)
  }
}
