'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { getShopId, supabase } from '@/lib/supabase'
import { MAX_CLIPS_PER_ITEM, MAX_INROW_PER_ITEM, MAX_NAME, MAX_PHOTOS_PER_ITEM, MAX_PHOTOS_TOTAL, MAX_STORED_TOTAL, counts, digestOf, emailParts, findings, inRowPhotos, isStorageRef, newItem, overallOf, sectionCounts, smsText, summaryWords } from '@/lib/dvi'
import type { DviItem, DviSection } from '@/lib/dvi'
import { measureText, wearPlan, wearWords } from '@/lib/dvi-measure'
import { compareVisits, visitFromSections } from '@/lib/dvi-history'
import { missingSchema } from '@/lib/schema-missing'
import { normName } from '@/lib/shopboard'
import { dayKey, fmtTimeOfDay } from '@/lib/timeclock'
import { phonePretty } from '@/lib/today'
import Answers from './Answers'
import HistoryPanel from './HistoryPanel'
import ItemRow from './ItemRow'
import type { RowTools } from './ItemRow'
import Report from './Report'
import SendSheet from './SendSheet'
import type { SendChannel } from './SendSheet'
import type { StartCustomer } from './StartSheet'
import { postApi } from './api'
import { photoBlobFromFile, photoFromFile } from './photo'
import { useCanned } from './useCanned'
import { loadAnswers } from './useDvi'
import { useHistory } from './useHistory'
import { useMedia } from './useMedia'
import type { Stored } from './useMedia'
import type { DviRow, StartJob } from './types'

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
type Note = { kind: 'success' | 'warn' | 'error'; text: string } | null
const MAX_BYTES = 3_500_000

const lampOf = (r: 'red' | 'yellow' | 'green') => (r === 'red' ? 'lamp-red' : r === 'yellow' ? 'lamp-amber' : 'lamp-green')

