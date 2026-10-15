import { runHostedBrowser, validateBrowserActions } from '@/lib/hosted-browser'
import type { BrowserAction } from '@/lib/hosted-browser'
import {
  AUTOMATION_SYSTEM, automationKind, describeActions, filterResults, resultsBlock, scopeFor, shapeControls, summaryPrompt, vetLegacyStep,
} from '@/lib/browser/automation'
import type { SearchResultRow } from '@/lib/browser/automation'
import { describeRefusal, LIMITS, makeCheck, makeResourceFetcher } from '@/lib/browser/guard'
import { hasAiKey, makeAskModel } from '@/lib/browser/model'
import type { PolicyContext } from '@/lib/browser/policy'
import { verifyRetailerLeads } from '@/lib/browser/price-evidence'
import { readPage, searchWeb } from '@/lib/browser/read-page'
import type { ReadResult } from '@/lib/browser/read-page'
import { cleanPageText, injectionNotice, inspectPageText, wrapUntrusted } from '@/lib/browser/untrusted'
import { displayHost, parseTarget, redactUrlForLog } from '@/lib/browser/url'
import { audit, loadShopRules, openRoute, readJson, reply, usedToday } from '@/lib/browser/server'
import type { BrowserAudit, BrowserCaller } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Ask Alpha's way of looking at the web. Same safety rules as the Browser page: signed-in shops only, public sites only,
 * the shop's allow and block lists, rate limits, a daily cap, an audit line for every page and step, and page text handed to
 * the AI only as labelled, untrusted data. The shapes of the answers are unchanged so the chat keeps working.
 */
const LIVE_EVENTS: BrowserAudit[] = ['browser.visit', 'browser.fill', 'browser.click', 'browser.sent', 'browser.approval_asked', 'browser.handoff']
const PARTS_SITES = 'site:napaonline.com OR site:oreillyauto.com OR site:autozone.com'

type Step = { action: string; screenshotUrl: string; url: string; title: string }

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function shot(url: string): string {
  return `/api/screenshot?url=${encodeURIComponent(url)}`
}

function statusFor(code: Extract<ReadResult, { ok: false }>['code']): number {
  return code === 'blocked' ? 403 : code === 'bad_url' ? 400 : code === 'not_found' ? 404 : code === 'too_large' ? 413 : code === 'timeout' ? 504 : 502
}

async function logRun(caller: BrowserCaller, type: string, task: string, result: string, success: boolean) {
  try {
    await caller.db.from('web_automation_logs').insert({ shop_id: caller.auth.shopId, type, task: task.slice(0, 500), result: result.slice(0, 1000), success, created_at: new Date().toISOString() })
  } catch { /* the log table is optional */ }
}

type Found = { ok: true; rows: SearchResultRow[]; hidden: number } | { ok: false; message: string }

/** One web search. A search key (SERPER_API_KEY) is used when the shop's host has set one; otherwise the built-in search is used. */
async function runSearch(query: string, ctx: PolicyContext): Promise<Found> {
  const key = process.env.SERPER_API_KEY || ''
  if (key) {
    try {
      const r = await fetch('https://google.serper.dev/search', {
        method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: query, num: 6 }), signal: AbortSignal.timeout(10_000),
      })
      const d = await r.json().catch(() => null) as { organic?: Array<{ title?: unknown; link?: unknown; snippet?: unknown }> } | null
      if (r.ok && d) {
        const rows: SearchResultRow[] = []
        for (const item of (d.organic || []).slice(0, 10)) {
          const parsed = parseTarget(typeof item.link === 'string' ? item.link : '')
          if (!parsed.ok) continue
          rows.push({ title: cleanPageText(String(item.title ?? ''), 160), url: parsed.url.toString(), snippet: cleanPageText(String(item.snippet ?? ''), 300) })
        }
        const filtered = filterResults(rows, ctx)
        return { ok: true, rows: filtered.rows.slice(0, 6), hidden: filtered.hidden }
      }
    } catch { /* fall through to the built-in search */ }
  }
  const found = await searchWeb(query, ctx, 'ai')
  if (!found.ok) return { ok: false, message: found.message }
  return { ok: true, rows: found.hits.slice(0, 6).map(h => ({ title: h.title, url: h.url, snippet: h.snippet })), hidden: found.hidden }
}

