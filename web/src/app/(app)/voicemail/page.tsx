'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase, getShopId } from '@/lib/supabase'

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

function getCallerDisplay(call: AiCall): string {
  if (call.caller) return call.caller
  const match = (call.task || '').match(/Inbound call from ([^\s.]+)/)
  return match ? match[1] : 'Unknown Caller'
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

export default function VoicemailPage() {
  const [calls, setCalls] = useState<AiCall[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    const shopId = await getShopId()
    const { data } = await supabase
      .from('ai_calls')
      .select('*')
      .eq('shop_id', shopId ?? '')
      .order('started_at', { ascending: false })
      .limit(50)
    setCalls((data as AiCall[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const channel = supabase.channel('voicemail-calls')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_calls' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = async (id: string) => {
    await supabase.from('ai_calls').update({ read: true }).eq('id', id)
    setCalls(prev => prev.map(c => c.id === id ? { ...c, read: true } : c))
  }

  const activeCalls = calls.filter(c => c.status === 'ringing' || c.status === 'active')
  const endedCalls  = calls.filter(c => c.status === 'ended' || (!c.status || !['ringing','active'].includes(c.status)))

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-amber">AI Calls & Voicemail</h1>
        <p className="text-text-muted text-sm mt-1">Live call tracking — updates in real time</p>
      </div>

      {/* Active / Ringing Calls */}
      {activeCalls.length > 0 && (
        <div className="card border-green/30 bg-green/5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-green mb-4">
            {activeCalls.some(c => c.status === 'ringing') ? '📲 Incoming Call' : '📞 Active Call'}
          </h2>
          <div className="space-y-3">
            {activeCalls.map(call => (
              <div key={call.id} className={`flex items-center justify-between gap-4 p-3 rounded-lg border ${call.status === 'ringing' ? 'border-amber/40 bg-amber/5 animate-pulse' : 'border-green/30 bg-green/5'}`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{call.status === 'ringing' ? '📲' : '📞'}</span>
                  <div>
                    <div className="text-sm font-bold">{getCallerDisplay(call)}</div>
                    <div className="text-xs text-text-muted capitalize">{call.status} · {formatCallTime(call)}</div>
                  </div>
                </div>
                <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${call.status === 'ringing' ? 'bg-amber/20 text-amber' : 'bg-green/20 text-green'}`}>
                  {call.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Call Log */}
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-4">
          Call History {loading && <span className="text-text-muted normal-case font-normal">Loading…</span>}
        </h2>

        {!loading && calls.length === 0 && (
          <div className="card text-center py-10">
            <div className="text-4xl mb-3">📵</div>
            <p className="text-text-muted text-sm">No calls yet. When someone calls (713) 663-6979, it will appear here instantly.</p>
          </div>
        )}

        <div className="space-y-3">
          {endedCalls.map(call => {
            const caller = getCallerDisplay(call)
            const isUnread = !call.read
            const isOpen = expanded === call.id
            const transcript = Array.isArray(call.transcript) ? call.transcript : []

            return (
              <div key={call.id} className={`card border ${isUnread ? 'border-amber/30 bg-amber/5' : 'border-border'}`}>
                <div className="flex items-start justify-between gap-4">
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => {
                      setExpanded(isOpen ? null : call.id)
                      if (isUnread) markRead(call.id)
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold">{caller}</span>
                      {isUnread && <span className="w-2 h-2 rounded-full bg-amber shrink-0" />}
                    </div>
                    <p className="text-xs text-text-muted mb-2">{formatCallTime(call)}</p>

                    {/* Summary */}
                    {call.summary && (
                      <div className="bg-bg-hover border border-border rounded-lg p-3 mb-2">
                        <p className="text-xs text-text-muted mb-1 font-semibold">AI Summary</p>
                        <p className="text-sm whitespace-pre-wrap">{call.summary}</p>
                      </div>
                    )}

                    {/* Transcript preview when collapsed */}
                    {!call.summary && transcript.length > 0 && !isOpen && (
                      <div className="bg-bg-hover border border-border rounded-lg p-3">
                        <p className="text-xs text-text-muted mb-1">Transcript preview</p>
                        <p className="text-sm truncate">&ldquo;{transcript.find(t => t.speaker === 'customer')?.text || transcript[0]?.text}&rdquo;</p>
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

                {/* Expanded: Full transcript */}
                {isOpen && transcript.length > 0 && (
                  <div className="mt-4 border-t border-border pt-4 space-y-2">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Full Transcript</p>
                    {transcript.map((line, i) => (
                      <div key={i} className={`flex gap-2 ${line.speaker === 'ai' ? 'flex-row-reverse' : ''}`}>
                        <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${line.speaker === 'ai' ? 'bg-blue/10 border border-blue/20 text-right' : 'bg-bg-hover border border-border'}`}>
                          <div className="text-xs text-text-muted mb-1">{line.speaker === 'ai' ? 'AI Receptionist' : 'Caller'}</div>
                          {line.text}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Recording link */}
                {isOpen && call.recording_url && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <a
                      href={call.recording_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary btn-sm"
                    >
                      🎙 Listen to Recording
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Setup Card */}
      <div className="card border-border bg-bg-hover/50">
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-4">📋 How It Works</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <span>Customer calls (713) 663-6979</span>
          <span className="text-amber font-bold">→</span>
          <span>AI answers & converses</span>
          <span className="text-amber font-bold">→</span>
          <span>Transcript saved live</span>
          <span className="text-amber font-bold">→</span>
          <span className="text-amber font-semibold">Appears here instantly</span>
        </div>
      </div>
    </div>
  )
}
