'use client'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { getShopId, supabase, markMessageRead } from '@/lib/supabase'
import { phonePretty } from '@/lib/today'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import Segmented from '@/components/inbox/Segmented'
import ConversationList from '@/components/inbox/ConversationList'
import ThreadView from '@/components/inbox/ThreadView'
import type { ThreadExtras } from '@/components/inbox/ThreadView'
import { useTemplates } from '@/components/inbox/ThreadTools'
import { useAiOverlay } from '@/components/inbox/useAiOverlay'
import { useInboxAlerts } from '@/components/inbox/useAlerts'
import CallsView from '@/components/inbox/CallsView'
import CallDetail from '@/components/inbox/CallDetail'
import NewMessageSheet from '@/components/inbox/NewMessageSheet'
import DialSheet from '@/components/inbox/DialSheet'
import { useKeyboardInset, useMediaQuery } from '@/components/inbox/hooks'
import { callKind, contactKey, dialNumber, digitsOnly, otherNumber, recordingUrl } from '@/components/inbox/utils'
import type { CallRecord, ContactRef, Message, Thread } from '@/components/inbox/utils'

async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) headers.Authorization = 'Bearer ' + data.session.access_token
  } catch {}
  return headers
}

const DAY = 86_400_000
const isUnread = (m: Message) => m.direction === 'inbound' && m.read === false

type Row = Record<string, unknown>
interface Contact extends ContactRef { vehicle: string }

function InboxSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-10 pt-5 sm:px-6 lg:px-8 lg:pt-8" aria-busy="true" aria-label="Loading your inbox">
      <div className="skeleton h-9 w-32" />
      <div className="skeleton mt-3 h-4 w-56" />
      <div className="skeleton mt-5 h-12 w-full max-w-md" />
      <div className="mt-5 space-y-2">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-[4.5rem]" />)}</div>
    </div>
  )
}

export default function InboxPage() {
  return (
    <Suspense fallback={<InboxSkeleton />}>
      <InboxScreen />
    </Suspense>
  )
}

