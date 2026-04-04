'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

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

function formatPhone(raw: string): string {
  if (!raw) return 'Unknown'
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return '(' + digits.slice(1,4) + ') ' + digits.slice(4,7) + '-' + digits.slice(7)
  if (digits.length === 10) return '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6)
  return raw
}

function formatDuration(secs: number): string {
  if (!secs || secs < 1) return ''
  if (secs < 60) return secs + 's'
  return Math.floor(secs/60) + 'm ' + (secs%60) + 's'
}

function formatTime(iso: string | number): string {
  if (!iso) return ''
  const d = new Date(typeof iso === 'number' ? iso : iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (isToday) return 'Today, ' + timeStr
  if (isYesterday) return 'Yesterday, ' + timeStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + timeStr
}

export default function VoicemailPage() {
  const [inboundCalls, setInboundCalls] = useState<CallRecord[]>([])
  const [outboundCalls, setOutboundCalls] = useState<AiCall[]>([])
  const [activeCalls, setActiveCalls] = useState<AiCall[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [tab, setTab] = useState<'inbound' | 'outbound'>('inbound')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const load = useCallback(async () => {
    const { data: activeData } = await supabase
      .from('ai_calls')
      .select('*')
      .in('status', ['ringing', 'active'])
      .order('started_at', { ascending: false })
    setActiveCalls((activeData as AiCall[]) || [])

    const { data: inData } = await supabase
      .from('call_history')
      .select('*')
      .eq('direction', 'inbound')
      .order('start_time', { ascending: false })
      .limit(500)
    setInboundCalls((inData as CallRecord[]) || [])

    const { data: outData } = await supabase
      .from('ai_calls')
      .select('*')
      .not('status', 'in', '("testing","test")')
      .not('task', 'eq', 'test')
      .not('task', 'ilike', 'inbound call from%')
      .order('started_at', { ascending: false })
      .limit(200)
    setOutboundCalls((outData as AiCall[]) || [])

    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const channel = supabase.channel('voicemail-v4')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_calls' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_history' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const displayInbound = inboundCalls.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-amber">AI Calls &amp; Voicemail</h1>
          <p className="text-text-muted text-sm mt-1">Live -- updates instantly the moment a call comes in or ends</p>
        </div>
        <div className="text-right text-xs text-text-muted">
          <div className="font-semibold text-base text-text-primary">{inboundCalls.length}</div>
          <div>inbound calls</div>
          <div className="mt-1">{outboundCalls.length} AI outbound</div>
        </div>
      </div>

      {activeCalls.length > 0 && (
        <div className="card border-green/40 bg-green/5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-green mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green animate-pulse inline-block" />
            {activeCalls.some(c => c.status === 'ringing') ? 'Incoming Call!' : 'Active Call'}
          </h2>
          <div className="space-y-2">
            {activeCalls.map(call => {
              const isRinging = call.status === 'ringing'
              return (
                <div key={call.id} className={'flex items-center justify-between gap-4 p-3 rounded-lg border ' + (isRinging ? 'border-amber/50 bg-amber/5 animate-pulse' : 'border-green/30')}>
                  <div>
                    <div className="font-bold text-sm">{call.caller ? formatPhone(call.caller) : 'Incoming Call'}</div>
                    <div className="text-xs text-text-muted capitalize">{call.status} {formatTime(call.started_at)}</div>
                  </div>
                  <span className={'text-xs font-bold px-2 py-1 rounded-full ' + (isRinging ? 'bg-amber/20 text-amber' : 'bg-green/20 text-green')}>
                    {call.status.toUpperCase()}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex gap-4 border-b border-border">
        <button
          className={'pb-2 px-1 text-sm font-semibold border-b-2 transition-colors ' + (tab === 'inbound' ? 'border-amber text-amber' : 'border-transparent text-text-muted hover:text-text-primary')}
          onClick={() => { setTab('inbound'); setPage(0) }}
        >
          Inbound Calls
          {inboundCalls.length > 0 && <span className="ml-2 bg-amber/20 text-amber text-xs px-1.5 py-0.5 rounded-full">{inboundCalls.length}</span>}
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

      {!loading && tab === 'inbound' && (
        <div className="space-y-3">
          {displayInbound.length === 0 && (
            <div className="card text-center py-12">
              <p className="font-semibold mb-1">No inbound calls recorded yet</p>
              <p className="text-text-muted text-sm">When someone calls (713) 663-6979, it appears here instantly.</p>
            </div>
          )}

          {displayInbound.map(call => {
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
                      {dur && <span className="text-xs text-text-muted">- {dur}</span>}
                    </div>
                    <p className="text-xs text-text-muted">{formatTime(call.start_time)}</p>
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

          {inboundCalls.length > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                Previous
              </button>
              <span className="text-xs text-text-muted">
                {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, inboundCalls.length)} of {inboundCalls.length}
              </span>
              <button className="btn btn-secondary btn-sm" disabled={(page + 1) * PAGE_SIZE >= inboundCalls.length} onClick={() => setPage(p => p + 1)}>
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'outbound' && (
        <div className="space-y-3">
          {outboundCalls.length === 0 && (
            <div className="card text-center py-12">
              <p className="font-semibold mb-1">No outbound AI calls yet</p>
              <p className="text-text-muted text-sm">Use Alpha AI to make outbound calls -- they appear here with full transcripts.</p>
            </div>
          )}

          {outboundCalls.map(call => {
            const isOpen = expanded === call.id
            const transcript = Array.isArray(call.transcript) ? call.transcript : []

            return (
              <div key={call.id} className="card border border-border hover:border-border-hover transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <button className="flex-1 min-w-0 text-left" onClick={() => setExpanded(isOpen ? null : call.id)}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm truncate">{(call.task || 'AI Call').slice(0, 60)}</span>
                      {transcript.length > 0 && <span className="text-xs text-text-muted">- {transcript.length} exchanges</span>}
                    </div>
                    <p className="text-xs text-text-muted">{formatTime(call.started_at)}</p>
                    {call.summary && (
                      <div className="bg-bg-hover border border-border rounded-lg p-3 mt-2">
                        <p className="text-xs font-semibold text-text-muted mb-1">AI Summary</p>
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{call.summary}</p>
                      </div>
                    )}
                  </button>
                  <button className="btn btn-secondary btn-sm shrink-0" onClick={() => setExpanded(isOpen ? null : call.id)}>
                    {isOpen ? 'Close' : 'View'}
                  </button>
                </div>

                {isOpen && transcript.length > 0 && (
                  <div className="mt-4 border-t border-border pt-4 space-y-3">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Transcript</p>
                    {transcript.map((line, i) => {
                      const isAI = line.speaker === 'ai' || line.speaker === 'agent'
                      return (
                        <div key={i} className={'flex gap-2 ' + (isAI ? 'flex-row-reverse' : '')}>
                          <div className={'max-w-xs px-3 py-2 rounded-lg text-sm ' + (isAI ? 'bg-blue/10 border border-blue/20 text-right' : 'bg-bg-hover border border-border')}>
                            <div className="text-xs text-text-muted mb-1">{isAI ? 'AI' : 'Customer'}</div>
                            {line.text}
                          </div>
                        </div>
                      )
                    })}
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
          <div>Inbound -- every call to (713) 663-6979 appears here with recording</div>
          <div>Outbound -- AI calls you initiate, with full transcript and summary</div>
          <div>Live -- new calls appear instantly via real-time connection</div>
          <div>Recording -- click Listen on any call to hear it</div>
        </div>
      </div>
    </div>
  )
}
