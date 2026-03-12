'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, markMessageRead } from '@/lib/supabase'

interface Message { id: string; direction: string; channel: string; from_address: string; to_address: string; body: string; status: string; read: boolean; created_at: string; customer?: { name: string; phone: string; email: string }; subject?: string }
interface Thread { contact: string; messages: Message[]; unread: number; lastMsg: Message }
interface Activity { id: string; type: string; customer_name?: string; notes?: string; phone?: string; created_at: string }
interface AiCall { id: string; task: string; status: string; transcript: Array<{speaker: string; text: string}>; summary: string; recording_url: string; started_at: number }
interface Customer { id: string; name: string; phone: string; email: string }

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [aiCalls, setAiCalls] = useState<AiCall[]>([])
  const [expandedCall, setExpandedCall] = useState<string | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [compose, setCompose] = useState(false)
  const [sendTo, setSendTo] = useState(''); const [sendBody, setSendBody] = useState('')
  const [sendChannel, setSendChannel] = useState<'sms'|'email'>('sms')
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<'sms'|'calls'|'summaries'>('sms')
  const [dialerNum, setDialerNum] = useState('')
  const [calling, setCalling] = useState(false)
  const [deletingCall, setDeletingCall] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Feature 7: AI Summaries
  const [summaries, setSummaries] = useState<Record<string, string>>({})
  const [summarizing, setSummarizing] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: msgs }, { data: acts }, { data: custs }, { data: aiCallData }] = await Promise.all([
      supabase.from('messages').select('*, customer:customers(name,phone,email)').order('created_at', { ascending: false }).limit(200),
      supabase.from('activities').select('*').eq('type','call').order('created_at', { ascending: false }).limit(50),
      supabase.from('customers').select('id,name,phone,email').not('phone','is',null).limit(50),
      supabase.from('ai_calls').select('*').order('started_at', { ascending: false }).limit(50)
    ])
    setMessages((msgs || []) as Message[])
    setActivities((acts || []) as Activity[])
    setCustomers((custs || []) as Customer[])
    setAiCalls((aiCallData || []) as AiCall[])
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('messages_page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_calls' }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const threadMap: Record<string, Thread> = {}
  messages.forEach(m => {
    const contact = m.direction === 'inbound' ? m.from_address : m.to_address
    if (!contact) return
    if (!threadMap[contact]) threadMap[contact] = { contact, messages: [], unread: 0, lastMsg: m }
    threadMap[contact].messages.push(m)
    if (!m.read && m.direction === 'inbound') threadMap[contact].unread++
  })
  const threads = Object.values(threadMap).sort((a, b) => new Date(b.lastMsg.created_at).getTime() - new Date(a.lastMsg.created_at).getTime())
  const activeThread = selected ? threadMap[selected] : null

  const openThread = async (contact: string) => {
    setSelected(contact)
    const unreadIds = (threadMap[contact]?.messages || []).filter(m => !m.read && m.direction === 'inbound').map(m => m.id)
    for (const id of unreadIds) await markMessageRead(id)
    load(); setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }
  const sendMessage = async () => {
    if (!sendTo || !sendBody) return; setSending(true)
    try {
      const res = await fetch('/api/send-message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: sendTo, body: sendBody, channel: sendChannel }) })
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Send failed')
      setSendTo(''); setSendBody(''); setCompose(false); load()
    } catch (e: unknown) { alert((e as Error).message) } finally { setSending(false) }
  }
  const sendReply = async () => {
    if (!selected || !sendBody) return; setSending(true)
    try {
      const channel = activeThread?.messages[0]?.channel || 'sms'
      const res = await fetch('/api/send-message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: selected, body: sendBody, channel }) })
      if (!res.ok) throw new Error('Send failed'); setSendBody(''); load()
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 200)
    } finally { setSending(false) }
  }
  const makeCall = async (to: string, name?: string) => {
    if (!to) return; setCalling(true)
    try {
      const res = await fetch('/api/make-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, name }) })
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Call failed')
      alert('Calling ' + (name || to) + ' from (713) 663-6979...'); load()
    } catch (e: unknown) { alert('Call failed: ' + (e as Error).message) } finally { setCalling(false) }
  }
  const deleteAiCall = async (id: string) => {
    if (!confirm('Delete this call recording and summary?')) return
    setDeletingCall(id)
    try {
      const res = await fetch('/api/delete-call', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error('Delete failed')
      setAiCalls(prev => prev.filter(c => c.id !== id))
      if (expandedCall === id) setExpandedCall(null)
    } catch (e: unknown) {
      alert('Could not delete: ' + (e as Error).message)
    } finally {
      setDeletingCall(null)
    }
  }

  const fmt = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const getContactName = (phone: string) => customers.find(c => c.phone?.replace(/\D/g,'') === phone.replace(/\D/g,''))?.name || phone

  // Feature 7: Summarize a thread using AI
  const summarizeThread = async (contact: string) => {
    const thread = threadMap[contact]
    if (!thread) return
    setSummarizing(contact)
    try {
      const { data: settings } = await supabase.from('settings').select('ai_api_key,ai_model,ai_base_url').limit(1).single()
      const apiKey = (settings?.ai_api_key as string) || ''
      const model = (settings?.ai_model as string) || 'meta-llama/llama-3.3-70b-instruct:free'
      const baseUrl = (settings?.ai_base_url as string) || 'https://openrouter.ai/api/v1'
      if (!apiKey) { setSummaries(s => ({ ...s, [contact]: 'Configure AI API key in Settings.' })); return }

      const convo = thread.messages.slice().reverse().map(m =>
        `${m.direction === 'inbound' ? 'Customer' : 'Shop'} (${fmt(m.created_at)}): ${m.body}`
      ).join('\n')

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Summarize this auto repair shop conversation in 2-3 sentences. Focus on: what the customer needs, any commitments made, and next steps.' },
            { role: 'user', content: convo }
          ],
          max_tokens: 200,
        })
      })
      const data = await res.json()
      setSummaries(s => ({ ...s, [contact]: data.choices?.[0]?.message?.content || 'Unable to summarize.' }))
    } catch { setSummaries(s => ({ ...s, [contact]: 'Failed to summarize.' })) }
    finally { setSummarizing(null) }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 border-b border-border flex items-center justify-between shrink-0">
        <h1 className="text-lg sm:text-xl font-bold">Calls &amp; Messages</h1>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => setTab('calls')}>Calls</button>
          <button className="btn btn-primary btn-sm" onClick={() => { setTab('sms'); setCompose(true) }}>+ New SMS</button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0">
        {(['sms', 'calls', 'summaries'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-semibold border-b-2 bg-transparent cursor-pointer transition-colors ${
              tab === t ? 'border-blue text-blue' : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {t === 'sms' ? 'SMS' : t === 'calls' ? 'Calls' : 'AI Summaries'}
          </button>
        ))}
      </div>

      {/* Feature 7: AI Summaries Tab */}
      {tab === 'summaries' && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-[720px] mx-auto">
            <p className="text-sm text-text-muted mb-5">Select a conversation to generate an AI summary of the discussion.</p>
            <div className="flex flex-col gap-3">
              {threads.length === 0 && <p className="text-text-muted text-center py-8">No conversations to summarize.</p>}
              {threads.map(t => (
                <div key={t.contact} className="bg-bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{getContactName(t.contact)}</div>
                      <div className="text-xs text-text-muted">{t.contact} · {t.messages.length} messages</div>
                    </div>
                    <button
                      className="btn btn-primary btn-sm shrink-0"
                      onClick={() => summarizeThread(t.contact)}
                      disabled={summarizing === t.contact}
                    >
                      {summarizing === t.contact ? 'Summarizing…' : summaries[t.contact] ? 'Re-summarize' : 'Summarize'}
                    </button>
                  </div>
                  {summaries[t.contact] && (
                    <div className="bg-bg-hover rounded-lg p-3 text-sm leading-relaxed mt-2">
                      {summaries[t.contact]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'sms' && (
        <div className="flex flex-1 overflow-hidden">
          {/* Thread sidebar - full width on mobile when no thread selected, hidden when thread open */}
          <div className={`${selected ? 'hidden lg:flex' : 'flex'} w-full lg:w-[280px] border-r border-border flex-col shrink-0`}>
            <div className="p-3 border-b border-border">
              <button className="btn btn-primary btn-sm w-full" onClick={() => setCompose(true)}>+ New Message</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {threads.length === 0 && <p className="p-6 text-center text-text-muted text-sm">No messages yet. Texts from (713) 663-6979 appear here.</p>}
              {threads.map(t => (
                <button key={t.contact} onClick={() => openThread(t.contact)}
                  className={`w-full text-left px-4 py-3 border-b border-border cursor-pointer block transition-colors ${selected === t.contact ? 'bg-bg-hover' : 'bg-transparent hover:bg-bg-hover'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{t.lastMsg.channel === 'sms' ? 'SMS' : 'Email'}</span>
                    <span className="font-semibold flex-1 truncate text-sm">{getContactName(t.contact)}</span>
                    {t.unread > 0 && <span className="bg-red text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">{t.unread}</span>}
                  </div>
                  <p className="text-xs text-text-muted mt-1 truncate">{t.lastMsg.body}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">{fmt(t.lastMsg.created_at)}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Chat area - full width on mobile when thread selected, hidden when no thread */}
          <div className={`${selected ? 'flex' : 'hidden lg:flex'} flex-1 flex-col overflow-hidden`}>
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-text-muted">
                <div className="text-center">
                  <div className="text-5xl mb-4">💬</div>
                  <p className="font-semibold">Select a conversation</p>
                  <p className="text-sm mt-2">or click + New Message to start one</p>
                </div>
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0 gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{getContactName(selected)}</div>
                    <div className="text-xs text-text-muted truncate">{selected}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button className="btn btn-secondary btn-sm lg:hidden" onClick={() => setSelected(null)}>←</button>
                    <button className="btn btn-secondary btn-sm hidden sm:inline-flex" onClick={() => summarizeThread(selected)} disabled={summarizing === selected}>{summarizing === selected ? '…' : 'AI Summary'}</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => makeCall(selected, getContactName(selected))} disabled={calling}>Call</button>
                    <button className="btn btn-secondary btn-sm hidden lg:inline-flex" onClick={() => setSelected(null)}>X</button>
                  </div>
                </div>
                {summaries[selected] && (
                  <div className="px-4 py-2 bg-bg-hover border-b border-border text-xs text-text-muted">
                    <strong>AI Summary:</strong> {summaries[selected]}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                  {[...(activeThread?.messages||[]).slice().reverse()].map(m => (
                    <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] sm:max-w-[70%] rounded-xl px-3.5 py-2.5 text-sm ${
                        m.direction === 'outbound'
                          ? 'bg-blue text-white'
                          : 'bg-bg-card text-text-primary border border-border'
                      }`}>
                        <p className="m-0">{m.body}</p>
                        <p className="text-[11px] mt-1 opacity-70">{fmt(m.created_at)}</p>
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
                <div className="px-3 sm:px-4 py-3 border-t border-border flex gap-2 shrink-0">
                  <textarea className="form-input flex-1 resize-none text-sm" rows={2} placeholder="Type a message..." value={sendBody} onChange={e => setSendBody(e.target.value)} onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendReply()}}} />
                  <button className="btn btn-primary self-end" onClick={sendReply} disabled={sending||!sendBody}>{sending?'...':'Send'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'calls' && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-[640px] mx-auto flex flex-col gap-8">
            {/* Make a Call */}
            <div>
              <h2 className="text-base font-bold mb-3">Make a Call</h2>
              <div className="flex gap-2.5">
                <input className="form-input flex-1" placeholder="Enter phone number..." value={dialerNum} onChange={e => setDialerNum(e.target.value)} onKeyDown={e => { if(e.key==='Enter'&&dialerNum) makeCall(dialerNum) }} />
                <button className="btn btn-primary" onClick={() => makeCall(dialerNum)} disabled={calling||!dialerNum}>{calling?'Calling...':'Call'}</button>
              </div>
              <p className="text-xs text-text-muted mt-1.5">Calls go out from your shop number (713) 663-6979.</p>
            </div>

            {/* Quick Dial */}
            {customers.filter(c => c.phone).length > 0 && (
              <div>
                <h2 className="text-base font-bold mb-3">Customer Quick Dial</h2>
                <div className="flex flex-wrap gap-2">
                  {customers.filter(c => c.phone).slice(0,20).map(c => (
                    <button key={c.id} className="btn btn-secondary btn-sm text-xs" onClick={() => makeCall(c.phone, c.name)} disabled={calling}>{c.name}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Call Log */}
            <div>
              <h2 className="text-base font-bold mb-3">Call Log</h2>
              {activities.length === 0 ? <p className="text-text-muted text-sm">No call history yet. Make your first call above!</p> : (
                <div className="flex flex-col gap-2">
                  {activities.map(a => (
                    <div key={a.id} className="flex items-center gap-3 p-3 sm:p-4 bg-bg-card border border-border rounded-lg">
                      <span>📞</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{a.customer_name || a.notes || 'Call'}</div>
                        <div className="text-xs text-text-muted">{fmt(a.created_at)}</div>
                      </div>
                      {a.phone && <button className="btn btn-secondary btn-sm text-xs shrink-0" onClick={() => makeCall(a.phone!, a.customer_name)} disabled={calling}>Call Back</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI Calls Section */}
            <div>
              <h2 className="text-base font-bold mb-3">🤖 AI Call Recordings</h2>
              {aiCalls.length === 0 ? (
                <p className="text-text-muted text-sm">No AI calls yet. Use the AI page to make an AI-powered call.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {aiCalls.map(call => (
                    <div key={call.id} className="bg-bg-card border border-border rounded-xl p-4">
                      {/* Header row */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate">{call.task || 'AI Call'}</div>
                          <div className="text-xs text-text-muted mt-0.5">
                            {call.started_at ? new Date(call.started_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Unknown time'}
                            {' · '}
                            <span className={`font-semibold ${call.status==='ended'?'text-green': call.status==='active'?'text-blue':'text-amber'}`}>
                              {call.status}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            className="btn btn-secondary btn-sm text-xs"
                            onClick={() => setExpandedCall(expandedCall === call.id ? null : call.id)}
                          >
                            {expandedCall === call.id ? 'Hide' : 'Details'}
                          </button>
                          <button
                            className="btn btn-sm text-xs bg-red/10 text-red border border-red/25 rounded-md px-2.5 py-1 cursor-pointer"
                            onClick={() => deleteAiCall(call.id)}
                            disabled={deletingCall === call.id}
                            title="Delete this call"
                          >
                            {deletingCall === call.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      </div>

                      {/* Recording player */}
                      {call.recording_url && (
                        <div className="mt-3">
                          <div className="text-xs text-text-muted mb-1 font-semibold">Recording</div>
                          <audio
                            controls
                            className="w-full h-9"
                            src={`/api/recording-proxy?url=${encodeURIComponent(call.recording_url)}`}
                          />
                        </div>
                      )}

                      {/* Expanded details */}
                      {expandedCall === call.id && (
                        <div className="mt-3 flex flex-col gap-3">
                          {call.summary && (
                            <div className="bg-bg-hover rounded-lg p-3">
                              <div className="text-xs font-bold text-text-muted mb-1.5">SUMMARY</div>
                              <div className="text-sm leading-relaxed">{call.summary}</div>
                            </div>
                          )}
                          {call.transcript && call.transcript.length > 0 && (
                            <div>
                              <div className="text-xs font-bold text-text-muted mb-2">TRANSCRIPT</div>
                              <div className="flex flex-col gap-1.5">
                                {call.transcript.map((t, i) => (
                                  <div key={i} className="flex gap-2 items-start">
                                    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                                      t.speaker === 'ai' ? 'bg-blue/10 text-blue' : 'bg-green/10 text-green'
                                    }`}>
                                      {t.speaker === 'ai' ? 'AI' : 'Them'}
                                    </span>
                                    <span className="text-sm leading-relaxed">{t.text}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Compose modal */}
      {compose && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border rounded-xl w-full max-w-[500px] p-4 sm:p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">New Message</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setCompose(false)}>X</button>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <button onClick={() => setSendChannel('sms')} className={sendChannel==='sms'?'btn btn-primary btn-sm':'btn btn-secondary btn-sm'}>SMS</button>
                <button onClick={() => setSendChannel('email')} className={sendChannel==='email'?'btn btn-primary btn-sm':'btn btn-secondary btn-sm'}>Email</button>
              </div>
              {sendChannel==='sms' && customers.filter(c=>c.phone).length>0 && (
                <div>
                  <label className="form-label">Quick Pick</label>
                  <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                    {customers.filter(c=>c.phone).slice(0,15).map(c => (
                      <button key={c.id} type="button"
                        className={`text-xs px-2.5 py-1 rounded-full border border-border cursor-pointer transition-colors ${sendTo===c.phone ? 'bg-blue text-white border-blue' : 'bg-transparent text-text-primary hover:bg-bg-hover'}`}
                        onClick={()=>setSendTo(c.phone)}>{c.name}</button>
                    ))}
                  </div>
                </div>
              )}
              {sendChannel==='email' && customers.filter(c=>c.email).length>0 && (
                <div>
                  <label className="form-label">Quick Pick</label>
                  <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                    {customers.filter(c=>c.email).slice(0,15).map(c => (
                      <button key={c.id} type="button"
                        className={`text-xs px-2.5 py-1 rounded-full border border-border cursor-pointer transition-colors ${sendTo===c.email ? 'bg-blue text-white border-blue' : 'bg-transparent text-text-primary hover:bg-bg-hover'}`}
                        onClick={()=>setSendTo(c.email)}>{c.name}</button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="form-label">To ({sendChannel==='sms'?'Phone':'Email'})</label>
                <input className="form-input" value={sendTo} onChange={e=>setSendTo(e.target.value)} placeholder={sendChannel==='sms'?'+1 (713) 555-0000':'customer@email.com'} />
              </div>
              <div>
                <label className="form-label">Message</label>
                <textarea className="form-textarea" rows={4} value={sendBody} onChange={e=>setSendBody(e.target.value)} placeholder="Type your message..." />
              </div>
              <div className="flex gap-3">
                <button className="btn btn-primary flex-1" onClick={sendMessage} disabled={sending||!sendTo||!sendBody}>{sending?'Sending...':'Send Message'}</button>
                <button className="btn btn-secondary" onClick={() => setCompose(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
