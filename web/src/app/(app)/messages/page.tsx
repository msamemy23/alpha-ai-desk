'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, markMessageRead } from '@/lib/supabase'

interface Message {
  id: string; direction: string; channel: string; from_address: string; to_address: string
  body: string; status: string; read: boolean; created_at: string
  customer?: { name: string; phone: string; email: string }
  subject?: string
}

interface Thread {
  contact: string; messages: Message[]; unread: number; lastMsg: Message
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [compose, setCompose] = useState(false)
  const [sendTo, setSendTo] = useState(''); const [sendBody, setSendBody] = useState('')
  const [sendChannel, setSendChannel] = useState<'sms'|'email'>('sms')
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<'all'|'sms'|'email'>('all')
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*, customer:customers(name,phone,email)')
      .order('created_at', { ascending: false })
      .limit(200)
    setMessages((data || []) as Message[])
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('messages_page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  // Group into threads by contact
  const filtered = messages.filter(m => tab === 'all' || m.channel === tab)
  const threadMap: Record<string, Thread> = {}
  filtered.forEach(m => {
    const contact = m.direction === 'inbound' ? m.from_address : m.to_address
    if (!threadMap[contact]) threadMap[contact] = { contact, messages: [], unread: 0, lastMsg: m }
    threadMap[contact].messages.push(m)
    if (!m.read && m.direction === 'inbound') threadMap[contact].unread++
  })
  const threads = Object.values(threadMap).sort((a, b) =>
    new Date(b.lastMsg.created_at).getTime() - new Date(a.lastMsg.created_at).getTime()
  )
  const activeThread = selected ? threadMap[selected] : null

  const openThread = async (contact: string) => {
    setSelected(contact)
    const unreadIds = (threadMap[contact]?.messages || []).filter(m => !m.read && m.direction === 'inbound').map(m => m.id)
    for (const id of unreadIds) await markMessageRead(id)
    load()
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  const sendMessage = async () => {
    if (!sendTo || !sendBody) return
    setSending(true)
    try {
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: sendTo, body: sendBody, channel: sendChannel })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      setSendTo(''); setSendBody(''); setCompose(false)
      load()
    } catch (e: unknown) {
      alert((e as Error).message)
    } finally { setSending(false) }
  }

  const sendReply = async () => {
    if (!selected || !sendBody) return
    setSending(true)
    try {
      const lastMsg = activeThread?.messages[0]
      const channel = lastMsg?.channel || 'sms'
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selected, body: sendBody, channel })
      })
      if (!res.ok) throw new Error('Send failed')
      setSendBody('')
      load()
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 200)
    } finally { setSending(false) }
  }

  const fmt = (d: string) => {
    const dt = new Date(d)
    return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Thread list */}
      <div className="w-80 border-r border-border flex flex-col shrink-0">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h1 className="text-lg font-bold">Messages</h1>
          <button className="btn btn-primary btn-sm" onClick={() => setCompose(true)}>+ New</button>
        </div>

        {/* Tab filter */}
        <div className="flex border-b border-border">
          {(['all','sms','email'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs font-semibold capitalize transition-colors ${tab === t ? 'text-blue border-b-2 border-blue' : 'text-text-muted hover:text-text-primary'}`}>
              {t === 'all' ? '📬 All' : t === 'sms' ? '💬 SMS' : '📧 Email'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 && <p className="p-4 text-text-muted text-sm">No messages yet</p>}
          {threads.map(t => (
            <button key={t.contact} onClick={() => openThread(t.contact)}
              className={`w-full text-left p-4 border-b border-border/50 transition-colors hover:bg-bg-hover ${selected === t.contact ? 'bg-bg-hover' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm">{t.lastMsg.channel === 'sms' ? '💬' : '📧'}</span>
                <span className="text-sm font-medium flex-1 truncate">{t.contact}</span>
                {t.unread > 0 && <span className="bg-blue text-white text-xs rounded-full px-1.5 font-bold">{t.unread}</span>}
              </div>
              <p className="text-xs text-text-muted mt-1 truncate">{t.lastMsg.body}</p>
              <p className="text-xs text-text-muted mt-0.5">{fmt(t.lastMsg.created_at)}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Message thread or empty state */}
      <div className="flex-1 flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-text-muted">
            <div className="text-center">
              <div className="text-5xl mb-4">💬</div>
              <p className="text-lg font-semibold">Select a conversation</p>
              <p className="text-sm mt-2">or click + New to start one</p>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <div className="font-semibold">{selected}</div>
                <div className="text-xs text-text-muted">{activeThread?.messages.length} messages</div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelected(null)}>✕</button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {[...((activeThread?.messages || []).slice().reverse())].map(m => (
                <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-xl px-4 py-2.5 text-sm ${m.direction === 'outbound' ? 'bg-blue text-white rounded-br-sm' : 'bg-bg-card border border-border rounded-bl-sm'}`}>
                    <p>{m.body}</p>
                    <p className={`text-xs mt-1 ${m.direction === 'outbound' ? 'text-blue-100/70' : 'text-text-muted'}`}>{fmt(m.created_at)}</p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Reply */}
            <div className="p-4 border-t border-border flex gap-3">
              <textarea
                className="form-input flex-1 resize-none text-sm"
                rows={2}
                placeholder="Type a message..."
                value={sendBody}
                onChange={e => setSendBody(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
              />
              <button className="btn btn-primary" onClick={sendReply} disabled={sending || !sendBody}>
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Compose modal */}
      {compose && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border rounded-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">New Message</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setCompose(false)}>✕</button>
            </div>
            <div className="space-y-4">
              <div className="flex gap-2">
                {(['sms','email'] as const).map(c => (
                  <button key={c} onClick={() => setSendChannel(c)}
                    className={`btn ${sendChannel === c ? 'btn-primary' : 'btn-secondary'} btn-sm`}>
                    {c === 'sms' ? '💬 SMS' : '📧 Email'}
                  </button>
                ))}
              </div>
              <div>
                <label className="form-label">To ({sendChannel === 'sms' ? 'Phone Number' : 'Email Address'})</label>
                <input className="form-input" value={sendTo} onChange={e => setSendTo(e.target.value)}
                  placeholder={sendChannel === 'sms' ? '+1 (713) 555-0000' : 'customer@email.com'} />
              </div>
              <div>
                <label className="form-label">Message</label>
                <textarea className="form-textarea" rows={4} value={sendBody} onChange={e => setSendBody(e.target.value)} placeholder="Type your message..." />
              </div>
              <div className="flex gap-3 pt-2">
                <button className="btn btn-primary" onClick={sendMessage} disabled={sending || !sendTo || !sendBody}>
                  {sending ? 'Sending…' : 'Send Message'}
                </button>
                <button className="btn btn-secondary" onClick={() => setCompose(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
