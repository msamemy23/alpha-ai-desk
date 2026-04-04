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
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
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
  if (isToday) return `Today, ${timeStr}`
  if (isYesterday) return `Yesterday, ${timeStr}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + `, ${timeStr}`
}

function formatDuration(call: AiCall): string {
  const transcript = Array.isArray(call.transcript) ? call.transcript : []
  if (transcript.length === 0) return ''
  return `${transcript.length} exchanges`
}

export default function VoicemailPage() {
  const [calls, setCalls] = useState<AiCall[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [tab, setTab] = useState<'inbound' | 'outbound'>('inbound')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('ai_calls')
      .select('*')
      .not('status', 'in', '("testing","test")')
      .not('task', 'eq', 'test')
      .not('task', 'eq', 'test insert permissions')
      .order('started_at', { ascending: false, nullsFirst: false })
      .limit(200)
    setCalls((data as AiCall[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const channel = supabase.channel('voicemail-calls-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_calls' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = async (id: string) => {
    setCalls(prev => prev.map(c => c.id === id ? { ...c, read: true } : c))
    await supabase.from('ai_calls').update({ read: true }).eq('id', id)
  }

  const activeCalls   = calls.filter(c => c.status === 'ringing' || c.status === 'active')
  const inboundCalls  = calls.filter(c => isInbound(c) && !['ringing','active'].includes(c.status || '') && !!c.started_at)
  const outboundCalls = calls.filter(c => !isInbound(c) && !['ringing','active'].includes(c.status || '') && !!c.started_at)

  const displayCalls = tab === 'inbound' ? inboundCalls : outboundCalls

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-amber">AI Calls & Voicemail</h1>
          <p className="text-text-muted text-sm mt-1">Live — updates instantly the moment a call comes in or ends</p>
        </div>
        <div className="text-right text-xs text-text-muted">
          <div className="font-semibold">{inboundCalls.length} inbound</div>
          <div>{outboundCalls.length} outbound AI</div>
        </div>
      </div>

      {activeCalls.length > 0 && (
        <div className="card border-green/40 bg-green/5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-green mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green animate-pulse inline-block" />
            {activeCalls.some(c => c.status === 'ringing') ? '📲 Incoming Call!' : '📞 Active Call'}
          </h2>
          <div className="space-y-3">
            {activeCalls.map(call => {
              const isRinging = call.status === 'ringing'
              const display = isInbound(call) ? getCallerDisplay(call) : getOutboundTarget(call)
              return (
                <div key={call.id} className={`flex items-center justify-between gap-4 p-4 rounded-lg border ${isRinging ? 'border-amber/50 bg-amber/5 animate-pulse' : 'border-green/30 bg-green/5'}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{isRinging ? '📲' : '📞'}</span>
                    <div>
                      <div className="text-sm font-bold">{display}</div>
                      <div className="text-xs text-text-muted capitalize">{call.status} · {formatCallTime(call)}</div>
                      {isInbound(call) && call.caller && (
                        <div className="text-xs text-text-muted">{formatPhone(call.caller)}</div>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${isRinging ? 'bg-amber/20 text-amber' : 'bg-green/20 text-green'}`}>
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
          className={`pb-2 px-1 text-sm font-semibold border-b-2 transition-colors ${tab === 'inbound' ? 'border-amber text-amber' : 'border-transparent text-text-muted hover:text-text-primary'}`}
          onClick={() => setTab('inbound')}
        >
          📞 Inbound Calls {inboundCalls.length > 0 && <span className="ml-1 bg-amber/20 text-amber text-xs px-1.5 py-0.5 rounded-full">{inboundCalls.length}</span>}
        </button>
        <button
          className={`pb-2 px-1 text-sm font-semibold border-b-2 transition-colors ${tab === 'outbound' ? 'border-blue text-blue' : 'border-transparent text-text-muted hover:text-text-primary'}`}
          onClick={() => setTab('outbound')}
        >
          🤖 AI Outbound {outboundCalls.length > 0 && <span className="ml-1 bg-blue/20 text-blue text-xs px-1.5 py-0.5 rounded-full">{outboundCalls.length}</span>}
        </button>
      </div>

      <div>
        {loading && <p className="text-text-muted text-sm animate-pulse">Loading calls…</p>}

        {!loading && displayCalls.length === 0 && (
          <div className="card text-center py-12">
            <div className="text-4xl mb-3">{tab === 'inbound' ? '📵' : '🤖'}</div>
            <p className="text-text-primary font-semibold mb-1">
              {tab === 'inbound' ? 'No inbound calls recorded yet' : 'No outbound AI calls yet'}
            </p>
            <p className="text-text-muted text-sm">
              {tab === 'inbound'
                ? 'When someone calls (713) 663-6979, it appears here instantly with live transcript.'
                : "Use Alpha AI to make outbound calls — they'll appear here with full transcripts."}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {displayCalls.map(call => {
            const isInboundCall = isInbound(call)
            const displayName = isInboundCall ? getCallerDisplay(call) : getOutboundTarget(call)
            const isUnread = !call.read && isInboundCall
            const isOpen = expanded === call.id
            const transcript = Array.isArray(call.transcript) ? call.transcript : []
            const duration = formatDuration(call)

            return (
              <div key={call.id} className={`card border transition-colors ${isUnread ? 'border-amber/40 bg-amber/5' : 'border-border hover:border-border-hover'}`}>
                <div className="flex items-start justify-between gap-4">
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => {
                      setExpanded(isOpen ? null : call.id)
                      if (isUnread) markRead(call.id)
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base">{isInboundCall ? '📞' : '🤖'}</span>
                      <span className="text-sm font-semibold truncate">{displayName}</span>
                      {isUnread && <span className="w-2 h-2 rounded-full bg-amber shrink-0" />}
                      {duration && <span className="text-xs text-text-muted">· {duration}</span>}
                    </div>

                    {!isInboundCall && (
                      <p className="text-xs text-text-muted truncate mb-1">{(call.task || '').slice(0, 80)}</p>
                    )}
                    <p className="text-xs text-text-muted">{formatCallTime(call)}</p>

                    {call.summary && (
                      <div className="bg-bg-hover border border-border rounded-lg p-3 mt-2">
                        <p className="text-xs text-text-muted font-semibold mb-1">📋 AI Summary</p>
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
                      {isOpen ? '▲ Close' : '▼ View'}
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
                        <div key={i} className={`flex gap-2 ${isAI ? 'flex-row-reverse' : ''}`}>
                          <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${isAI ? 'bg-blue/10 border border-blue/20 text-right' : 'bg-bg-hover border border-border'}`}>
                            <div className="text-xs text-text-muted mb-1">{isAI ? '🤖 AI' : '👤 ' + (isInboundCall ? 'Caller' : 'Customer')}</div>
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
                  <div className="mt-3 pt-3 border-t border-border flex items-center gap-3">
                    <a href={call.recording_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                      🎙 Listen to Recording
                    </a>
                    <span className="text-xs text-text-muted">Opens in new tab</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="card border-border bg-bg-hover/30 text-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3">How Live Call Tracking Works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-text-muted">
          <div className="flex gap-2 items-start">
            <span className="text-amber font-bold mt-0.5">1.</span>
            <span>Customer calls <strong className="text-text-primary">(713) 663-6979</strong> → appears here instantly as "Incoming"</span>
          </div>
          <div className="flex gap-2 items-start">
            <span className="text-amber font-bold mt-0.5">2.</span>
            <span>AI receptionist answers, converses in real time</span>
          </div>
          <div className="flex gap-2 items-start">
            <span className="text-amber font-bold mt-0.5">3.</span>
            <span>Transcript builds live during the call</span>
          </div>
          <div className="flex gap-2 items-start">
            <span className="text-amber font-bold mt-0.5">4.</span>
            <span>AI summary + recording saved automatically when call ends</span>
          </div>
        </div>
      </div>
    </div>
  )
}