/** The checklist itself: phone first, saves as you go. */
export default function Editor({ initial, migrated, techs, jobs, customers, shop, logo, todayKey, onBack, onDeleted }: {
  initial: DviRow
  migrated: boolean
  techs: string[]
  jobs: StartJob[]
  customers: StartCustomer[]
  shop: { name: string; phone: string; address: string }
  logo: string | null
  todayKey: string
  onBack: () => void
  onDeleted: () => void
}) {
  const [row, setRowState] = useState<DviRow>(initial)
  const rowRef = useRef<DviRow>(initial)
  const [save, setSave] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState('')
  const dirty = useRef(false)
  const saving = useRef(false)
  const digestOk = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [openSecs, setOpenSecs] = useState<Record<number, boolean>>(() => {
    const first = initial.sections.findIndex(s => s.items.some(i => !i.status))
    return { [first < 0 ? 0 : first]: true }
  })
  const [view, setView] = useState<'edit' | 'report'>('edit')
  const [reportPhotos, setReportPhotos] = useState(true)
  const [reportSince, setReportSince] = useState(false)
  const [sheet, setSheet] = useState<null | 'send' | 'delete'>(null)
  const [note, setNote] = useState<Note>(null)
  const [sendBusy, setSendBusy] = useState(false)
  const [sendError, setSendError] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')
  const [adding, setAdding] = useState<Record<number, string>>({})

  /* ---------- saving ---------- */

  const persist = useCallback(async (r: DviRow): Promise<string> => {
    try {
      const shopId = await getShopId()
      if (!shopId) return 'We could not find your shop. Refresh, or sign out and back in.'
      if (JSON.stringify(r.sections).length > MAX_BYTES) return 'This inspection is too big to save. Remove a few photos.'
      const c = counts(r.sections)
      const payload: Record<string, unknown> = {
        job_id: r.job_id, customer_name: r.customer_name, vehicle: r.vehicle, tech: r.tech, sections: r.sections,
        overall_status: overallOf(r.sections), tech_notes: r.tech_notes, updated_at: new Date().toISOString(),
        ...(migrated ? { customer_id: r.customer_id, summary: c } : {}),
      }
      // The short copy that "what changed since the last visit" reads. If its column is not there yet, saving carries on without it.
      const write = (withDigest: boolean) => supabase.from('dvi').update(withDigest ? { ...payload, digest: digestOf(r.sections) } : payload).eq('id', r.id).eq('shop_id', shopId).select('id')
      let { data, error } = await write(digestOk.current)
      if (error && digestOk.current && missingSchema(error)) { digestOk.current = false; ({ data, error } = await write(false)) }
      if (error) return 'That did not save. Check your connection and try again.'
      if (!data || data.length === 0) return 'This inspection could not be found. It may have been deleted.'
      return ''
    } catch {
      return 'That did not save. Check your connection and try again.'
    }
  }, [migrated])

  /** Saves what is waiting. Resolves true when everything is saved. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    while (saving.current) await new Promise(r => setTimeout(r, 80))
    if (!dirty.current) return true
    saving.current = true; dirty.current = false; setSave('saving')
    const err = await persist(rowRef.current)
    saving.current = false
    if (err) { dirty.current = true; setSave('error'); setSaveError(err); return false }
    setSaveError('')
    if (dirty.current) return flush()
    setSave('saved')
    return true
  }, [persist])

  const update = useCallback((fn: (r: DviRow) => DviRow) => {
    rowRef.current = fn(rowRef.current)
    setRowState(rowRef.current)
    dirty.current = true
    setSave(s => (s === 'saving' ? s : 'dirty'))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 1200)
  }, [flush])

  // Leaving the page or the tab never loses work.
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') void flush() }
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current || saving.current) { e.preventDefault(); e.returnValue = '' } }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('beforeunload', warn)
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('beforeunload', warn); void flush() }
  }, [flush])

  // While it is out with the customer, notice an answer without reloading the photos.
  useEffect(() => {
    if (!migrated || !row.sent_to_customer) return
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      const a = await loadAnswers(rowRef.current.id)
      if (!a) return
      rowRef.current = { ...rowRef.current, ...a }
      setRowState(rowRef.current)
    }, 30_000)
    return () => clearInterval(t)
  }, [migrated, row.sent_to_customer])

  /* ---------- editing ---------- */

  const patchItem = (si: number, id: string, patch: Partial<DviItem>) =>
    update(r => ({ ...r, sections: r.sections.map((s, i) => (i !== si ? s : { ...s, items: s.items.map(it => (it.id === id ? { ...it, ...patch } : it)) })) }))

  const c = useMemo(() => counts(row.sections), [row.sections])
  const list = useMemo(() => findings(row.sections), [row.sections])

  /* ---------- pictures, video and voice notes ---------- */

  const allRefs = useMemo(() => row.sections.flatMap(s => s.items.flatMap(i => [...i.photos, ...(i.clips ?? []).map(k => k.ref)])), [row.sections])
  const media = useMedia(row.id, allRefs)
  const canned = useCanned()
  const history = useHistory({ id: row.id, jobId: row.job_id, customerId: row.customer_id, customerName: row.customer_name, vehicle: row.vehicle, createdAt: row.created_at })

  const itemAt = (si: number, id: string): DviItem | undefined => rowRef.current.sections[si]?.items.find(it => it.id === id)
  const changeItem = (si: number, id: string, fn: (it: DviItem) => DviItem) =>
    update(r => ({ ...r, sections: r.sections.map((s, i) => (i !== si ? s : { ...s, items: s.items.map(it => (it.id === id ? fn(it) : it)) })) }))

  /** A photo goes to storage when storage is set up, and stays inside the inspection when it is not (or the upload fails). */
  const addPhoto = async (si: number, id: string, file: File) => {
    const item = itemAt(si, id)
    if (!item) return
    if (item.photos.length >= MAX_PHOTOS_PER_ITEM) throw new Error(`One line holds up to ${MAX_PHOTOS_PER_ITEM} photos.`)
    if (counts(rowRef.current.sections).photos >= MAX_STORED_TOTAL) throw new Error(`An inspection holds up to ${MAX_STORED_TOTAL} photos. Remove one to add another.`)
    let ref: string | null = null
    let failure = ''
    if (media.storage !== 'no') {
      const blob = await photoBlobFromFile(file)
      const stored: Stored = await media.store(blob, 'image/jpeg')
      if (stored.ok) ref = stored.ref
      else if (stored.reason === 'failed') failure = stored.error
    }
    if (!ref) {
      const inRow = item.photos.filter(p => p.startsWith('data:')).length
      if (inRowPhotos(rowRef.current.sections) >= MAX_PHOTOS_TOTAL || inRow >= MAX_INROW_PER_ITEM) {
        throw new Error(failure || `Photos saved inside the inspection are limited to ${MAX_PHOTOS_TOTAL} in all and ${MAX_INROW_PER_ITEM} per line.`)
      }
      ref = await photoFromFile(file)
    }
    const added = ref
    changeItem(si, id, it => (it.photos.length >= MAX_PHOTOS_PER_ITEM ? it : { ...it, photos: [...it.photos, added] }))
  }

  /** A marked-up photo replaces the one it came from. The original file stays in storage; it is never deleted automatically. */
  const replacePhoto = async (si: number, id: string, index: number, blob: Blob) => {
    const old = itemAt(si, id)?.photos[index]
    if (old === undefined) return
    let next: string | null = null
    if (media.storage !== 'no') {
      const stored = await media.store(blob, 'image/jpeg')
      if (stored.ok) next = stored.ref
      else if (stored.reason === 'failed' && isStorageRef(old)) throw new Error(stored.error)
    }
    if (!next) next = await photoFromFile(new File([blob], 'markup.jpg', { type: 'image/jpeg' }))
    const photo = next
    changeItem(si, id, it => (it.photos[index] === old ? { ...it, photos: it.photos.map((p, j) => (j === index ? photo : p)) } : it))
  }

  const addClip = async (si: number, id: string, kind: 'video' | 'audio', blob: Blob, secs: number) => {
    const item = itemAt(si, id)
    if (!item) return
    if ((item.clips ?? []).length >= MAX_CLIPS_PER_ITEM) throw new Error(`One line holds up to ${MAX_CLIPS_PER_ITEM} recordings.`)
    const stored = await media.store(blob, blob.type || (kind === 'video' ? 'video/webm' : 'audio/webm'))
    if (!stored.ok) throw new Error(stored.reason === 'no_storage' ? 'Video and voice notes need a database update before they can be saved. Ask the person who set up Alpha Desk, or use photos for now.' : stored.error)
    const ref = stored.ref
    changeItem(si, id, it => ((it.clips ?? []).length >= MAX_CLIPS_PER_ITEM ? it : { ...it, clips: [...(it.clips ?? []), { ref, kind, secs: Math.max(0, Math.min(60, Math.round(secs))) }] }))
  }

  const photoRoom = (item: DviItem): boolean => {
    if (media.storage === 'no') return c.photos < MAX_PHOTOS_TOTAL && item.photos.filter(p => p.startsWith('data:')).length < MAX_INROW_PER_ITEM
    return c.photos < MAX_STORED_TOTAL
  }

  /** The same line on the last visit: the reading, and how fast it is wearing. */
  const before = (item: DviItem): { text: string; wear: string } | null => {
    if (history.status !== 'ready') return null
    const want = normName(item.name)
    const prior = history.priors.find(v => v.items.some(d => d.m && normName(d.n) === want))
    const was = prior?.items.find(d => d.m && normName(d.n) === want)?.m
    if (!prior || !was) return null
    const date = new Date(prior.at)
    const when = Number.isNaN(date.getTime()) ? '' : ` (${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
    const now = item.measure && item.measure.kind === was.kind ? item.measure : null
    const wear = now ? wearWords(was.kind, wearPlan(was.kind, { value: was.value, miles: prior.miles }, { value: now.value, miles: history.miles })) : ''
    return { text: `${measureText(was)}${when}`, wear }
  }

  const toolsFor = (si: number, it: DviItem): RowTools => ({
    photoRoom,
    urlFor: media.urlFor,
    clipsOk: media.storage !== 'no',
    canned,
    before,
    addPhoto: f => addPhoto(si, it.id, f),
    addClip: (kind, blob, secs) => addClip(si, it.id, kind, blob, secs),
    replacePhoto: (index, blob) => replacePhoto(si, it.id, index, blob),
  })

  const markGood = (si: number) =>
    update(r => ({ ...r, sections: r.sections.map((s, i) => (i !== si ? s : { ...s, items: s.items.map(it => (it.status ? it : { ...it, status: 'green' as const })) })) }))

  const addItem = (si: number) => {
    const name = (adding[si] || '').trim()
    if (!name) return
    update(r => ({ ...r, sections: r.sections.map((s, i) => (i !== si ? s : { ...s, items: [...s.items, newItem(name)] })) }))
    setAdding(a => ({ ...a, [si]: '' }))
  }

  const removeItem = (si: number, id: string) =>
    update(r => ({ ...r, sections: r.sections.map((s, i) => (i !== si ? s : { ...s, items: s.items.filter(it => it.id !== id) })) }))

  /* ---------- who it is for ---------- */

  const customerRec = useMemo(() => {
    const byId = (id: string | null | undefined) => (id ? customers.find(x => x.id === id) || null : null)
    const direct = byId(row.customer_id) || byId(jobs.find(j => j.id === row.job_id)?.customer_id)
    if (direct) return direct
    const same = customers.filter(x => normName(x.name) === normName(row.customer_name))
    return same.length === 1 ? same[0] : null
  }, [customers, jobs, row.customer_id, row.job_id, row.customer_name])

  const setName = (name: string) => {
    const same = customers.filter(x => normName(x.name) === normName(name))
    update(r => ({ ...r, customer_name: name, customer_id: same.length === 1 ? same[0].id : null }))
  }

  const setJob = (id: string) => {
    const j = jobs.find(x => x.id === id)
    update(r => ({
      ...r, job_id: id || null,
      ...(j ? {
        customer_id: j.customer_id || r.customer_id,
        customer_name: r.customer_name || j.customer_name,
        vehicle: r.vehicle || [j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' '),
        tech: r.tech || (j.tech && normName(j.tech) !== 'unassigned' ? j.tech : ''),
      } : {}),
    }))
  }

  /* ---------- sending ---------- */

  const whenText = (iso: string | null): string => {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return dayKey(d) === todayKey ? `today at ${fmtTimeOfDay(iso)}` : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${fmtTimeOfDay(iso)}`
  }

  // One key for one attempt: a second tap on a slow connection can never send the same message twice.
  const sendKey = useRef('')

  const send = async (channel: SendChannel, to: string) => {
    setSendBusy(true); setSendError('')
    try {
      if (!(await flush())) { setSendError('Save the inspection first. It did not save yet.'); return }
      const share = await postApi('/api/inspection/share', { id: row.id })
      if (!share.ok) { setSendError(share.error || 'The link could not be made.'); return }
      const url = typeof share.data.url === 'string' && list.length > 0 ? share.data.url : null
      const s = (share.data.shop || {}) as { name?: string; phone?: string }
      const parts = { customer: row.customer_name, vehicle: row.vehicle, shop: s.name || shop.name, phone: s.phone || shop.phone, url, list, goodCount: c.green }
      const mail = channel === 'email' ? emailParts(parts) : null
      const sameRecipient = channel === 'sms'
        ? Boolean(customerRec?.phone) && (customerRec?.phone || '').replace(/\D/g, '').slice(-10) === to.replace(/\D/g, '').slice(-10)
        : Boolean(customerRec?.email) && (customerRec?.email || '').trim().toLowerCase() === to.trim().toLowerCase()
      if (!sendKey.current) sendKey.current = `dvi-${row.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const msg = await postApi('/api/send-message', {
        to, body: mail ? mail.body : smsText(parts), channel, ...(mail ? { subject: mail.subject } : {}),
        ...(sameRecipient && customerRec ? { customerId: customerRec.id } : {}), ...(row.job_id ? { jobId: row.job_id } : {}),
      }, { 'Idempotency-Key': sendKey.current })
      if (!msg.ok) { setSendError(msg.error || (channel === 'sms' ? 'The text was not sent.' : 'The email was not sent.')); return }
      sendKey.current = ''
      const at = new Date().toISOString()
      const shopId = await getShopId()
      let marked = true
      if (shopId) {
        const { error } = await supabase.from('dvi').update({ sent_to_customer: true, sent_at: at }).eq('id', row.id).eq('shop_id', shopId)
        marked = !error
      }
      rowRef.current = { ...rowRef.current, sent_to_customer: true, sent_at: at, has_link: url !== null || rowRef.current.has_link }
      setRowState(rowRef.current)
      setSheet(null)
      const how = channel === 'sms' ? 'Texted' : 'Emailed'
      setNote(marked
        ? { kind: 'success', text: `${how} to ${row.customer_name || 'the customer'} ${whenText(at)}.${url ? ' They can open their photos and answer from the link.' : ''}` }
        : { kind: 'warn', text: `The ${channel === 'sms' ? 'text' : 'email'} was sent, but the inspection could not be marked as sent. Do not send it again.` })
    } finally { setSendBusy(false) }
  }

  const copyLink = async () => {
    setLinkBusy(true); setNote(null)
    const r = await postApi('/api/inspection/share', { id: row.id })
    setLinkBusy(false)
    const url = typeof r.data.url === 'string' ? r.data.url : ''
    if (!r.ok || !url) { setNote({ kind: 'error', text: r.error || 'There is no link to copy yet.' }); return }
    try { await navigator.clipboard.writeText(url); setNote({ kind: 'success', text: 'Link copied.' }) } catch { setNote({ kind: 'warn', text: `Copy this link: ${url}` }) }
  }

  const stopLink = async () => {
    setLinkBusy(true); setNote(null)
    const r = await postApi('/api/inspection/share', { id: row.id, action: 'revoke' })
    setLinkBusy(false)
    if (!r.ok) { setNote({ kind: 'error', text: r.error || 'The link could not be turned off.' }); return }
    rowRef.current = { ...rowRef.current, has_link: false }
    setRowState(rowRef.current)
    setNote({ kind: 'success', text: 'The link is off. The old text no longer opens anything. Send the inspection again to make a new link.' })
  }

  const remove = async () => {
    setDelBusy(true); setDelError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('shop')
      dirty.current = false
      if (timer.current) clearTimeout(timer.current)
      const { data, error } = await supabase.from('dvi').delete().eq('id', row.id).eq('shop_id', shopId).select('id')
      if (error || !data || data.length === 0) throw new Error('delete')
      onDeleted()
    } catch {
      setDelError('That did not delete. Try again.')
    } finally { setDelBusy(false) }
  }

  const back = async () => {
    if (await flush()) onBack()
    else setNote({ kind: 'error', text: 'This did not save, so it was not closed. Try again.' })
  }

  /* ---------- views ---------- */

  const sentWhen = row.sent_at ? whenText(row.sent_at) : ''
  const vehicleLine = row.vehicle || 'No vehicle noted'
  const techOptions = row.tech && !techs.some(t => normName(t) === normName(row.tech)) ? [row.tech, ...techs] : techs
  const jobOptions = row.job_id && !jobs.some(j => j.id === row.job_id) ? [{ id: row.job_id, label: 'Linked job (closed)' }] : []
  const estimateHref = `/estimates?new=1${customerRec ? `&customer=${encodeURIComponent(customerRec.id)}` : ''}${row.job_id ? `&job=${encodeURIComponent(row.job_id)}` : ''}&dvi=${encodeURIComponent(row.id)}`
  const pct = c.total > 0 ? Math.round((c.rated / c.total) * 100) : 0

  if (view === 'report') {
    const prior = history.status === 'ready' ? history.priors[0] : undefined
    const lastDate = prior ? new Date(prior.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
    const since = reportSince && prior ? { changes: compareVisits(prior, visitFromSections({ id: row.id, at: row.created_at, tech: row.tech, sections: row.sections, miles: history.status === 'ready' ? history.miles : null })), lastDate } : null
    return (
      <div>
        <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => setView('edit')}><Icon name="chevronLeft" className="h-5 w-5" />Back to the checklist</button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="print" className="h-5 w-5" />Print or save as PDF</button>
        </div>
        <div className="no-print mb-4 flex flex-col gap-2 sm:flex-row sm:gap-6">
          <label className="flex min-h-[44px] items-center gap-2.5 text-[0.9375rem]"><input type="checkbox" className="h-5 w-5" checked={reportPhotos} onChange={e => setReportPhotos(e.target.checked)} />Include the photos</label>
          {prior && <label className="flex min-h-[44px] items-center gap-2.5 text-[0.9375rem]"><input type="checkbox" className="h-5 w-5" checked={reportSince} onChange={e => setReportSince(e.target.checked)} />Include what changed since the last visit</label>}
        </div>
        <div className="rounded-lg border border-border print:border-0">
          <Report
            shop={shop}
            logo={logo}
            customer={row.customer_name}
            vehicle={row.vehicle}
            tech={row.tech}
            date={new Date(row.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            note={row.tech_notes}
            sections={row.sections}
            urlFor={media.urlFor}
            showPhotos={reportPhotos}
            since={since}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="pb-4">
      <button type="button" className="btn btn-ghost -ml-3 mb-1" onClick={() => void back()}><Icon name="chevronLeft" className="h-5 w-5" />All inspections</button>

      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title break-words">{row.customer_name || 'Inspection'}</h1>
          <p className="page-subtitle">{vehicleLine}</p>
        </div>
        <div className="flex items-center gap-3 sm:justify-end">
          <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-[0.875rem] text-text-secondary">
            {save === 'saved' && <><Icon name="check" className="h-4 w-4 text-green" />Saved</>}
            {save === 'dirty' && 'Changes not saved yet'}
            {save === 'saving' && 'Saving…'}
            {save === 'error' && <span className="font-bold text-red">Not saved</span>}
          </p>
          {save === 'error' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void flush()}>Try again</button>}
        </div>
      </header>
      {save === 'error' && saveError && <p role="alert" className="mb-3 text-[0.9375rem] font-bold text-red">{saveError}</p>}

      {note && (
        <Notice kind={note.kind} className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 basis-56 break-words">{note.text}</span>
            <button type="button" className="btn btn-ghost btn-sm ml-auto shrink-0" onClick={() => setNote(null)}>Dismiss</button>
          </div>
        </Notice>
      )}

      {/* who and what */}
      <section className="panel" aria-label="Customer and vehicle">
        <div className="panel-body grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="dvi-name">Customer</label>
            <input id="dvi-name" className="form-input" value={row.customer_name} maxLength={MAX_NAME + 20} onChange={e => setName(e.target.value)} list="dvi-edit-customers" autoComplete="off" />
            <datalist id="dvi-edit-customers">{customers.slice(0, 300).map(x => <option key={x.id} value={x.name} />)}</datalist>
            <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-text-secondary">
              <span className={`lamp ${customerRec?.phone ? 'lamp-green' : 'lamp-amber'} !h-2.5 !w-2.5 shrink-0`} aria-hidden="true" />
              {customerRec ? (customerRec.phone ? `Texts go to ${phonePretty(customerRec.phone)}` : 'No phone number on file') : 'Not linked to a customer record'}
            </p>
          </div>
          <div>
            <label className="form-label" htmlFor="dvi-vehicle">Vehicle</label>
            <input id="dvi-vehicle" className="form-input" value={row.vehicle} onChange={e => update(r => ({ ...r, vehicle: e.target.value }))} placeholder="2018 Toyota Camry" />
          </div>
          <div>
            <label className="form-label" htmlFor="dvi-tech">Technician</label>
            <select id="dvi-tech" className="form-select" value={row.tech} onChange={e => update(r => ({ ...r, tech: e.target.value }))}>
              <option value="">Not chosen</option>
              {techOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="dvi-job">Job</label>
            <select id="dvi-job" className="form-select" value={row.job_id || ''} onChange={e => setJob(e.target.value)}>
              <option value="">Not on a job</option>
              {jobOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              {jobs.map(j => <option key={j.id} value={j.id}>{j.ro_number ? `${j.ro_number}: ` : ''}{j.customer_name}{[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).length ? `, ${[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ')}` : ''}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="form-label" htmlFor="dvi-notes">Note for the customer</label>
            <textarea id="dvi-notes" className="form-input" rows={2} maxLength={1000} value={row.tech_notes} onChange={e => update(r => ({ ...r, tech_notes: e.target.value }))} placeholder="Shown on the customer’s page and the printed report" />
          </div>
        </div>
      </section>

      <HistoryPanel state={history} sections={row.sections} id={row.id} createdAt={row.created_at} tech={row.tech} />

      {/* progress */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="num text-[0.9375rem] font-bold">{c.rated} of {c.total} checked</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenSecs(Object.keys(openSecs).length >= row.sections.length && row.sections.every((_, i) => openSecs[i]) ? {} : Object.fromEntries(row.sections.map((_, i) => [i, true])))}>
          {row.sections.every((_, i) => openSecs[i]) ? 'Close all sections' : 'Open all sections'}
        </button>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-bg-hover" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Checked so far">
        <div className="h-full rounded-full bg-blue transition-[width]" style={{ width: `${pct}%` }} />
      </div>

      {/* sections */}
      <div className="mt-4 space-y-3">
        {row.sections.map((s: DviSection, si) => {
          const sc = sectionCounts(s)
          const isOpen = !!openSecs[si]
          return (
            <section key={`${s.title}-${si}`} className="panel overflow-hidden" aria-label={s.title}>
              <button type="button" className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg-hover" aria-expanded={isOpen} onClick={() => setOpenSecs(o => ({ ...o, [si]: !o[si] }))}>
                <Icon name="chevronDown" className={`h-5 w-5 shrink-0 text-text-secondary transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold leading-tight">{s.title}</span>
                  <span className="num block text-[0.8125rem] text-text-secondary">{sc.rated} of {sc.total} checked{sc.red > 0 ? ` · ${sc.red} ${sc.red === 1 ? 'needs' : 'need'} work` : ''}{sc.yellow > 0 ? ` · ${sc.yellow} to watch` : ''}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
                  {(['red', 'yellow', 'green'] as const).map(k => sc[k] > 0 && <span key={k} className={`lamp ${lampOf(k)} !h-2.5 !w-2.5`} />)}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-border">
                  <div className="divide-y divide-border">
                    {s.items.map(it => (
                      <ItemRow
                        key={it.id}
                        item={it}
                        tools={toolsFor(si, it)}
                        onChange={patch => patchItem(si, it.id, patch)}
                        onRemove={it.custom ? () => removeItem(si, it.id) : undefined}
                      />
                    ))}
                  </div>
                  <div className="flex flex-col gap-2 border-t border-border bg-bg-base px-3 py-3 sm:flex-row sm:items-center">
                    <form className="flex min-w-0 flex-1 gap-2" onSubmit={e => { e.preventDefault(); addItem(si) }}>
                      <label className="sr-only" htmlFor={`add-${si}`}>Add a check to {s.title}</label>
                      <input id={`add-${si}`} className="form-input" maxLength={MAX_NAME} value={adding[si] || ''} onChange={e => setAdding(a => ({ ...a, [si]: e.target.value }))} placeholder="Add a check, like Windshield chip" />
                      <button type="submit" className="btn btn-secondary shrink-0" disabled={!(adding[si] || '').trim()}><Icon name="plus" className="h-5 w-5" />Add</button>
                    </form>
                    {sc.rated < sc.total && <button type="button" className="btn btn-secondary" onClick={() => markGood(si)}><Icon name="check" className="h-5 w-5" />Mark the rest good</button>}
                  </div>
                </div>
              )}
            </section>
          )
        })}
      </div>

      {row.sent_to_customer && (
        <Answers
          row={row}
          list={list}
          linkAvailable={migrated}
          estimateHref={estimateHref}
          busy={linkBusy}
          onCopy={() => void copyLink()}
          onStop={() => void stopLink()}
          whenText={whenText}
        />
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={async () => { if (await flush()) setView('report') }} disabled={c.rated === 0}><Icon name="print" className="h-5 w-5" />Print report</button>
        <button type="button" className="btn btn-danger" onClick={() => { setDelError(''); setSheet('delete') }}><Icon name="trash" className="h-5 w-5" />Delete inspection</button>
      </div>

      {/* bottom bar */}
      <div className="no-print sticky bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-30 -mx-4 mt-6 border-t border-border bg-bg-chrome px-4 py-2.5 sm:-mx-6 sm:px-6 lg:bottom-0 lg:-mx-8 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-[0.875rem] font-bold leading-tight sm:text-[0.9375rem]" aria-live="polite">
            {c.rated === 0 ? 'Nothing checked yet' : <><span className={`lamp ${lampOf(c.red > 0 ? 'red' : c.yellow > 0 ? 'yellow' : 'green')} mr-2 align-middle`} aria-hidden="true" />{summaryWords(c)}{c.green > 0 && (c.red > 0 || c.yellow > 0) ? `, ${c.green} good` : ''}</>}
          </p>
          <button type="button" className="btn btn-primary shrink-0" disabled={c.rated === 0} onClick={() => { setSendError(''); setSheet('send') }}>
            <Icon name="send" className="h-5 w-5" />{row.sent_to_customer ? 'Send again' : 'Send to customer'}
          </button>
        </div>
      </div>

      <Sheet open={sheet === 'send'} onClose={() => { if (!sendBusy) setSheet(null) }} title="Send to the customer">
        <SendSheet
          row={row}
          list={list}
          goodCount={c.green}
          shop={shop}
          phone={customerRec?.phone || ''}
          email={customerRec?.email || ''}
          customerKnown={!!customerRec}
          linkAvailable={migrated}
          sentWhen={sentWhen}
          busy={sendBusy}
          error={sendError}
          onSend={(channel, to) => void send(channel, to)}
        />
      </Sheet>

      <Sheet open={sheet === 'delete'} onClose={() => { if (!delBusy) setSheet(null) }} title="Delete this inspection?">
        <p className="text-[0.9375rem]">The checklist, photos and any answers from the customer are removed for good. Their link stops working.</p>
        {delError && <p role="alert" className="form-error">{delError}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-secondary" disabled={delBusy} onClick={() => setSheet(null)}>Keep it</button>
          <button type="button" className="btn btn-danger" disabled={delBusy} onClick={() => void remove()}>{delBusy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </Sheet>

    </div>
  )
}