function InboxScreen() {
  const params = useSearchParams()
  const tab: 'messages' | 'calls' = params.get('tab') === 'calls' ? 'calls' : 'messages'
  const threadParam = params.get('thread')
  const selectedKey = threadParam ? contactKey(threadParam) : null

  const [shopPhone, setShopPhone] = useState('')
  const [shopName, setShopName] = useState('')
  const overlay = useAiOverlay()
  const reloadOverlay = overlay.reload
  const tpl = useTemplates()
  const shopPhoneRef = useRef('')
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [messagesError, setMessagesError] = useState(false)
  const [callsError, setCallsError] = useState(false)
  const [msgSearch, setMsgSearch] = useState('')
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null)
  const [compose, setCompose] = useState<{ to: string; channel: 'sms' | 'email' } | null>(null)
  const [dialOpen, setDialOpen] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [audioError, setAudioError] = useState('')
  const [notice, setNotice] = useState('')
  const [newCallFlash, setNewCallFlash] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pushedRef = useRef(false)
  const markedRef = useRef(new Set<string>())
  const handledLink = useRef('')

  const isDesktop = useMediaQuery('(min-width: 1024px)')

  // ---------- Data ----------
  const loadCalls = useCallback(async () => {
    try {
      const shopId = await getShopId()
      if (!shopId) { setCalls([]); setCallsError(true); return }
      const [hist, ai] = await Promise.all([
        supabase.from('call_history')
          .select('id, call_id, direction, from_number, to_number, duration_secs, status, start_time, end_time, matched_customer_name, transcript, lead_score, lead_reasoning, service_needed, caller_sentiment, key_quotes, call_count_from_number, raw_data')
          .eq('shop_id', shopId).order('start_time', { ascending: false }).limit(1500),
        supabase.from('ai_calls')
          .select('id, task, status, started_at, transcript, summary, recording_url')
          .eq('shop_id', shopId).order('started_at', { ascending: false }).limit(200),
      ])
      if (hist.error) throw hist.error

      const aiAsRecords: CallRecord[] = ((ai.data || []) as Row[]).map(a => {
        const task = String(a.task || '')
        const isInbound = task.includes('Inbound call from')
        const fromMatch = task.match(/Inbound call from ([+\d]+)/)
        const raw = a.started_at
        const tsNum = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(String(raw || ''))
        const ts = new Date(tsNum)
        const tr = a.transcript
        const txText = Array.isArray(tr)
          ? tr.map((t: Row) => `${t.speaker === 'ai' ? 'AI' : 'Caller'}: ${t.text}`).join('\n')
          : (typeof tr === 'string' ? tr : null)
        return {
          id: `ai-${a.id}`, call_id: `ai-${a.id}`,
          direction: isInbound ? 'inbound' : 'outbound',
          from_number: isInbound ? (fromMatch?.[1] || '') : shopPhoneRef.current,
          to_number: isInbound ? shopPhoneRef.current : '',
          duration_secs: 0, status: String(a.status || ''),
          start_time: isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString(),
          end_time: '', matched_customer_name: null, transcript: txText,
          lead_score: null, lead_reasoning: (a.summary as string) || null, service_needed: null,
          caller_sentiment: null, key_quotes: null, call_count_from_number: null,
          raw_data: { ai_call: a }, viaAi: true,
        } as CallRecord
      })

      const historyIds = new Set(((hist.data || []) as Row[]).map(c => c.call_id))
      const newAi = aiAsRecords.filter(a => !historyIds.has(a.call_id))
      const merged = [...((hist.data || []) as CallRecord[]), ...newAi]
        .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
      setCalls(merged)
      setCallsError(false)
    } catch {
      setCallsError(true)
    }
  }, [])

  const loadMessages = useCallback(async () => {
    try {
      const shopId = await getShopId()
      if (!shopId) { setMessages([]); setMessagesError(true); return }
      const { data, error } = await supabase
        .from('messages')
        .select('*, customer:customers(name, phone, email)')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      setMessages((data || []) as unknown as Message[])
      setMessagesError(false)
    } catch {
      // Keep what is on screen: a failed refresh must not look like "no texts".
      setMessagesError(true)
    }
  }, [])

  const loadContacts = useCallback(async () => {
    try {
      const shopId = await getShopId()
      if (!shopId) { setContacts([]); return }
      const { data } = await supabase.from('customers').select('id, name, phone, email, vehicle_year, vehicle_make, vehicle_model').eq('shop_id', shopId).limit(1000)
      if (data) {
        setContacts((data as Row[]).map(c => ({
          id: String(c.id), name: String(c.name || ''), phone: String(c.phone || ''), email: String(c.email || ''),
          vehicle: [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' '),
        })))
      }
    } catch { /* names fall back to phone numbers */ }
  }, [])

  const retry = useCallback(() => { loadCalls(); loadMessages() }, [loadCalls, loadMessages])

  useEffect(() => {
    let disposed = false
    setLoading(true)
    const loadShopPhone = async () => {
      const shopId = await getShopId()
      if (!shopId) return
      const { data } = await supabase.from('settings').select('shop_phone, shop_name').eq('shop_id', shopId).limit(1).maybeSingle()
      if (!disposed && data?.shop_name) setShopName(String(data.shop_name))
      if (!disposed && data?.shop_phone) {
        const p = data.shop_phone.startsWith('+') ? data.shop_phone : '+1' + data.shop_phone.replace(/\D/g, '')
        shopPhoneRef.current = p
        setShopPhone(p)
      }
    }
    loadShopPhone().catch(() => {})
    Promise.all([loadCalls(), loadMessages(), loadContacts()]).finally(() => { if (!disposed) setLoading(false) })

    // Background sync: pull the latest Telnyx recordings into call_history (fire and forget).
    const syncRecordings = async () => {
      try {
        const response = await fetch('/api/telnyx/sync-calls?action=sync-recordings', { method: 'POST', headers: await getAuthJsonHeaders() })
        if (response.ok) setTimeout(loadCalls, 5000)
      } catch {}
    }
    syncRecordings()

    // Poll every 10 seconds as a safety net.
    pollRef.current = setInterval(() => { loadCalls(); loadMessages() }, 10000)

    // Realtime: new inbound calls appear here instantly.
    const aiCallChannel = supabase
      .channel('live_ai_calls')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_calls' }, (payload) => {
        loadCalls()
        if (payload.eventType === 'INSERT') {
          setNewCallFlash(true)
          if (flashTimer.current) clearTimeout(flashTimer.current)
          flashTimer.current = setTimeout(() => setNewCallFlash(false), 5000)
        }
      })
      .subscribe()
    const histChannel = supabase
      .channel('live_call_history')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_history' }, () => { loadCalls() })
      .subscribe()
    const msgChannel = supabase
      .channel('live_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => { loadMessages() })
      .subscribe()

    return () => {
      disposed = true
      if (pollRef.current) clearInterval(pollRef.current)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      supabase.removeChannel(aiCallChannel)
      supabase.removeChannel(histChannel)
      supabase.removeChannel(msgChannel)
    }
  }, [loadCalls, loadMessages, loadContacts])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(t)
  }, [notice])

  // ---------- Who is who ----------
  const byPhone = useMemo(() => {
    const m = new Map<string, Contact>()
    contacts.forEach(c => { const k = contactKey(c.phone); if (k && digitsOnly(c.phone).length >= 7 && !m.has(k)) m.set(k, c) })
    return m
  }, [contacts])
  const byId = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts])

  const threads: Thread[] = useMemo(() => {
    const map = new Map<string, Message[]>()
    messages.forEach(m => {
      // Rows from before the channel column existed are texts.
      if ((m.channel || 'sms') !== 'sms') return
      const contact = m.direction === 'inbound' ? m.from_address : m.to_address
      const key = contactKey(contact)
      if (!key) return
      const list = map.get(key)
      if (list) list.push(m); else map.set(key, [m])
    })
    const out: Thread[] = []
    map.forEach((msgs, key) => {
      msgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const last = msgs[msgs.length - 1]
      const contact = last.direction === 'inbound' ? last.from_address : last.to_address
      const linked = [...msgs].reverse().find(m => m.customer?.name || m.customer_id)
      const person = (linked?.customer_id && byId.get(linked.customer_id)) || byPhone.get(key) || null
      const name = linked?.customer?.name || person?.name || ''
      out.push({
        key, contact, name: name || phonePretty(contact), messages: msgs,
        customerId: (linked?.customer_id as string | null) || person?.id || null,
        unread: msgs.filter(isUnread).length, last,
      })
    })
    return out.sort((a, b) => new Date(b.last.created_at).getTime() - new Date(a.last.created_at).getTime())
  }, [messages, byId, byPhone])

  const unreadTotal = useMemo(() => threads.reduce((s, t) => s + t.unread, 0), [threads])
  const alertName = useCallback((m: { from_address: string }) => byPhone.get(contactKey(m.from_address))?.name || phonePretty(m.from_address), [byPhone])
  const alerts = useInboxAlerts(messages, !loading, alertName, unreadTotal)
  const needsKeys = useMemo(() => new Set(overlay.needsPerson.keys()), [overlay.needsPerson])
  const draftKeys = useMemo(() => new Set(overlay.items.filter(i => i.channel === 'sms' && i.draft).map(i => i.contact_key)), [overlay.items])
  const assistantBadge = needsKeys.size + draftKeys.size
  const missedRecent = useMemo(() => {
    const since = Date.now() - 3 * DAY
    return calls.filter(c => new Date(c.start_time).getTime() >= since && callKind(c.direction, c.status, c.duration_secs, c.viaAi) === 'missed').length
  }, [calls])

  const filteredThreads = useMemo(() => {
    const q = msgSearch.trim().toLowerCase()
    if (!q) return threads
    const qd = q.replace(/\D/g, '')
    return threads.filter(t =>
      t.name.toLowerCase().includes(q)
      || (qd.length >= 3 && t.key.includes(qd))
      || t.messages.some(m => (m.body || '').toLowerCase().includes(q)))
  }, [threads, msgSearch])

  const selected: Thread | null = useMemo(() => {
    if (!selectedKey) return null
    const hit = threads.find(t => t.key === selectedKey)
    if (hit) return hit
    // A number we have never texted (for example from a customer's page): an empty conversation.
    const person = byPhone.get(selectedKey) || null
    const contact = person?.phone || threadParam || selectedKey
    const blank = { id: 'blank', direction: 'outbound', channel: 'sms', from_address: '', to_address: contact, body: '', status: '', read: true, created_at: new Date().toISOString() } as Message
    return { key: selectedKey, contact, name: person?.name || phonePretty(contact), customerId: person?.id || null, messages: [], unread: 0, last: blank }
  }, [selectedKey, threads, byPhone, threadParam])

  // Opening a conversation marks its incoming texts as read.
  useEffect(() => {
    if (!selected) return
    const ids = selected.messages.filter(isUnread).map(m => m.id).filter(id => !markedRef.current.has(id))
    if (ids.length === 0) return
    ids.forEach(id => markedRef.current.add(id))
    setMessages(prev => prev.map(m => (ids.includes(m.id) ? { ...m, read: true } : m)))
    Promise.all(ids.map(id => markMessageRead(id))).then(results => {
      results.forEach((r, i) => { if (r.error) markedRef.current.delete(ids[i]) })
    })
  }, [selected])

  // ---------- Navigation (the URL is the source of truth, so Back works) ----------
  const openThread = useCallback((key: string) => {
    const url = `/messages?thread=${encodeURIComponent(key)}`
    if (threadParam) window.history.replaceState(null, '', url)
    else { window.history.pushState(null, '', url); pushedRef.current = true }
  }, [threadParam])

  const closeThread = useCallback(() => {
    if (pushedRef.current) { pushedRef.current = false; window.history.back() }
    else window.history.replaceState(null, '', '/messages')
  }, [])

  const setTab = (t: 'messages' | 'calls') => {
    pushedRef.current = false
    window.history.replaceState(null, '', t === 'calls' ? '/messages?tab=calls' : '/messages')
  }

  // Links from other screens: ?thread=<number> opens a conversation, ?new=1&to=<number> starts a message.
  const newParam = params.get('new')
  const toParam = params.get('to')
  useEffect(() => {
    if (loading || newParam !== '1') return
    const key = 'new|' + (toParam || '')
    if (handledLink.current === key) return
    handledLink.current = key
    setCompose({ to: toParam || '', channel: 'sms' })
  }, [loading, newParam, toParam])

  // ---------- Actions ----------
  const sendMessage = useCallback(async (to: string, body: string, channel: 'sms' | 'email', mediaIds?: string[]): Promise<string | null> => {
    try {
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ to, body, channel, ...(mediaIds && mediaIds.length ? { mediaIds } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'Message could not be sent')
      await loadMessages()
      reloadOverlay()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Message could not be sent'
    }
  }, [loadMessages, reloadOverlay])

  const closeCompose = useCallback(() => setCompose(null), [])
  const closeDial = useCallback(() => setDialOpen(false), [])
  const closeCall = useCallback(() => setSelectedCall(null), [])

  const callName = useCallback((c: CallRecord) => c.matched_customer_name || byPhone.get(contactKey(otherNumber(c)))?.name || '', [byPhone])

  const togglePlay = (call: CallRecord) => {
    const url = recordingUrl(call)
    const el = audioRef.current
    if (!url || !el) return
    if (playingId === call.id) { el.pause(); setPlayingId(null); return }
    setAudioError('')
    el.src = url
    el.play().then(() => setPlayingId(call.id)).catch(() => { setPlayingId(null); setAudioError('That recording could not be played. It may have expired, or your connection dropped.') })
  }

  const openCall = (c: CallRecord) => {
    audioRef.current?.pause()
    setPlayingId(null)
    setSelectedCall(c)
    const made = overlay.byCall.get(c.id)
    if (made && !made.seen_at) void overlay.markSeen([made.id])
  }

  const kbInset = useKeyboardInset(!!selected && !isDesktop && tab === 'messages')

  // ---------- Render ----------
  if (loading && messages.length === 0 && calls.length === 0 && !messagesError && !callsError) return <InboxSkeleton />

  const showLayer = !!selected && !isDesktop && tab === 'messages'
  const selectedContact = selected?.customerId ? byId.get(selected.customerId) : (selected ? byPhone.get(selected.key) : undefined)
  const selectedCallPerson = selectedCall ? byPhone.get(contactKey(otherNumber(selectedCall))) : undefined

  const held = selected ? overlay.byThread.get(selected.key) : undefined
  const extras: ThreadExtras | undefined = selected ? {
    draft: held?.draft ? { interactionId: held.id, text: held.draft.text, at: held.draft.at } : null,
    assignee: overlay.assigneeOf.get(selected.key),
    team: overlay.team,
    assignAvailable: overlay.assignAvailable,
    templates: tpl.items,
    templatesStatus: tpl.status,
    reloadTemplates: tpl.reload,
    onChanged: overlay.reload,
    shopName,
    shopPhone,
    canEdit: true,
  } : undefined

  const threadPane = selected && (
    <ThreadView
      key={selected.key}
      thread={selected}
      showBack={!isDesktop}
      onBack={closeThread}
      onSend={(body, ids) => sendMessage(selected.contact, body, 'sms', ids)}
      keyboardInset={kbInset}
      vehicle={selectedContact?.vehicle}
      extras={extras}
    />
  )

  const listError = (what: string) => (
    <div role="alert" className="card max-w-xl">
      <h2 className="section-title">{what} did not load</h2>
      <p className="mt-1 text-text-secondary">Check your connection and try again.</p>
      <button className="btn btn-primary mt-4" onClick={retry}>Try again</button>
    </div>
  )

  const refreshBanner = ((tab === 'messages' && messagesError && messages.length > 0) || (tab === 'calls' && callsError && calls.length > 0)) && (
    <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red/40 bg-red/[0.08] px-4 py-3">
      <span className="text-red">Your {tab === 'messages' ? 'texts' : 'calls'} could not be refreshed. What you see may be out of date.</span>
      <button className="btn btn-secondary btn-sm" onClick={retry}>Try again</button>
    </div>
  )

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col px-4 pb-10 pt-5 animate-fade-in sm:px-6 lg:h-[calc(100dvh-4rem)] lg:px-8 lg:pb-6 lg:pt-8">
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} onPause={() => setPlayingId(null)} className="hidden" />

      <div {...(showLayer ? ({ inert: true, 'aria-hidden': true } as object) : {})} className="flex min-h-0 flex-1 flex-col">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 basis-full sm:basis-auto">
            <h1 className="page-title">Inbox</h1>
            <p className="page-subtitle truncate">{shopPhone ? `Texts and calls on ${phonePretty(shopPhone)}` : 'Texts and calls with your customers'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="btn-icon shrink-0" onClick={() => void alerts.toggle()} aria-pressed={alerts.on} aria-label={alerts.on ? 'New text alerts are on. Turn them off' : 'New text alerts are off. Turn them on'} title={alerts.on ? 'Alerts on' : 'Alerts off'}>
              <Icon name="bell" className={`h-5 w-5 ${alerts.on ? 'text-blue' : 'text-text-muted'}`} />
            </button>
            <Link href="/messages/ai" className="btn btn-secondary px-3 no-underline" aria-label={assistantBadge > 0 ? `AI assistant, ${assistantBadge} waiting for you` : 'AI assistant'}>
              <Icon name="sparkle" className="h-5 w-5" /><span className="hidden sm:inline">Assistant</span>
              {assistantBadge > 0 && <span className="num rounded-full bg-red/[0.14] px-2 text-[0.8125rem] font-bold leading-5 text-red" aria-hidden="true">{assistantBadge}</span>}
            </Link>
            <button type="button" className="btn btn-secondary w-11 px-0 sm:w-auto sm:px-4" onClick={() => setDialOpen(true)} aria-label="Call a number">
              <Icon name="phone" className="h-5 w-5" /><span className="hidden sm:inline">Call a number</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCompose({ to: '', channel: 'sms' })}>
              <Icon name="plus" className="h-5 w-5" />New message
            </button>
          </div>
        </header>

        {alerts.toast && (
          <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-blue/40 bg-blue/[0.08] px-4 py-3">
            <span className="min-w-0"><span className="flex items-center gap-2 font-bold text-blue"><span className="lamp lamp-blue" aria-hidden="true" />{alerts.toast.title}</span><span className="block truncate text-[0.9375rem] text-text-secondary">{alerts.toast.body}</span></span>
            <button type="button" className="btn-icon -mr-2 h-9 w-9 shrink-0 sm:h-9 sm:w-9" onClick={alerts.dismiss} aria-label="Dismiss"><Icon name="close" className="h-4 w-4" /></button>
          </div>
        )}
        {newCallFlash && (
          <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-green/40 bg-green/[0.1] px-4 py-3">
            <span className="flex items-center gap-2 font-bold text-green"><span className="lamp lamp-green" aria-hidden="true" />New call received</span>
            <button type="button" className="btn-icon -mr-2 h-9 w-9 sm:h-9 sm:w-9" onClick={() => setNewCallFlash(false)} aria-label="Dismiss"><Icon name="close" className="h-4 w-4" /></button>
          </div>
        )}
        {notice && (
          <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-green/40 bg-green/[0.1] px-4 py-3">
            <span className="flex items-center gap-2 font-bold text-green"><Icon name="check" className="h-5 w-5" />{notice}</span>
            <button type="button" className="btn-icon -mr-2 h-9 w-9 sm:h-9 sm:w-9" onClick={() => setNotice('')} aria-label="Dismiss"><Icon name="close" className="h-4 w-4" /></button>
          </div>
        )}

        <Segmented
          label="Inbox view" value={tab} onChange={setTab} className="mb-4 sm:max-w-md"
          options={[
            { value: 'messages', label: 'Messages', badge: unreadTotal, badgeTone: 'blue', badgeLabel: `${unreadTotal} unread` },
            { value: 'calls', label: 'Calls', badge: missedRecent, badgeTone: 'red', badgeLabel: `${missedRecent} missed in the last 3 days` },
          ]}
        />

        {refreshBanner}
        {audioError && tab === 'calls' && (
          <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red/40 bg-red/[0.08] px-4 py-3 text-red">
            <span>{audioError}</span>
            <button type="button" className="btn-icon -mr-2 h-9 w-9 sm:h-9 sm:w-9" onClick={() => setAudioError('')} aria-label="Dismiss"><Icon name="close" className="h-4 w-4" /></button>
          </div>
        )}

        {tab === 'messages' ? (
          messagesError && messages.length === 0 ? listError('Your texts')
          : threads.length === 0 ? (
            <div className="empty-state">
              <p className="font-bold text-text-primary">No texts yet</p>
              <p className="mx-auto mt-1 max-w-md">When a customer texts your shop number, the conversation shows up here. You can also start one yourself.</p>
              <button className="btn btn-primary mt-4" onClick={() => setCompose({ to: '', channel: 'sms' })}><Icon name="plus" className="h-5 w-5" />New message</button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden lg:grid lg:grid-cols-[21rem_minmax(0,1fr)] lg:rounded-lg lg:border lg:border-border lg:bg-bg-card">
              <div className="flex min-h-0 flex-col lg:border-r lg:border-border">
                <div className="pb-3 lg:p-3 lg:pb-3">
                  <label className="relative block">
                    <span className="sr-only">Search texts by name, number or words</span>
                    <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
                    <input type="search" inputMode="search" autoComplete="off" className="form-input pl-10" placeholder="Search texts" value={msgSearch} onChange={e => setMsgSearch(e.target.value)} />
                  </label>
                </div>
                <div className="min-h-0 flex-1 lg:overflow-y-auto">
                  {filteredThreads.length === 0 ? (
                    <div className="empty-state m-0 lg:m-3">
                      <p className="font-bold text-text-primary">No texts match &ldquo;{msgSearch.trim()}&rdquo;</p>
                      <button className="btn btn-secondary mt-3" onClick={() => setMsgSearch('')}>Show all texts</button>
                    </div>
                  ) : (
                    <ConversationList threads={filteredThreads} selectedKey={selected?.key || null} onSelect={openThread} needsPerson={needsKeys} assignees={overlay.assigneeOf} drafts={draftKeys} />
                  )}
                </div>
              </div>
              {isDesktop && (
                <div className="min-h-0 min-w-0">
                  {threadPane || (
                    <div className="grid h-full place-items-center p-6 text-center">
                      <div className="max-w-xs">
                        <Icon name="inbox" className="mx-auto h-8 w-8 text-text-muted" />
                        <p className="mt-3 font-bold">Pick a conversation</p>
                        <p className="mt-1 text-[0.9375rem] text-text-secondary">Choose someone on the left to read and reply to their texts.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        ) : (
          callsError && calls.length === 0 ? listError('Your calls')
          : (
            <CallsView calls={calls} nameFor={callName} playingId={playingId} onOpen={openCall} onPlay={togglePlay} onCallBack={c => dialNumber(otherNumber(c), callName(c))} ai={overlay.byCall} onSeen={ids => void overlay.markSeen(ids)} />
          )
        )}
      </div>

      {/* Phone and tablet: the open conversation sits above the tab bar, and above the keyboard when it is up. */}
      {showLayer && (
        <div className="fixed inset-x-0 z-50 bg-bg-base" style={{ top: '3.5rem', bottom: kbInset > 0 ? kbInset : 'calc(var(--tabbar-h) + env(safe-area-inset-bottom))' }}>
          {threadPane}
        </div>
      )}

      {selectedCall && (
        <Sheet open onClose={closeCall} title={callName(selectedCall) || phonePretty(otherNumber(selectedCall)) || 'Call details'} wide>
          <CallDetail
            call={selectedCall}
            name={callName(selectedCall)}
            customerId={selectedCallPerson?.id || null}
            onCallBack={() => dialNumber(otherNumber(selectedCall), callName(selectedCall))}
            onText={() => { const n = otherNumber(selectedCall); setSelectedCall(null); setCompose({ to: n, channel: 'sms' }) }}
            ai={overlay.byCall.get(selectedCall.id)}
            onAiChanged={overlay.reload}
          />
        </Sheet>
      )}

      {compose && (
        <NewMessageSheet
          key={compose.to + compose.channel}
          onClose={closeCompose}
          contacts={contacts}
          initialTo={compose.to}
          initialChannel={compose.channel}
          onSend={sendMessage}
          onSent={(to, channel) => {
            setCompose(null)
            if (channel === 'sms') {
              if (tab !== 'messages') window.history.replaceState(null, '', '/messages')
              openThread(contactKey(to))
            } else setNotice(`Email sent to ${to}.`)
          }}
        />
      )}

      {dialOpen && <DialSheet onClose={closeDial} onDial={n => dialNumber(n)} />}
    </div>
  )
}
