'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import type { RepairManualPage, RepairSearchResult, RepairSource, RepairVehicle } from '@/lib/repair/sources'
import { buildRepairPresentation, detectRepairDtc, REPAIR_DTC_GUIDES } from '@/lib/repair/presentation'
import { draftForTotal, parseTotal, splitList, vehicleLabel } from '@/lib/repair-ui'
import { EMPTY_VEHICLE } from './types'
import type { SavedDraft, Say } from './types'

const DRAFTS_KEY = 'alpha_repair_drafts'
const MAX_PINS = 8
const MAX_BOOKMARKS = 12
const MAX_DRAFTS = 20

async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

interface ApiBody { ok?: boolean; error?: unknown; code?: unknown; data?: unknown }

/** What went wrong, in words that say what to do next. */
function failText(res: Response, body: ApiBody, fallback: string): string {
  if (res.status === 401) return 'Your sign-in ended. Sign in again, then try again.'
  if (res.status === 429 || body.code === 'RATE_LIMITED') return 'That was too many lookups in one minute. Wait a moment, then try again.'
  return typeof body.error === 'string' && body.error ? body.error : fallback
}

function networkText(err: unknown, timedOut: boolean, fallback: string, slow: string): string {
  if (timedOut) return slow
  if (err instanceof DOMException && err.name === 'AbortError') return ''
  if (err instanceof TypeError) return 'Alpha could not reach the server. Check your connection, then try again.'
  return err instanceof Error && err.message ? err.message : fallback
}

/** Runs a JSON request with a time limit. The caller can cancel it, and the limit is reported separately from a cancel. */
async function postJson(url: string, payload: unknown, limitMs: number, cancel?: AbortController, extraHeaders?: Record<string, string>) {
  const ctl = cancel || new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctl.abort() }, limitMs)
  try {
    const res = await fetch(url, { method: 'POST', headers: { ...(await getAuthJsonHeaders()), ...(extraHeaders || {}) }, body: JSON.stringify(payload), signal: ctl.signal })
    const body = (await res.json().catch(() => ({}))) as ApiBody
    return { res, body }
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error('Request failed'), { timedOut })
  } finally {
    clearTimeout(timer)
  }
}

/** Every failure ends with what to do next. */
const thenTryAgain = (text: string) => (/try again|check/i.test(text) ? text : `${text} Try again.`)

const wasTimeout = (err: unknown) => Boolean((err as { timedOut?: boolean } | null)?.timedOut)

function sourceLine(item: { provider: string; category: string; title: string; url: string }) {
  return `${item.provider} ${item.category}: ${item.title} ${item.url}`
}

function buildEstimatePrompt(result: RepairSearchResult) {
  return [
    'Build a draft estimate from this source-backed repair research.',
    `Vehicle: ${vehicleLabel(result.normalizedVehicle)}`,
    `Operation: ${result.draft.operation}`,
    'Status: technician review required before final labor/specs.',
    '',
    'Internal repair checklist:',
    ...result.draft.checklist.map(item => `- ${item}`),
    '',
    'Source links:',
    ...result.sources.slice(0, 8).map(item => `- ${sourceLine(item)}`),
    '',
    'Do not invent torque specs, procedures, labor hours, or prices. Use source links and ask for missing verification.',
  ].join('\n')
}

function readDrafts(): SavedDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((d): d is SavedDraft => d && typeof d.id === 'string' && typeof d.title === 'string') : []
  } catch { return [] }
}

function writeDrafts(drafts: SavedDraft[]): boolean {
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); return true } catch { return false }
}

const BLOCKED = 'Your browser blocked saving on this device. Allow site storage for Alpha, then try again.'

