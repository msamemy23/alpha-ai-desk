'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, markMessageRead } from '@/lib/supabase'

interface CallRecord {
  id: string
  call_id: string
  direction: string
  from_number: string
  to_number: string
  duration_secs: number
  status: string
  start_time: string
  end_time: string
  matched_customer_name: string | null
  transcript: string | null
  lead_score: string | null
  lead_reasoning: string | null
  service_needed: string | null
  caller_sentiment: string | null
  key_quotes: string | null
  call_count_from_number: number | null
  raw_data: any
}

interface Message {
  id: string; direction: string; channel: string; from_address: string; to_address: string;
  body: string; status: string; read: boolean; created_at: string;
  customer?: { name: string; phone: string; email: string }; subject?: string
}
interface Thread { contact: string; messages: Message[]; unread: number; lastMsg: Message }
interface Customer { id: string; name: string; phone: string; email: string }

function formatPhone(p: string) {
  if (!p) return ''
  const d = p.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return p
}

function formatDuration(s: number) {
  if (!s || s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function formatDate(d: string) {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
    dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function LeadBadge({ score }: { score: string | null }) {
  if (!score || score === 'unknown') return null
  const colors: Record<string, string> = {
    hot: 'bg-red-500/20 text-red-400 border-red-500/30',
    warm: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    cold: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium uppercase ${colors[score] || 'bg-gray-500/20 text-gray-400'}`}>
      {score}
    </span>
  )
}

function DirectionBadge({ dir }: { dir: string }) {
  const isIn = dir === 'inbound' || dir === 'in'
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${\
      isIn ? 'bg-green-500/20 text-green-400' : 'bg-purple-500/20 text-purple-400'\
    }`}>
      {isIn ? 'Inbound' : 'Outbound'}
    </span>
  )
}

export default function MessagesPage() {
  const [tab, setTab] = useState<'calls'|'sms'>('calls')
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null)
  const [selectedThread, setSelectedThread] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [callFilter, setCallFilter] = useState<'all'|'inbound'|'outbound'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [compose, setCompose] = useState(false)
  const [sendTo, setSendTo] = useState('')
  const [sendBody, setSendBody] = useState('')
  const [sendChannel, setSendChannel] = useState<'sms'|'email'>('sms')
  const [sending, setSending] = useState(false)
  const [dialerNum, setDialerNum] = useState('')
  const [shopPhone, setShopPhone] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  const loadCalls = useCallback(async () => {
    const { data } = await supabase
      .from('call_history')
      .select('id, call_id, direction, from_number, to_number, duration_secs, status, start_time, end_time, matched_customer_name, transcript, lead_score, lead_reasoning, service_needed, caller_sentiment, key_quotes, call_count_from_number, raw_data')
      .order('start_time', { ascending: false })
      .limit(5000)
    if (data) setCalls(data)
  }, [])

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*, customer:customers(name, phone, email)')
      .order('created_at', { ascending: false })
      .limit(500)
    if (data) setMessages(data as any)
  }, [])

  const loadCustomers = useCallback(async () => {
    const { data } = await supabase.from('customers').select('id, name, phone, email').limit(100)
    if (data) setCustomers(data)
  }, [])

  useEffect(() => {
    setLoading(true)
    // Load shop phone from settings
    supabase.from('settings').select('telnyx_phone_number,shop_phone').limit(1).single()
      .then(({ data }) => {
        setShopPhone(data?.telnyx_phone_number || data?.shop_phone || '')
      })
    Promise.all([loadCalls(), loadMessages(), loadCustomers()]).finally(() => setLoading(false))
  }, [loadCalls, loadMessages, loadCustomers])

  // Group messages into threads
  const threads: Thread[] = (() => {
    const map: Record<string, Message[]> = {}
    messages.filter(m => m.channel === 'sms').forEach(m => {
      const contact = m.direction === 'inbound' ? m.from_address : m.to_address
      if (!map[contact]) map[contact] = []
      map[contact].push(m)
    })
    return Object.entries(map).map(([contact, msgs]) => ({
      contact,
      messages: msgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
      unread: msgs.filter(m => !m.read && m.direction === 'inbound').length,
      lastMsg: msgs[msgs.length - 1],
    })).sort((a, b) => new Date(b.lastMsg.created_at).getTime() - new Date(a.lastMsg.created_at).getTime())
  })()

  const filteredCalls = calls.filter(c => {
    if (callFilter === 'inbound' && c.direction !== 'inbound') return false
    if (callFilter === 'outbound' && c.direction !== 'outbound') return false
    if (searchTerm) {
      const s = searchTerm.toLowerCase()
      return c.from_number?.includes(s) || c.to_number?.includes(s) ||
        c.matched_customer_name?.toLowerCase().includes(s) ||
        c.service_needed?.toLowerCase().includes(s) ||
        c.lead_score?.toLowerCase().includes(s)
    }
    return true
  })

  const getRecordingUrl = (call: CallRecord) => {
    const rd = call.raw_data
    if (!rd) return null
    // Prioritize recording_id (gets fresh URL from Telnyx API, never expires)
    if (rd.recording_id) {
      const params = new URLSearchParams({ id: rd.recording_id })
      if (rd.call_session_id) params.set('sessionId', rd.call_session_id)
      return `/api/recording-proxy?${params}`
    }
    // Fallback to direct URL through proxy
    if (rd.download_urls?.mp3) return `/api/recording-proxy?url=${encodeURIComponent(rd.download_urls.mp3)}`
    if (rd.download_urls?.wav) return `/api/recording-proxy?url=${encodeURIComponent(rd.download_urls.wav)}`
    return null
  }

  const playRecording = (call: CallRecord) => {
    const url = getRecordingUrl(call)
    if (!url || !audioRef.current) return
    audioRef.current.src = url
    audioRef.current.play()
    setPlaying(true)
  }

  const sendMessage = async () => {
    if (!sendTo || !sendBody || sending) return
    setSending(true)
    try {
      await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: sendTo, body: sendBody, channel: sendChannel }),
      })
      setSendBody('')
      setCompose(false)
      loadMessages()
    } finally { setSending(false) }
  }

  const makeCall = async (num: string) => {
    if (!num) return
    await fetch('/api/make-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: num }),
    })
  }

  // ─── RENDER ───
  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <audio ref={audioRef} onEnded={() => setPlaying(false)} className="hidden" />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Communications</h1>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => makeCall(dialerNum)}>Call</button>
          <input className="form-input w-48" placeholder="Phone number..." value={dialerNum} onChange={e => setDialerNum(e.target.value)} />
          <button className="btn btn-primary" onClick={() => setCompose(true)}>+ New Message</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-white/10">
        {(['calls', 'sms'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setSelectedCall(null); setSelectedThread(null) }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${\
              tab === t ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-white'\
            }`}>
            {t === 'calls' ? `Calls (${calls.length})` : `SMS (${threads.length})`}
          </button>
        ))}
      </div>

      {loading ? <div className="text-center py-20 text-gray-400">Loading...</div> : (
        <div className="flex gap-4" style={{ minHeight: '70vh' }}>

          {/* ─── LEFT: List ─── */}
          <div className={`${selectedCall || selectedThread ? 'w-1/2' : 'w-full'} transition-all`}>

            {tab === 'calls' && (
              <>
                {/* Filters */}
                <div className="flex gap-2 mb-3">
                  <input className="form-input flex-1" placeholder="Search calls by name, phone, service..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                  {(['all','inbound','outbound'] as const).map(f => (
                    <button key={f} onClick={() => setCallFilter(f)}
                      className={`px-3 py-1.5 text-xs rounded font-medium ${\
                        callFilter === f ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'\
                      }`}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Call List */}
                <div className="space-y-1 max-h-[70vh] overflow-y-auto">
                  {filteredCalls.map(call => (
                    <div key={call.id}
                      onClick={() => setSelectedCall(call)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${\
                        selectedCall?.id === call.id ? 'bg-blue-600/20 border border-blue-500/30' : 'bg-white/5 hover:bg-white/10'\
                      }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <DirectionBadge dir={call.direction} />
                          <span className="font-medium">
                            {call.matched_customer_name || formatPhone(call.direction === 'inbound' ? call.from_number : call.to_number)}
                          </span>
                          <LeadBadge score={call.lead_score} />
                        </div>
                        <div className="flex items-center gap-3 text-sm text-gray-400" onClick={e => e.stopPropagation()}>
                          <span>{formatDuration(call.duration_secs)}</span>
                          <span>{formatDate(call.start_time)}</span>
                          <button
                            onClick={e => { e.stopPropagation(); makeCall(call.direction === "inbound" ? call.from_number : call.to_number) }}
                            className="px-2 py-1 text-xs bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-600/40 transition-colors font-medium"
                            title="Call Back"
                          >📞 Call</button>
                        </div>
                      </div>
                      {call.service_needed && call.service_needed !== 'unknown' && (
                        <div className="text-xs text-gray-500 mt-1 ml-16">
                          Service: {call.service_needed}
                        </div>
                      )}
                    </div>
                  ))}
                  {filteredCalls.length === 0 && <div className="text-center py-10 text-gray-500">No calls found</div>}
                </div>
              </>
            )}

            {tab === 'sms' && (
              <div className="space-y-1 max-h-[70vh] overflow-y-auto">
                {threads.map(thread => {
                  const name = thread.lastMsg.customer?.name || formatPhone(thread.contact)
                  return (
                    <div key={thread.contact}
                      onClick={() => setSelectedThread(thread.contact)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${\
                        selectedThread === thread.contact ? 'bg-blue-600/20 border border-blue-500/30' : 'bg-white/5 hover:bg-white/10'\
                      }`}>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400">SMS</span>
                          <span className="font-medium">{name}</span>
                          {thread.unread > 0 && <span className="bg-red-500 text-white text-xs rounded-full px-1.5">{thread.unread}</span>}
                        </div>
                        <span className="text-xs text-gray-500">{formatDate(thread.lastMsg.created_at)}</span>
                      </div>
                      <div className="text-sm text-gray-400 mt-1 truncate">{thread.lastMsg.body}</div>
                    </div>
                  )
                })}
                {threads.length === 0 && <div className="text-center py-10 text-gray-500">No messages</div>}
              </div>
            )}

          </div>

          {/* ─── RIGHT: Detail Panel ─── */}
          {selectedCall && (
            <div className="w-1/2 bg-white/5 rounded-xl p-5 overflow-y-auto max-h-[80vh] border border-white/10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">Call Details</h2>
                <button onClick={() => setSelectedCall(null)} className="text-gray-400 hover:text-white text-xl">&times;</button>
              </div>

              {/* Call Info Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Direction</div>
                  <DirectionBadge dir={selectedCall.direction} />
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Duration</div>
                  <div className="font-medium">{formatDuration(selectedCall.duration_secs)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">From</div>
                  <div className="font-medium text-sm">{selectedCall.matched_customer_name || formatPhone(selectedCall.from_number)}</div>
                  <div className="text-xs text-gray-500">{formatPhone(selectedCall.from_number)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">To</div>
                  <div className="font-medium text-sm">{formatPhone(selectedCall.to_number)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Date</div>
                  <div className="text-sm">{formatDate(selectedCall.start_time)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Times Called</div>
                  <div className="font-medium text-lg">{selectedCall.call_count_from_number || 1}</div>
                </div>
              </div>

              {/* Lead Score Section */}
              {selectedCall.lead_score && selectedCall.lead_score !== 'unknown' && (
                <div className="mb-5 bg-white/5 rounded-lg p-4 border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold">Lead Score</span>
                    <LeadBadge score={selectedCall.lead_score} />
                    {selectedCall.caller_sentiment && (
                      <span className="text-xs text-gray-400">Sentiment: {selectedCall.caller_sentiment}</span>
                    )}
                  </div>
                  {selectedCall.lead_reasoning && (
                    <div className="text-sm text-gray-300 mb-2">{selectedCall.lead_reasoning}</div>
                  )}
                  {selectedCall.service_needed && selectedCall.service_needed !== 'unknown' && (
                    <div className="text-sm"><span className="text-gray-500">Service Needed:</span> <span className="text-blue-400">{selectedCall.service_needed}</span></div>
                  )}
                  {selectedCall.key_quotes && (
                    <div className="text-sm mt-2 italic text-gray-400">"{selectedCall.key_quotes}"</div>
                  )}
                </div>
              )}

              {/* Recording Player */}
              {getRecordingUrl(selectedCall) && (
                <div className="mb-5">
                  <div className="text-sm font-semibold mb-2">Recording</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => playRecording(selectedCall)}
                      className="btn btn-sm bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded-lg text-sm">
                      {playing ? 'Playing...' : 'Play Recording'}
                    </button>
                  </div>
                  <audio ref={audioRef} controls className="w-full mt-2" onEnded={() => setPlaying(false)} />
                </div>
              )}

              {/* Transcript */}
              {selectedCall.transcript && selectedCall.transcript !== '[transcription_failed]' ? (
                <div className="mb-5">
                  <div className="text-sm font-semibold mb-2">Transcript</div>
                  <div className="bg-black/30 rounded-lg p-4 text-sm text-gray-300 max-h-60 overflow-y-auto whitespace-pre-wrap">
                    {selectedCall.transcript}
                  </div>
                </div>
              ) : (
                <div className="mb-5">
                  <div className="text-sm font-semibold mb-2">Transcript</div>
                  <div className="bg-black/30 rounded-lg p-4 text-sm text-gray-500 italic">
                    {selectedCall.transcript === '[transcription_failed]' ? 'Recording expired — transcription unavailable' : 'Transcribing... check back soon...'}
                  </div>
                </div>
              )}

              {/* Action Buttons */}

                      {/* AI Lead Insights */}
                {selectedCall.lead_score && selectedCall.lead_score !== 'unknown' && (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold mb-2">AI Lead Insights</div>
                    <div className="bg-black/30 rounded-lg p-4 space-y-2 border border-white/10">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 text-xs">Lead Score:</span>
                        <LeadBadge score={selectedCall.lead_score} />
                      </div>
                      {selectedCall.lead_reasoning && (
                        <div><span className="text-gray-400 text-xs">Reasoning:</span><p className="text-sm text-gray-200 mt-0.5">{selectedCall.lead_reasoning}</p></div>
                      )}
                      {selectedCall.service_needed && (
                        <div><span className="text-gray-400 text-xs">Service Needed:</span><p className="text-sm text-white mt-0.5">{selectedCall.service_needed}</p></div>
                      )}
                      {selectedCall.caller_sentiment && (
                        <div><span className="text-gray-400 text-xs">Sentiment:</span><span className="ml-1 text-sm capitalize">{selectedCall.caller_sentiment}</span></div>
                      )}
                      {selectedCall.key_quotes && (
                        <div><span className="text-gray-400 text-xs">Key Quotes:</span><p className="text-sm text-gray-300 mt-0.5 italic">"{selectedCall.key_quotes}"</p></div>
                      )}
                    </div>
                  </div>
                )}
              <div className="flex gap-2">
                <button onClick={() => makeCall(selectedCall.direction === 'inbound' ? selectedCall.from_number : selectedCall.to_number)}
                  className="btn btn-primary px-4 py-2 rounded-lg text-sm">Call Back</button>
                <button onClick={() => { setSendTo(selectedCall.direction === 'inbound' ? selectedCall.from_number : selectedCall.to_number); setCompose(true) }}
                  className="btn btn-secondary px-4 py-2 rounded-lg text-sm">Send SMS</button>
              </div>
            </div>
          )}

          {/* SMS Thread Detail */}
          {selectedThread && (() => {
            const thread = threads.find(t => t.contact === selectedThread)
            if (!thread) return null
            const name = thread.lastMsg.customer?.name || formatPhone(thread.contact)
            return (
              <div className="w-1/2 bg-white/5 rounded-xl border border-white/10 flex flex-col max-h-[80vh]">
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                  <div>
                    <div className="font-bold">{name}</div>
                    <div className="text-xs text-gray-500">{formatPhone(thread.contact)}</div>
                  </div>
                  <button onClick={() => setSelectedThread(null)} className="text-gray-400 hover:text-white text-xl">&times;</button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {thread.messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${\
                        msg.direction === 'inbound' ? 'bg-white/10' : 'bg-blue-600'\
                      }`}>
                        <div>{msg.body}</div>
                        <div className="text-xs opacity-60 mt-1">{formatDate(msg.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t border-white/10 flex gap-2">
                  <input className="form-input flex-1" placeholder="Type a message..."
                    value={sendBody} onChange={e => setSendBody(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { setSendTo(thread.contact); sendMessage() } }} />
                  <button onClick={() => { setSendTo(thread.contact); sendMessage() }}
                    className="btn btn-primary px-4">Send</button>
                </div>
              </div>
            )
          })()}

        </div>
      )}

      {/* Compose Modal */}
      {compose && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-xl p-6 w-full max-w-md border border-white/10">
            <div className="flex justify-between mb-4">
              <h2 className="text-lg font-bold">New Message</h2>
              <button onClick={() => setCompose(false)} className="text-gray-400 hover:text-white">&times;</button>
            </div>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setSendChannel('sms')}
                className={`px-3 py-1 rounded text-sm ${sendChannel === 'sms' ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-400'}`}>SMS</button>
              <button onClick={() => setSendChannel('email')}
                className={`px-3 py-1 rounded text-sm ${sendChannel === 'email' ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-400'}`}>Email</button>
            </div>
            <input className="form-input w-full mb-3" placeholder={sendChannel === 'sms' ? 'Phone number' : 'Email address'}
              value={sendTo} onChange={e => setSendTo(e.target.value)} />
            {customers.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {customers.slice(0, 8).map(c => (
                  <button key={c.id} onClick={() => setSendTo(sendChannel === 'sms' ? c.phone : c.email)}
                    className="text-xs bg-white/10 px-2 py-1 rounded hover:bg-white/20">{c.name}</button>
                ))}
              </div>
            )}
            <textarea className="form-input w-full h-32 mb-3" placeholder="Message..."
              value={sendBody} onChange={e => setSendBody(e.target.value)} />
            <button onClick={sendMessage} disabled={sending}
              className="btn btn-primary w-full">{sending ? 'Sending...' : 'Send'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
