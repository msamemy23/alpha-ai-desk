'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const SB_URL = 'https://fztnsqrhjesqcnsszqdb.supabase.co'
// Publishable anon key â€” goes in apikey header to identify the project
const SB_ANON = 'sb_publishable_EwRdKR6toaGlqbtoqQVbzw_nhXJwa8h'

// Build fetch headers: anon key identifies project, user JWT authorizes the request.
// Reading directly from localStorage bypasses GoTrue's lock â€” instant, no 5s delays.
function buildHeaders(): Record<string, string> {
  const base = { apikey: SB_ANON, Accept: 'application/json', 'Content-Type': 'application/json' }
  try {
    const raw = localStorage.getItem('sb-fztnsqrhjesqcnsszqdb-auth-token')
    if (raw) {
      const token = JSON.parse(raw)?.access_token
      if (token) return { ...base, Authorization: `Bearer ${token}` }
    }
  } catch {}
  // Unauthenticated fallback (anon role â€” RLS may restrict results)
  return { ...base, Authorization: `Bearer ${SB_ANON}` }
}

interface AiCall {
  id: string
  task: string
  caller?: string
  status: string
  started_at: number
  transcript?: { speaker: string; text: string }[]
  summary?: string
  recording_url?: string
  read?: boolean
}

interface CallRecord {
  id: string
  call_id: string
  direction: string
  from_number: string
  to_number: string
  duration_secs: number
  status: string
  start_time: string
  matched_customer_name?: string
  raw_data?: {
    download_urls?: { mp3?: string; wav?: string }
    recording_id?: string
  }
}

function isInbound(call: AiCall): boolean {
  return (call.task || '').toLowerCase().startsWith('inbound call from')
}

function getCallerDisplay(call: AiCall): string {
  if (call.caller && call.caller !== 'unknown' && !call.caller.includes('663-6979') && !call.caller.includes('6636979')) {
    return formatPhone(call.caller)
  }
  const match = (call.task || '').match(/Inbound call from ([^\s.]+)/)
  if (match && match[1] && match[1] !== 'unknown' && !match[1].includes('6636979')) {
    return formatPhone(match[1])
  }
  if (call.caller) return formatPhone(call.caller)
  return 'Unknown Caller'
}

function getOutboundTarget(call: AiCall): string {
  const task = call.task || ''
  const nameMatch = task.match(/(?:with|call|ask|check.*with|calling)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)/i)
  if (nameMatch) return nameMatch[1]
  return task.slice(0, 50) || 'AI Call'
}

function formatPhone(raw: string): string {
  if (!raw) return 'Unknown'
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return '(' + digits.slice(1,4) + ') ' + digits.slice(4,7) + '-' + digits.slice(7)
  }
  if (digits.length === 10) {
    return '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6)
  }
  return raw
}

function formatCallTime(call: AiCall): string {
  if (!call.started_at) return ''
  const d = new Date(call.started_at)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (isToday) return 'Today, ' + timeStr
  if (isYesterday) return 'Yesterday, ' + timeStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + timeStr
}

function formatHistoryTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (isToday) return 'Today, ' + timeStr
  if (isYesterday) return 'Yesterday, ' + timeStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + timeStr
}

function formatDuration(secs: number): string {
  if (!secs || secs < 1) return ''
  if (secs < 60) return secs + 's'
  return Math.floor(secs/60) + 'm ' + (secs % 60) + 's'
}

function formatAiDuration(call: AiCall): string {
  const transcript = Array.isArray(call.transcript) ? call.transcript : []
  if (transcript.length === 0) return ''
  return transcript.length + ' exchanges'
}