export function useRepair() {
  const [query, setQuery] = useState('')
  const [vehicle, setVehicle] = useState<RepairVehicle>(EMPTY_VEHICLE)
  const [result, setResult] = useState<RepairSearchResult | null>(null)
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchId, setSearchId] = useState(0)
  const [say, setSay] = useState<Say | null>(null)

  const [manualPage, setManualPage] = useState<RepairManualPage | null>(null)
  const [manualLoading, setManualLoading] = useState(false)
  const [manualError, setManualError] = useState('')
  const [manualUrl, setManualUrl] = useState('')
  const [readerOpen, setReaderOpen] = useState(false)

  const [pinned, setPinned] = useState<RepairSource[]>([])
  const [viewer, setViewer] = useState<{ url: string; alt: string } | null>(null)
  const [bookmarks, setBookmarks] = useState<Array<{ url: string; alt: string }>>([])
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>([])

  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [lockedTotal, setLockedTotal] = useState('')
  const [creating, setCreating] = useState(false)
  const [estimateSay, setEstimateSay] = useState<Say | null>(null)
  const [created, setCreated] = useState('')
  const [customers, setCustomers] = useState<Array<{ name: string; phone: string; email: string }>>([])

  const [tools, setTools] = useState('')
  const [partsFluids, setPartsFluids] = useState('')
  const [notes, setNotes] = useState('')
  const [approvedBy, setApprovedBy] = useState('')
  const [saving, setSaving] = useState(false)
  const [procedureSay, setProcedureSay] = useState<Say | null>(null)

  // Guards against an older answer landing on top of a newer one.
  const searchSeq = useRef(0)
  const manualSeq = useRef(0)
  const searchCancel = useRef<AbortController | null>(null)
  const manualCancel = useRef<AbortController | null>(null)
  const lastRequested = useRef('')
  const lastCombined = useRef('')
  const lastManual = useRef<{ url: string; quiet: boolean; open: boolean; literal: boolean } | null>(null)
  const creatingRef = useRef(false)
  // One key per exact estimate. Trying again after a dropped connection reuses it, so the server makes the estimate once.
  const estimateKey = useRef<{ fingerprint: string; key: string } | null>(null)
  const savingRef = useRef(false)
  const urlHandled = useRef(false)

  useEffect(() => { setSavedDrafts(readDrafts()) }, [])

  // Existing customers, so a typed name matches one that is already on file instead of making a second copy.
  useEffect(() => {
    let live = true
    getShopId().then(async shopId => {
      if (!shopId) return
      const { data } = await supabase.from('customers').select('name,phone,email').eq('shop_id', shopId).order('name').limit(500)
      if (!live || !Array.isArray(data)) return
      const seen = new Set<string>()
      setCustomers(data
        .map(c => ({ name: String(c.name || '').trim(), phone: String(c.phone || ''), email: String(c.email || '') }))
        .filter(c => c.name && !seen.has(c.name.toLowerCase()) && !!seen.add(c.name.toLowerCase())))
    }).catch(() => { /* typing a name still works */ })
    return () => { live = false }
  }, [])

  /* ---------- the answer, worked out once per search ---------- */
  const repairView = useMemo(() => (result ? buildRepairPresentation(query || result.query, result) : null), [query, result])

  const simpleAnswer = useMemo(() => {
    if (!result) return null
    const dtc = detectRepairDtc(`${result.query} ${query}`)
    const guide = dtc ? REPAIR_DTC_GUIDES[dtc] : undefined
    const firstOperation = result.operationLines[0]
    return {
      dtc,
      title: guide ? `${dtc}: ${guide.meaning}` : (firstOperation?.label || result.draft.operation || 'Repair lookup'),
    }
  }, [query, result])

  const total = parseTotal(lockedTotal)
  const draft = useMemo(
    () => (result ? draftForTotal(result.estimateDraft, result.operationLines, lockedTotal, result.draft.operation) : null),
    [result, lockedTotal],
  )

  /* ---------- manual pages ---------- */
  const loadManual = useCallback(async (url: string, opts: { quiet?: boolean; open?: boolean; literal?: boolean } = {}) => {
    if (!url) return
    const quiet = Boolean(opts.quiet), open = Boolean(opts.open), literal = Boolean(opts.literal)
    lastManual.current = { url, quiet, open, literal }
    manualCancel.current?.abort()
    const ctl = new AbortController()
    manualCancel.current = ctl
    const seq = ++manualSeq.current
    setManualUrl(url); setManualLoading(true); setManualError('')
    if (open) setReaderOpen(true)
    if (!quiet) setManualPage(null)
    try {
      // The lookup text lets the server walk a folder down to the page that has the diagram. Browsing the tree by hand skips that.
      const { res, body } = await postJson('/api/repair-manual', { url, query: literal ? '' : lastCombined.current }, 45000, ctl)
      if (seq !== manualSeq.current) return
      if (!res.ok || !body.ok) throw new Error(failText(res, body, 'The manual page did not load.'))
      setManualPage(body.data as RepairManualPage)
    } catch (err) {
      if (seq !== manualSeq.current) return
      const text = networkText(err, wasTimeout(err), 'The manual page did not load.', 'The manual site took too long to answer.')
      if (text) setManualError(text)
    } finally {
      if (seq === manualSeq.current) setManualLoading(false)
    }
  }, [])

  const retryManual = useCallback(() => {
    const last = lastManual.current
    if (last) void loadManual(last.url, { quiet: false, open: last.open, literal: last.literal })
  }, [loadManual])

  const openReader = useCallback(() => setReaderOpen(true), [])
  const closeReader = useCallback(() => setReaderOpen(false), [])

  /* ---------- searching ---------- */
  const search = useCallback(async (override?: string) => {
    const requested = (override ?? query).trim()
    const combined = [vehicle.vin, vehicle.year, vehicle.make, vehicle.model, vehicle.engine, requested].map(v => String(v || '').trim()).filter(Boolean).join(' ')
    if (!combined) return
    if (override !== undefined) setQuery(override)
    lastRequested.current = requested
    lastCombined.current = combined
    searchCancel.current?.abort()
    manualCancel.current?.abort()
    const ctl = new AbortController()
    searchCancel.current = ctl
    const seq = ++searchSeq.current
    manualSeq.current += 1
    setSearched(true); setLoading(true); setError(''); setResult(null); setSay(null)
    setManualPage(null); setManualError(''); setManualUrl(''); setManualLoading(false); setReaderOpen(false)
    setEstimateSay(null); setProcedureSay(null); setCreated('')
    try {
      const { res, body } = await postJson('/api/repair-search', { query: combined, vehicle }, 60000, ctl)
      if (seq !== searchSeq.current) return
      if (!res.ok || !body.ok) throw new Error(failText(res, body, 'The lookup did not finish.'))
      const data = body.data as RepairSearchResult
      setResult(data)
      setSearchId(seq)
      setLockedTotal(data?.estimateDraft?.targetTotal ? String(data.estimateDraft.targetTotal) : '')
      const firstManual = (data?.sources || []).find(item => item.provider === 'LEMON' || item.provider === 'CHARM')
      if (firstManual) void loadManual(firstManual.url, { quiet: true })
    } catch (err) {
      if (seq !== searchSeq.current) return
      const text = networkText(err, wasTimeout(err), 'The lookup did not finish.', 'The sources took too long to answer. Try again, or search for one repair at a time.')
      if (text) setError(text)
    } finally {
      if (seq === searchSeq.current) setLoading(false)
    }
  }, [query, vehicle, loadManual])

  const retrySearch = useCallback(() => { void search(lastRequested.current) }, [search])

  // Links from other screens: /repair?query=P0420+2012+Honda+Accord
  useEffect(() => {
    if (urlHandled.current) return
    urlHandled.current = true
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('query') || params.get('q')
    if (fromUrl && fromUrl.trim()) void search(fromUrl)
  }, [search])

  /* ---------- pins, bookmarks, saved lookups ---------- */
  const togglePin = useCallback((source: RepairSource) => {
    setSay(null)
    setPinned(prev => {
      if (prev.some(item => item.url === source.url)) return prev.filter(item => item.url !== source.url)
      if (prev.length >= MAX_PINS) {
        setSay({ kind: 'warn', text: `You can pin up to ${MAX_PINS} sources. Unpin one first.` })
        return prev
      }
      return [source, ...prev]
    })
  }, [])

  const toggleBookmark = useCallback((image: { url: string; alt: string }) => {
    setBookmarks(prev => (prev.some(item => item.url === image.url) ? prev.filter(item => item.url !== image.url) : [image, ...prev].slice(0, MAX_BOOKMARKS)))
  }, [])

  const saveDraft = useCallback(() => {
    if (!result) return
    const entry: SavedDraft = {
      id: `${Date.now()}`,
      title: result.draft.title,
      operation: result.draft.operation,
      vehicle: vehicleLabel(result.normalizedVehicle),
      checklist: result.draft.checklist,
      sourceUrls: result.sources.slice(0, 10).map(item => item.url),
      savedAt: new Date().toISOString(),
    }
    // Saving the same lookup again replaces the older copy instead of piling up.
    const next = [entry, ...savedDrafts.filter(d => !(d.vehicle === entry.vehicle && d.operation === entry.operation))].slice(0, MAX_DRAFTS)
    if (writeDrafts(next)) {
      setSavedDrafts(next)
      setSay({ kind: 'success', text: 'Saved on this device. Find it under Saved lookups at the bottom of this page.' })
    } else setSay({ kind: 'error', text: BLOCKED })
  }, [result, savedDrafts])

  const removeDraft = useCallback((id: string) => {
    const next = savedDrafts.filter(item => item.id !== id)
    writeDrafts(next)
    setSavedDrafts(next)
  }, [savedDrafts])

  const copySources = useCallback(async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.sources.map(item => `${item.provider} ${item.category}: ${item.title}\n${item.url}`).join('\n\n'))
      setSay({ kind: 'success', text: `Copied ${result.sources.length} source ${result.sources.length === 1 ? 'link' : 'links'}.` })
    } catch {
      setSay({ kind: 'error', text: 'Your browser would not copy. Open the Sources tab and copy the links from there.' })
    }
  }, [result])

  /* ---------- handing the job to Ask Alpha ---------- */
  const goToAi = useCallback((prefill: string, repairMode: boolean) => {
    try {
      if (repairMode) localStorage.setItem('ai_repair_mode', 'true')
      localStorage.setItem('ai_prefill', prefill)
    } catch {
      setSay({ kind: 'error', text: 'Your browser blocked saving this for Ask Alpha. Allow site storage for Alpha, then try again.' })
      return
    }
    window.location.href = repairMode ? '/ai?mode=repair' : '/ai'
  }, [])

  const sendToAlpha = useCallback(() => {
    if (!result) return
    const pins = pinned.length ? `\n\nPinned sources:\n${pinned.map(item => `- ${sourceLine(item)}`).join('\n')}` : ''
    goToAi(`${buildEstimatePrompt(result)}${pins}`, false)
  }, [result, pinned, goToAi])

  const openRepairAi = useCallback((followup?: string) => {
    if (!result) return
    const lines = [
      'REPAIR ONLY MODE. Stay focused on this repair/diagnostic problem and do not switch to general shop tasks unless I ask to leave repair mode.',
      `Vehicle: ${vehicleLabel(result.normalizedVehicle)}`,
      simpleAnswer?.dtc ? `Code: ${simpleAnswer.dtc}` : '',
      `Problem: ${simpleAnswer?.title || result.draft.operation}`,
      repairView?.mechanicSummary ? `Current answer: ${repairView.mechanicSummary}` : '',
      followup ? `Next question: ${followup}` : '',
      '',
      'Explain this in plain English for a mechanic. Give me:',
      '1. What it means',
      '2. What to check first',
      '3. What not to assume',
      '4. What estimate or diagnostic note to create',
      '',
      'Work items:',
      ...result.operationLines.map(item => `- ${item.label} (${item.system})`),
      '',
      'Important: do not invent torque specs, labor times, wiring pinouts, or protected procedure text.',
    ].filter(Boolean)
    goToAi(lines.join('\n'), true)
  }, [result, simpleAnswer, repairView, goToAi])

  /* ---------- estimate ---------- */
  const pickCustomer = useCallback((name: string) => {
    setCustomerName(name)
    const hit = customers.find(c => c.name.toLowerCase() === name.trim().toLowerCase())
    if (hit) {
      setCustomerPhone(p => p || hit.phone)
      setCustomerEmail(e => e || hit.email)
    }
  }, [customers])

  const createEstimate = useCallback(async () => {
    if (!result || !draft || creatingRef.current) return
    if (parseTotal(lockedTotal) === null) {
      setEstimateSay({ kind: 'error', text: 'Enter the estimate total as a number above $0, for example 430.' })
      return
    }
    creatingRef.current = true
    setCreating(true); setEstimateSay(null)
    try {
      const unique = [...pinned, ...result.sources.slice(0, 5)].filter((item, i, all) => all.findIndex(o => o.url === item.url) === i)
      const payload = {
        customerName: customerName.trim() || 'Customer',
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim(),
        vehicle: result.normalizedVehicle,
        estimateDraft: draft,
        operationLines: result.operationLines,
        notes: `Source links:\n${unique.map(item => `${item.provider}: ${item.title} ${item.url}`).join('\n')}`,
      }
      const fingerprint = JSON.stringify(payload)
      if (!estimateKey.current || estimateKey.current.fingerprint !== fingerprint) estimateKey.current = { fingerprint, key: `repair-estimate-${crypto.randomUUID()}` }
      const { res, body } = await postJson('/api/repair-estimate', payload, 30000, undefined, { 'Idempotency-Key': estimateKey.current.key })
      if (!res.ok || !body.ok) throw new Error(failText(res, body, 'The estimate was not created.'))
      const docNumber = String((body.data as { docNumber?: unknown } | undefined)?.docNumber || '')
      setCreated(docNumber || 'draft')
      estimateKey.current = null
      setEstimateSay({ kind: 'success', text: docNumber ? `Estimate ${docNumber} created as a draft.` : 'Estimate created as a draft.' })
    } catch (err) {
      setEstimateSay({ kind: 'error', text: `Not created. ${thenTryAgain(networkText(err, wasTimeout(err), 'Check your connection and try again.', 'The estimate took too long. Check Estimates before you try again, so you do not make two.'))}` })
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }, [result, draft, lockedTotal, pinned, customerName, customerEmail, customerPhone])

  /* ---------- shop procedure card ---------- */
  const saveProcedure = useCallback(async (status: 'draft' | 'verified') => {
    if (!result || savingRef.current) return
    savingRef.current = true
    setSaving(true); setProcedureSay(null)
    try {
      const { res, body } = await postJson('/api/repair-procedures', {
        title: `${vehicleLabel(result.normalizedVehicle)} - ${result.draft.operation}`,
        operation: result.draft.operation,
        status,
        confidence: status === 'verified' ? 'shop_verified' : 'source_linked',
        vehicle: result.normalizedVehicle,
        systems: result.safetyProfile.systems,
        tools: splitList(tools),
        partsFluids: splitList(partsFluids),
        safetyGates: result.safetyProfile.gates,
        operationLines: result.operationLines,
        sourceLinks: [...pinned, ...result.sources.slice(0, 8), ...result.manualMatches.slice(0, 8)],
        technicianNotes: notes,
        approvedBy,
      }, 30000)
      if (!res.ok || !body.ok) throw new Error(failText(res, body, 'The procedure was not saved.'))
      const data = (body.data || {}) as { migrationRequired?: boolean; message?: string }
      if (data.migrationRequired) setProcedureSay({ kind: 'warn', text: `Not saved. ${data.message || 'Procedure cards are not set up for this shop yet.'} Ask whoever manages your Alpha account to finish the repair workspace setup.` })
      else setProcedureSay({ kind: 'success', text: status === 'verified' ? 'Verified procedure saved.' : 'Draft procedure saved.' })
    } catch (err) {
      setProcedureSay({ kind: 'error', text: `Not saved. ${thenTryAgain(networkText(err, wasTimeout(err), 'Check your connection and try again.', 'Saving took too long. Try again.'))}` })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [result, pinned, tools, partsFluids, notes, approvedBy])

  return {
    // search
    query, setQuery, vehicle, setVehicle, result, searched, loading, error, searchId, search, retrySearch,
    repairView, simpleAnswer,
    say, setSay,
    // manual
    manualPage, manualLoading, manualError, manualUrl, readerOpen, loadManual, retryManual, openReader, closeReader,
    // keeping things
    pinned, togglePin, viewer, setViewer, bookmarks, toggleBookmark, savedDrafts, saveDraft, removeDraft, copySources,
    sendToAlpha, openRepairAi,
    // estimate
    customerName, setCustomerName, customerEmail, setCustomerEmail, customerPhone, setCustomerPhone, lockedTotal, setLockedTotal,
    total, draft, creating, estimateSay, created, customers, pickCustomer, createEstimate,
    // procedure
    tools, setTools, partsFluids, setPartsFluids, notes, setNotes, approvedBy, setApprovedBy, saving, procedureSay, setProcedureSay, saveProcedure,
  }
}

export type Repair = ReturnType<typeof useRepair>
