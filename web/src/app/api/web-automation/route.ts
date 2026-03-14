import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

// Fetch-based page reader — works without Browserless
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
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000)
  return { title, text, url }
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

      // Read / scrape a webpage
      case 'read': {
        if (!url) return fail('url required')
        const result = await fetchRead(url)
        return ok(result)
      }

      // Navigate — uses Browserless if available, otherwise falls back to fetch read
      case 'navigate': {
        if (!url) return fail('url required')
        if (!browserlessToken) {
          // Graceful fallback: just fetch and read the page
          try {
            const result = await fetchRead(url)
            return ok({ ...result, note: 'Used fetch fallback (no Browserless token). For JS-heavy pages, add BROWSERLESS_TOKEN.' })
          } catch (e) {
            return fail(`Could not read ${url}: ${e instanceof Error ? e.message : 'fetch error'}. Note: For Google/social sites, use the webSearch tool instead.`)
          }
        }
        // Use Browserless
        const puppeteerScript = `
          module.exports = async ({ page }) => {
            await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle2', timeout: 30000 });
            const title = await page.title();
            const text = await page.evaluate(() => document.body.innerText.slice(0, 5000));
            const currentUrl = page.url();
            return { data: { title, text, url: currentUrl } };
          };
        `
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

      case 'click':
      case 'fill':
      case 'screenshot':
      case 'run_script': {
        if (!browserlessToken) {
          return fail(`Browserless token not configured for action "${action}". Add BROWSERLESS_TOKEN to Vercel env vars (free at browserless.io). For lookups and searches, use the webSearch tool instead.`)
        }
        let puppeteerScript = ''
        if (action === 'click') {
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

      default:
        return fail(`Unknown action: ${action}. Use: read, navigate, click, fill, screenshot, run_script`)
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Internal error', 500)
  }
}