export default function VoicemailPage() {
  const [calls, setCalls] = useState<AiCall[]>([])
  const [callHistory, setCallHistory] = useState<CallRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [shopPhone, setShopPhone] = useState('(713) 663-6979')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [tab, setTab] = useState<'inbound' | 'outbound' | 'history'>('history')
  const [histPage, setHistPage] = useState(0)
  const HIST_PAGE_SIZE = 50

  // Raw fetch: anon key as apikey, user JWT as Authorization.
  // This bypasses GoTrue's localStorage lock â€” no 5000ms delays ever.
  const load = useCallback(async () => {
    try {
      const headers = buildHeaders()
      const [r1, r2] = await Promise.all([
        fetch(
          `${SB_URL}/rest/v1/ai_calls?status=not.in.(testing,test)&task=not.eq.test&task=not.eq.test%20insert%20permissions&order=started_at.desc.nullslast&limit=200`,
          { headers }
        ),
        fetch(
          `${SB_URL}/rest/v1/call_history?direction=eq.inbound&order=start_time.desc&limit=500`,
          { headers }
        ),
      ])
      const aiData = r1.ok ? await r1.json() : []
      const histData = r2.ok ? await r2.json() : []
      setCalls(Array.isArray(aiData) ? aiData : [])
      setCallHistory(Array.isArray(histData) ? histData : [])
    } catch (e) {
      console.error('[voicemail] load error', e)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // Safety net: never stuck at "Loading calls..." forever
    const timeout = setTimeout(() => setLoading(false), 8000)

    load().finally(() => clearTimeout(timeout))

    // Realtime: page updates the instant new calls come in
    const channel = supabase.channel('voicemail-v9')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_calls' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_history' }, () => load())
      .subscribe()

    return () => {
      clearTimeout(timeout)
      supabase.removeChannel(channel)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = async (id: string) => {
    setCalls(prev => prev.map(c => c.id === id ? { ...c, read: true } : c))
    await supabase.from('ai_calls').update({ read: true }).eq('id', id)
  }

  const activeCalls   = calls.filter(c => c.status === 'ringing' || c.status === 'active')
  const inboundCalls  = calls.filter(c => isInbound(c) && !['ringing','active'].includes(c.status || '') && !!c.started_at)
  const outboundCalls = calls.filter(c => !isInbound(c) && !['ringing','active'].includes(c.status || '') && !!c.started_at)

  const displayCalls = tab === 'inbound' ? inboundCalls : outboundCalls
  const displayHistory = callHistory.slice(histPage * HIST_PAGE_SIZE, (histPage + 1) * HIST_PAGE_SIZE)

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-amber">AI Calls &amp; Voicemail</h1>
          <p className="text-text-muted text-sm mt-1">Live -- updates instantly the moment a call comes in or ends</p>
        </div>
        <div className="text-right text-xs text-text-muted">
          <div className="font-semibold text-base text-text-primary">{callHistory.length}</div>
          <div>real inbound calls</div>
          <div className="mt-1">{outboundCalls.length} AI outbound</div>
        </div>
      </div>

      {activeCalls.length > 0 && (
        <div className="card border-green/40 bg-green/5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-green mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green animate-pulse inline-block" />
            {activeCalls.some(c => c.status === 'ringing') ? 'Incoming Call!' : 'Active Call'}
          </h2>
          <div className="space-y-3">
            {activeCalls.map(call => {
              const isRinging = call.status === 'ringing'
              const display = isInbound(call) ? getCallerDisplay(call) : getOutboundTarget(call)
              return (
                <div key={call.id} className={'flex items-center justify-between gap-4 p-4 rounded-lg border ' + (isRinging ? 'border-amber/50 bg-amber/5 animate-pulse' : 'border-green/30 bg-green/5')}>
                  <div>
                    <div className="text-sm font-bold">{display}</div>
                    <div className="text-xs text-text-muted capitalize">{call.status} -- {formatCallTime(call)}</div>
                  </div>
                  <span className={'text-xs font-bold uppercase px-2 py-1 rounded-full ' + (isRinging ? 'bg-amber/20 text-amber' : 'bg-green/20 text-green')}>
                    {call.status}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex gap-4 border-b border-border">
        <button
          className={'pb-2 px-1 text-sm font-semibold border-b-2 transition-colors ' + (tab === 'history' ? 'border-amber text-amber' : 'border-transparent text-text-muted hover:text-text-primary')}
          onClick={() => { setTab('history'); setHistPage(0) }}
        >
          Inbound Calls
          {callHistory.length > 0 && <span className="ml-2 bg-amber/20 text-amber text-xs px-1.5 py-0.5 rounded-full">{callHistory.length}</span>}
        </button>
        <button
          className={'pb-2 px-1 text-sm font-semibold border-b-2 transition-colors ' + (tab === 'inbound' ? 'border-green text-green' : 'border-transparent text-text-muted hover:text-text-primary')}
          onClick={() => setTab('inbound')}
        >
          AI Inbound
          {inboundCalls.length > 0 && <span className="ml-2 bg-green/20 text-green text-xs px-1.5 py-0.5 rounded-full">{inboundCalls.length}</span>}
        </button>
        <button
          className={'pb-2 px-1 text-sm font-semibold border-b-2 transition-colors ' + (tab === 'outbound' ? 'border-blue text-blue' : 'border-transparent text-text-muted hover:text-text-primary')}
          onClick={() => setTab('outbound')}
        >
          AI Outbound
          {outboundCalls.length > 0 && <span className="ml-2 bg-blue/20 text-blue text-xs px-1.5 py-0.5 rounded-full">{outboundCalls.length}</span>}
        </button>
      </div>

      {loading && <p className="text-text-muted text-sm animate-pulse">Loading calls...</p>}

      {!loading && tab === 'history' && (
        <div className="space-y-3">
          {callHistory.length === 0 && (
            <div className="card text-center py-12">
              <p className="font-semibold mb-1">No inbound calls recorded yet</p>
              <p className="text-text-muted text-sm">When someone calls {shopPhone}, it appears here instantly.</p>
            </div>
          )}

          {displayHistory.map(call => {
            const isOpen = expanded === call.id
            const recordingUrl = call.raw_data?.download_urls?.mp3 || call.raw_data?.download_urls?.wav
            const dur = formatDuration(call.duration_secs)

            return (
              <div key={call.id} className="card border border-border hover:border-border-hover transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <button className="flex-1 min-w-0 text-left" onClick={() => setExpanded(isOpen ? null : call.id)}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm truncate">{formatPhone(call.from_number)}</span>
                      {call.matched_customer_name && (
                        <span className="text-xs bg-blue/10 text-blue px-1.5 py-0.5 rounded-full">{call.matched_customer_name}</span>
                      )}
                      {dur && <span className="text-xs text-text-muted">-- {dur}</span>}
                    </div>
                    <p className="text-xs text-text-muted">{formatHistoryTime(call.start_time)}</p>
                    {call.duration_secs > 30 && <p className="text-xs text-green mt-1">Connected call</p>}
                    {call.duration_secs <= 15 && <p className="text-xs text-text-muted mt-1">Missed / short</p>}
                  </button>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {recordingUrl ? (
                      <a href={recordingUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                        Listen
                      </a>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={() => setExpanded(isOpen ? null : call.id)}>
                        {isOpen ? 'Close' : 'Details'}
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-3 pt-3 border-t border-border text-xs text-text-muted space-y-1">
                    <div>From: <span className="text-text-primary">{call.from_number}</span></div>
                    <div>Duration: <span className="text-text-primary">{dur || '0s'}</span></div>
                    <div>Status: <span className="text-text-primary capitalize">{call.status}</span></div>
                    {recordingUrl && (
                      <a href={recordingUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm mt-2 inline-block">
                        Listen to Recording
                      </a>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {callHistory.length > HIST_PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button className="btn btn-secondary btn-sm" disabled={histPage === 0} onClick={() => setHistPage(p => p - 1)}>
                Previous
              </button>
              <span className="text-xs text-text-muted">
                {histPage * HIST_PAGE_SIZE + 1}-{Math.min((histPage + 1) * HIST_PAGE_SIZE, callHistory.length)} of {callHistory.length}
              </span>
              <button className="btn btn-secondary btn-sm" disabled={(histPage + 1) * HIST_PAGE_SIZE >= callHistory.length} onClick={() => setHistPage(p => p + 1)}>
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && (tab === 'inbound' || tab === 'outbound') && (
        <div className="space-y-3">
          {displayCalls.length === 0 && (
            <div className="card text-center py-12">
              <p className="font-semibold mb-1">
                {tab === 'inbound' ? 'No AI-handled inbound calls yet' : 'No outbound AI calls yet'}
              </p>
              <p className="text-text-muted text-sm">
                {tab === 'inbound'
                  ? 'AI-answered inbound calls with transcripts appear here.'
                  : 'Use Alpha AI to make outbound calls -- they appear here with full transcripts.'}
              </p>
            </div>
          )}

          {displayCalls.map(call => {
            const isInboundCall = isInbound(call)
            const displayName = isInboundCall ? getCallerDisplay(call) : getOutboundTarget(call)
            const isUnread = !call.read && isInboundCall
            const isOpen = expanded === call.id
            const transcript = Array.isArray(call.transcript) ? call.transcript : []
            const duration = formatAiDuration(call)

            return (
              <div key={call.id} className={'card border transition-colors ' + (isUnread ? 'border-amber/40 bg-amber/5' : 'border-border hover:border-border-hover')}>
                <div className="flex items-start justify-between gap-4">
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => {
                      setExpanded(isOpen ? null : call.id)
                      if (isUnread) markRead(call.id)
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold truncate">{displayName}</span>
                      {isUnread && <span className="w-2 h-2 rounded-full bg-amber shrink-0" />}
                      {duration && <span className="text-xs text-text-muted">-- {duration}</span>}
                    </div>
                    {!isInboundCall && (
                      <p className="text-xs text-text-muted truncate mb-1">{(call.task || '').slice(0, 80)}</p>
                    )}
                    <p className="text-xs text-text-muted">{formatCallTime(call)}</p>
                    {call.summary && (
                      <div className="bg-bg-hover border border-border rounded-lg p-3 mt-2">
                        <p className="text-xs text-text-muted font-semibold mb-1">AI Summary</p>
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{call.summary}</p>
                      </div>
                    )}
                    {!call.summary && transcript.length > 0 && !isOpen && (
                      <div className="bg-bg-hover border border-border rounded-lg p-3 mt-2">
                        <p className="text-xs text-text-muted mb-1">Transcript preview</p>
                        <p className="text-sm truncate text-text-secondary">
                          &ldquo;{transcript.find(t => t.speaker === 'customer' || t.speaker === 'caller')?.text || transcript[0]?.text}&rdquo;
                        </p>
                      </div>
                    )}
                  </button>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setExpanded(isOpen ? null : call.id)
                        if (isUnread) markRead(call.id)
                      }}
                    >
                      {isOpen ? 'Close' : 'View'}
                    </button>
                    {isUnread && (
                      <button className="text-xs text-text-muted hover:text-text-primary" onClick={() => markRead(call.id)}>
                        Mark read
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && transcript.length > 0 && (
                  <div className="mt-4 border-t border-border pt-4 space-y-3">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Full Transcript</p>
                    {transcript.map((line, i) => {
                      const isAI = line.speaker === 'ai' || line.speaker === 'agent'
                      return (
                        <div key={i} className={'flex gap-2 ' + (isAI ? 'flex-row-reverse' : '')}>
                          <div className={'max-w-xs px-3 py-2 rounded-lg text-sm ' + (isAI ? 'bg-blue/10 border border-blue/20 text-right' : 'bg-bg-hover border border-border')}>
                            <div className="text-xs text-text-muted mb-1">{isAI ? 'AI' : (isInboundCall ? 'Caller' : 'Customer')}</div>
                            {line.text}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {isOpen && transcript.length === 0 && (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-xs text-text-muted">No transcript available for this call.</p>
                  </div>
                )}

                {isOpen && call.recording_url && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <a href={call.recording_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                      Listen to Recording
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="card border-border bg-bg-hover/30 text-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3">How It Works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-text-muted text-xs">
          <div>Inbound Calls -- every call to {shopPhone} with recording. Click Listen to hear it.</div>
          <div>AI Inbound -- calls where AI answered and built a transcript.</div>
          <div>AI Outbound -- calls you initiated via Alpha AI, with full transcript and summary.</div>
          <div>Live -- new calls appear instantly via real-time connection.</div>
        </div>
      </div>
    </div>
  )
}