export async function POST(req: Request) {
  try {
    const body = await readJson(req, 128_000) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ ok: false, error: 'Send the request as JSON.' }, 400)
    const type = typeof body.type === 'string' ? body.type : 'scrape'
    const kind = automationKind(type)
    const rawActions = body.actions ?? []
    const hasActions = Array.isArray(rawActions) && rawActions.length > 0
    const gate = await openRoute(req, {
      scope: scopeFor(kind ?? 'read'), need: kind === 'live' && hasActions ? 'act' : 'browse', write: true, allowService: true, body: body as { shopId?: unknown },
    })
    if (!gate.ok) return gate.response
    const { caller } = gate
    if (!kind) return reply({ ok: false, error: 'Unknown automation type' }, 400)
    const rules = await loadShopRules(caller, req)
    if (!rules.ctx.settings.aiEnabled) return reply({ ok: false, error: 'Alpha is switched off for the browser in this shop. Turn it on in the browser settings.', code: 'ai_off' }, 403)

    const task = str(body.task, 4000)
    const url = str(body.url, 2048)
    const query = str(body.query, 500)
    const notices: string[] = []

    const refuse = async (address: string, label = ''): Promise<Response | null> => {
      const why = describeRefusal(address, rules.ctx, 'ai')
      if (!why) return null
      const parsed = parseTarget(address)
      if (parsed.ok) await audit(caller, 'browser.blocked', { url: address, actor: 'ai', detail: why })
      return reply({ ok: false, error: label ? `${label}: ${why}` : why, code: parsed.ok ? 'blocked' : 'bad_url' }, parsed.ok ? 403 : 400)
    }
    if (url) { const stop = await refuse(url); if (stop) return stop }

    let actions: BrowserAction[] = []
    if (kind === 'live') {
      try { actions = validateBrowserActions(rawActions) } catch (error) {
        return reply({ ok: false, error: (error as Error).message }, 400)
      }
      for (const action of actions) {
        if (action.type === 'navigate') { const stop = await refuse(String(action.url || '').trim(), 'Navigate action rejected'); if (stop) return stop }
      }
    }

    // The shop's own AI key, loaded only when something needs it.
    let aiSettings: Record<string, unknown> | null | undefined
    const analyze = async (prompt: string): Promise<string> => {
      if (aiSettings === undefined) {
        try {
          const { data } = await caller.db.from('settings').select('ai_api_key,ai_base_url,ai_model').eq('shop_id', caller.auth.shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
          aiSettings = data ?? null
        } catch { aiSettings = null }
      }
      if (!hasAiKey(aiSettings)) { if (!notices.includes('Add your AI key in Settings to get a written answer.')) notices.push('Add your AI key in Settings to get a written answer.'); return '' }
      const said = await makeAskModel(aiSettings || {}, fetch, 20_000, 500)([{ role: 'system', content: AUTOMATION_SYSTEM }, { role: 'user', content: prompt }])
      return said ? said.trim() : ''
    }
    const finish = (data: Record<string, unknown>, status = 200) => reply({ ...data, ...(notices.length ? { notice: notices.join(' ') } : {}) }, status)

    /* ---- read a page ---- */
    if (kind === 'read') {
      if (!url) return reply({ ok: false, error: 'URL required for scrape' }, 400)
      const read = await readPage(url, rules.ctx, 'ai')
      if (!read.ok) {
        await logRun(caller, 'scrape', task || url, read.message, false)
        return reply({ ok: false, error: read.message, code: read.code }, statusFor(read.code))
      }
      const doc = read.doc
      const host = displayHost(read.finalUrl)
      const warn = injectionNotice(doc.injection)
      if (warn) notices.push(warn)
      const analysis = task ? await analyze(summaryPrompt(task, { title: doc.title, host, text: doc.text })) : ''
      await logRun(caller, 'scrape', task || url, analysis || doc.text.slice(0, 200), true)
      await audit(caller, 'browser.read', { url: read.finalUrl, actor: 'ai', detail: doc.title })
      const picture = shot(read.finalUrl)
      const title = doc.title || host
      const steps: Step[] = [
        { action: `Navigating to ${host}...`, screenshotUrl: picture, url: read.finalUrl, title },
        { action: `Reading page: ${title}`, screenshotUrl: picture, url: read.finalUrl, title },
        ...(analysis ? [{ action: `Analyzed: ${analysis.slice(0, 120)}${analysis.length > 120 ? '...' : ''}`, screenshotUrl: picture, url: read.finalUrl, title }] : []),
      ]
      const links = [...new Set(doc.links.map(l => l.href).filter(h => /^https?:\/\//i.test(h)))].slice(0, 20)
      return finish({
        ok: true, type: 'scrape', title: cleanPageText(doc.title, 160), url: read.finalUrl, text: wrapUntrusted(doc.text, host, 3000), links, analysis, steps, untrusted: true,
        injection: { suspected: doc.injection.suspected, hiddenText: doc.injection.hiddenText },
      })
    }

    /* ---- search ---- */
    if (kind === 'search') {
      const q = (query || task).slice(0, 500)
      if (!q) return reply({ ok: false, error: 'Query required' }, 400)
      const found = await runSearch(q, rules.ctx)
      if (!found.ok) {
        await logRun(caller, 'search', q, found.message, false)
        return reply({ ok: false, search_succeeded: false, error: found.message }, 502)
      }
      const succeeded = found.rows.length > 0
      const analysis = task && succeeded ? await analyze(`The shop's task: ${task}\n\n${resultsBlock(found.rows, 'web search results')}\n\nAnswer the task using only the search results above.`) : ''
      if (found.hidden) notices.push(`${found.hidden} result${found.hidden === 1 ? ' was' : 's were'} left out because of your shop's browser rules.`)
      if (!succeeded) notices.push('No search results were found for that. Try different words.')
      await logRun(caller, 'search', q, analysis || (succeeded ? 'Search completed' : 'No verified results'), succeeded)
      await audit(caller, 'browser.search', { actor: 'ai', detail: `Searched the web (${found.rows.length} results)`, meta: { words: q.split(/\s+/).length } })
      const steps: Step[] = succeeded ? [
        { action: `Searching for: "${q}"...`, screenshotUrl: '', url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}`, title: `Search: ${q}` },
        ...found.rows.slice(0, 2).map(r => ({ action: `Found: ${r.title || r.url} -- ${(r.snippet || '').slice(0, 80)}`, screenshotUrl: shot(r.url), url: r.url, title: r.title })),
      ] : []
      if (steps.length > 1 && analysis) steps.push({ action: analysis.slice(0, 140), screenshotUrl: steps[steps.length - 1].screenshotUrl, url: steps[steps.length - 1].url, title: 'Summary' })
      return finish({ ok: true, type: 'search', query: q, results: found.rows, analysis, search_succeeded: succeeded, steps, untrusted: true })
    }

    /* ---- parts prices ---- */
    if (kind === 'parts') {
      const partQuery = (query || task).slice(0, 500)
      if (!partQuery) return reply({ ok: false, error: 'Part query required' }, 400)
      const found = await runSearch(`${partQuery} auto part price ${PARTS_SITES}`, rules.ctx)
      if (!found.ok) {
        await logRun(caller, 'parts_price', partQuery, found.message, false)
        return reply({ ok: false, price_verified: false, error: found.message }, 502)
      }
      const resultsFound = found.rows.length > 0
      // A price is "verified" only when Alpha opened a parts-store page and the page itself shows it. Search text alone is not.
      const evidence = resultsFound ? await verifyRetailerLeads(found.rows, async address => {
        const read = await readPage(address, rules.ctx, 'ai')
        if (!read.ok) return { ok: false }
        await audit(caller, 'browser.read', { url: read.finalUrl, actor: 'ai', detail: 'Checked a parts store page for a price' })
        return { ok: true, title: read.doc.title, text: read.doc.text, finalUrl: read.finalUrl }
      }) : []
      const verified = evidence.length > 0
      const block = resultsFound ? resultsBlock(found.rows, 'auto parts search results') : ''
      const evidenceBlock = verified
        ? wrapUntrusted(evidence.map(e => `${e.store}: $${e.price.toFixed(2)} on ${e.url} (page says: ${e.shownAs})`).join('\n'), 'parts store pages', 1500)
        : ''
      const analysis = resultsFound ? await analyze(`The shop wants the best price for this auto part: "${partQuery}".\n\n${verified ? `Prices Alpha read on the store pages themselves:\n${evidenceBlock}\n\n` : ''}${block}\n\nList the prices and part numbers that appear above and recommend the best option. Say which prices were read on a store page and which come only from search result text. Do not guess a number that is not shown.`) : ''
      notices.push(verified
        ? `Alpha opened ${evidence.length} parts store page${evidence.length === 1 ? '' : 's'} and read the price there. Confirm fitment and availability before you quote a customer.`
        : resultsFound ? 'These prices come from search result text, not from a store page Alpha could read. Check the vendor page before you quote a customer.' : 'No price results were found. Try the part number or a different description.')
      await logRun(caller, 'parts_price', partQuery, analysis || (verified ? 'Store page prices found' : resultsFound ? 'Search results only, no store page price' : 'No price results'), resultsFound)
      await audit(caller, 'browser.search', { actor: 'ai', detail: `Looked up a part price (${found.rows.length} results, ${evidence.length} store pages with a price)` })
      return finish({
        ok: true, type: 'parts_price', query: partQuery, analysis, raw: block, price_verified: verified, search_results_found: resultsFound,
        verified_price_evidence: evidence, untrusted: true,
      })
    }

    /* ---- competitor ---- */
    if (kind === 'monitor') {
      const target = url || task
      if (!target) return reply({ ok: false, error: 'URL or competitor name required' }, 400)
      let material = ''
      let host = 'search results'
      if (/^https?:\/\//i.test(target)) {
        const stop = await refuse(target)
        if (stop) return stop
        const read = await readPage(target, rules.ctx, 'ai')
        if (!read.ok) return reply({ ok: false, error: read.message, code: read.code }, statusFor(read.code))
        const warn = injectionNotice(read.doc.injection)
        if (warn) notices.push(warn)
        host = displayHost(read.finalUrl)
        material = wrapUntrusted(read.doc.text, host, 3500)
        await audit(caller, 'browser.read', { url: read.finalUrl, actor: 'ai', detail: read.doc.title })
      } else {
        const found = await runSearch(`${target.slice(0, 200)} auto repair shop`, rules.ctx)
        if (!found.ok) return reply({ ok: false, error: found.message }, 502)
        if (!found.rows.length) return finish({ ok: true, type: 'monitor', target, analysis: '', notice: 'Nothing was found for that name. Paste the shop\'s website address instead.' })
        material = resultsBlock(found.rows, 'search results')
        notices.push('This is based on search result text only. Paste the shop\'s website address to read its pages.')
        await audit(caller, 'browser.search', { actor: 'ai', detail: 'Looked up a competitor by name' })
      }
      const analysis = await analyze(`The shop wants to know about this competitor: ${cleanPageText(target, 200)}\n\n${material}\n\nList the services offered, prices shown, special offers, contact details and hours that appear above. Say "not shown" for anything that is missing.`)
      await logRun(caller, 'monitor', target, analysis, true)
      return finish({ ok: true, type: 'monitor', target, analysis, untrusted: true })
    }

    /* ---- plan a form ---- */
    if (kind === 'smart_fill') {
      if (!url) return reply({ ok: false, error: 'URL required' }, 400)
      const read = await readPage(url, rules.ctx, 'ai')
      if (!read.ok) return reply({ ok: false, error: read.message, code: read.code }, statusFor(read.code))
      const doc = read.doc
      const host = displayHost(read.finalUrl)
      const warn = injectionNotice(doc.injection)
      if (warn) notices.push(warn)
      const fields = doc.forms.flatMap(f => f.fields).slice(0, 30).map(f => ({ label: cleanPageText(f.label, 60), type: cleanPageText(f.type, 20) }))
      const fieldText = fields.map(f => `- ${f.label || 'Unnamed field'} (${f.type || 'text'})`).join('\n') || 'No fields were found.'
      const analysis = await analyze(`The shop's task: ${task || 'Work out what each field on this form is for.'}\n\n${wrapUntrusted(`${fieldText}\n\n${doc.text}`, host, 5000)}\n\nName the form fields and what shop data would go in each. Never suggest passwords, card numbers or security codes. Only plan: do not claim anything was filled in or sent.`)
      notices.push('This only plans the form. To fill it in, open the Browser page, where every send needs your approval.')
      await logRun(caller, 'smart_fill', task || url, analysis, true)
      await audit(caller, 'browser.read', { url: read.finalUrl, actor: 'ai', detail: 'Planned a form' })
      return finish({ ok: true, type: 'smart_fill', url: read.finalUrl, title: cleanPageText(doc.title, 160), analysis, fields, untrusted: true })
    }

    /* ---- the older step list in a real (locked) browser ---- */
    if (!url) return reply({ ok: false, error: 'URL required' }, 400)
    if (hasActions && body.approval !== 'confirm') {
      return reply({ ok: false, approvalRequired: true, error: 'Browser actions require explicit approval', summary: describeActions(actions) }, 409)
    }
    if (await usedToday(caller, LIVE_EVENTS) >= LIMITS.liveDaily) {
      return reply({ ok: false, error: 'This shop has used its live browsing for today. Reading pages still works, and live browsing resets tomorrow.', code: 'daily_cap' }, 429)
    }
    const result = await runHostedBrowser(url, actions, {
      check: makeCheck(rules.ctx, 'ai'), fetchResource: makeResourceFetcher(), vet: vetLegacyStep, cleanText: t => cleanPageText(t, 6000),
    })
    const kindOfAudit: BrowserAudit = hasActions ? 'browser.click' : 'browser.visit'
    if (!result.success) {
      await logRun(caller, 'browser', task || url, result.error || 'The browser run failed', false)
      await audit(caller, kindOfAudit, { url, actor: 'ai', detail: `Stopped: ${result.error}`.slice(0, 280) })
      return reply({ ok: false, type: 'browser', ...result }, 502)
    }
    const look = inspectPageText(result.text || '')
    const warn = injectionNotice(look)
    const finalHost = displayHost(result.url || url)
    await logRun(caller, 'browser', task || url, 'Browser steps completed; see page evidence', true)
    await audit(caller, kindOfAudit, {
      url: result.url || url, actor: 'ai', detail: hasActions ? `Ran the steps you confirmed (${describeActions(actions)})` : 'Opened the page',
      meta: { pages: [redactUrlForLog(url), ...actions.filter(a => a.type === 'navigate').map(a => redactUrlForLog(a.url || ''))].slice(0, 9) },
    })
    return reply({
      ok: true, type: 'browser', success: true, steps: result.steps, text: wrapUntrusted(result.text || '', finalHost, 5400), controls: shapeControls(result.controls, look.suspected),
      title: cleanPageText(result.title || '', 160), url: result.url || url, mode: result.mode, untrusted: true,
      injection: { suspected: look.suspected, hiddenText: look.hiddenText },
      notice: [result.notice, warn, look.suspected ? 'Page controls were not offered to Alpha because the page looked like it was giving instructions to an AI.' : ''].filter(Boolean).join(' '),
    })
  } catch (e) {
    console.error('Web automation error:', e instanceof Error ? e.message : 'unknown')
    return reply({ ok: false, error: 'That browser request could not be completed. Try again in a moment.' }, 500)
  }
}

export async function GET(req: Request) {
  const gate = await openRoute(req, { scope: 'read', need: 'browse', allowService: true, body: { shopId: new URL(req.url).searchParams.get('shop_id') } })
  if (!gate.ok) return gate.response
  const rules = await loadShopRules(gate.caller, req)
  return reply({
    ok: true,
    status: rules.ctx.settings.aiEnabled ? 'active' : 'off',
    capabilities: {
      scrape: { available: true, description: 'Read any public web page the shop allows, as plain text' },
      search: { available: true, description: 'Web search' },
      parts_price: { available: true, description: 'Search auto parts prices from search result text' },
      monitor_competitor: { available: true, description: 'Read and summarise a competitor website' },
      browser: { available: true, description: 'Alpha-hosted locked browser: opening pages and preparing forms; anything that sends, buys or signs in is done on the Browser page with your approval' },
      smart_fill: { available: true, description: 'Plan what goes in a form (nothing is filled in or sent)' },
    },
  })
}
