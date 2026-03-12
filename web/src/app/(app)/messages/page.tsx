'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, markMessageRead } from '@/lib/supabase'

interface Message { id: string; direction: string; channel: string; from_address: string; to_address: string; body: string; status: string; read: boolean; created_at: string; customer?: { name: string; phone: string; email: string }; subject?: string }
interface Thread { contact: string; messages: Message[]; unread: number; lastMsg: Message }
interface Activity { id: string; type: string; customer_name?: string; notes?: string; phone?: string; created_at: string }
interface Customer { id: string; name: string; phone: string; email: string }

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [compose, setCompose] = useState(false)
  const [sendTo, setSendTo] = useState(''); const [sendBody, setSendBody] = useState('')
  const [sendChannel, setSendChannel] = useState<'sms'|'email'>('sms')
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<'sms'|'calls'|'summaries'>('sms')
  const [dialerNum, setDialerNum] = useState('')
  const [calling, setCalling] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Feature 7: AI Summaries
  const [summaries, setSummaries] = useState<Record<string, string>>({})
  const [summarizing, setSummarizing] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: msgs }, { data: acts }, { data: custs }] = await Promise.all([
      supabase.from('messages').select('*, customer:customers(name,phone,email)').order('created_at', { ascending: false }).limit(200),
      supabase.from('activities').select('*').eq('type','call').order('created_at', { ascending: false }).limit(50),
      supabase.from('customers').select('id,name,phone,email').not('phone','is',null).limit(50)
    ])
    setMessages((msgs || []) as Message[])
    setActivities((acts || []) as Activity[])
    setCustomers((custs || []) as Customer[])
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('messages_page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, load)
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
    <div style={{display:'flex',height:'100vh',overflow:'hidden',flexDirection:'column'}}>
      <div style={{padding:'16px 24px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
        <h1 style={{fontSize:'1.25rem',fontWeight:700,margin:0}}>Calls &amp; Messages</h1>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-secondary btn-sm" onClick={() => setTab('calls')}>Calls</button>
          <button className="btn btn-primary btn-sm" onClick={() => { setTab('sms'); setCompose(true) }}>+ New SMS</button>
        </div>
      </div>
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',flexShrink:0}}>
        <button onClick={() => setTab('sms')} style={{flex:1,padding:'12px',fontSize:'0.875rem',fontWeight:600,border:'none',borderBottom:tab==='sms'?'2px solid #3b82f6':'2px solid transparent',color:tab==='sms'?'#3b82f6':'var(--text-muted)',background:'transparent',cursor:'pointer'}}>SMS</button>
        <button onClick={() => setTab('calls')} style={{flex:1,padding:'12px',fontSize:'0.875rem',fontWeight:600,border:'none',borderBottom:tab==='calls'?'2px solid #3b82f6':'2px solid transparent',color:tab==='calls'?'#3b82f6':'var(--text-muted)',background:'transparent',cursor:'pointer'}}>Calls</button>
        <button onClick={() => setTab('summaries')} style={{flex:1,padding:'12px',fontSize:'0.875rem',fontWeight:600,border:'none',borderBottom:tab==='summaries'?'2px solid #3b82f6':'2px solid transparent',color:tab==='summaries'?'#3b82f6':'var(--text-muted)',background:'transparent',cursor:'pointer'}}>AI Summaries</button>
      </div>

      {/* Feature 7: AI Summaries Tab */}
      {tab === 'summaries' && (
        <div style={{flex:1,overflowY:'auto',padding:'24px'}}>
          <div style={{maxWidth:'720px',margin:'0 auto'}}>
            <p style={{fontSize:'0.875rem',color:'var(--text-muted)',marginBottom:'20px'}}>Select a conversation to generate an AI summary of the discussion.</p>
            <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
              {threads.length === 0 && <p style={{color:'var(--text-muted)',textAlign:'center',padding:'32px'}}>No conversations to summarize.</p>}
              {threads.map(t => (
                <div key={t.contact} style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'16px'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:'0.875rem'}}>{getContactName(t.contact)}</div>
                      <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{t.contact} · {t.messages.length} messages</div>
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => summarizeThread(t.contact)}
                      disabled={summarizing === t.contact}
                    >
                      {summarizing === t.contact ? 'Summarizing…' : summaries[t.contact] ? 'Re-summarize' : 'Summarize'}
                    </button>
                  </div>
                  {summaries[t.contact] && (
                    <div style={{background:'var(--bg-hover)',borderRadius:'8px',padding:'12px',fontSize:'0.875rem',lineHeight:'1.5',marginTop:'8px'}}>
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
        <div style={{display:'flex',flex:1,overflow:'hidden'}}>
          <div style={{width:'280px',borderRight:'1px solid var(--border)',display:'flex',flexDirection:'column',flexShrink:0}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)'}}><button className="btn btn-primary btn-sm" style={{width:'100%'}} onClick={() => setCompose(true)}>+ New Message</button></div>
            <div style={{flex:1,overflowY:'auto'}}>
              {threads.length === 0 && <p style={{padding:'24px',textAlign:'center',color:'var(--text-muted)',fontSize:'0.875rem'}}>No messages yet. Texts from (713) 663-6979 appear here.</p>}
              {threads.map(t => (
                <button key={t.contact} onClick={() => openThread(t.contact)} style={{width:'100%',textAlign:'left',padding:'12px 16px',borderBottom:'1px solid var(--border)',background:selected===t.contact?'var(--bg-hover)':'transparent',cursor:'pointer',border:'none',display:'block'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'8px'}}><span>{t.lastMsg.channel==='sms'?'SMS':'Email'}</span><span style={{fontWeight:600,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:'0.875rem'}}>{getContactName(t.contact)}</span>{t.unread > 0 && <span style={{background:'#ef4444',color:'white',fontSize:'0.7rem',borderRadius:'999px',padding:'1px 6px',fontWeight:700}}>{t.unread}</span>}</div>
                  <p style={{fontSize:'0.75rem',color:'var(--text-muted)',marginTop:'4px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.lastMsg.body}</p>
                  <p style={{fontSize:'0.7rem',color:'var(--text-muted)',marginTop:'2px'}}>{fmt(t.lastMsg.created_at)}</p>
                </button>
              ))}
            </div>
          </div>
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
            {!selected ? (<div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)'}}><div style={{textAlign:'center'}}><div style={{fontSize:'3rem',marginBottom:'16px'}}>💬</div><p style={{fontWeight:600}}>Select a conversation</p><p style={{fontSize:'0.875rem',marginTop:'8px'}}>or click + New Message to start one</p></div></div>) : (<>
                <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                  <div><div style={{fontWeight:600}}>{getContactName(selected)}</div><div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{selected}</div></div>
                  <div style={{display:'flex',gap:'8px'}}>
                    <button className="btn btn-secondary btn-sm" onClick={() => summarizeThread(selected)} disabled={summarizing === selected}>{summarizing === selected ? '…' : 'AI Summary'}</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => makeCall(selected, getContactName(selected))} disabled={calling}>Call</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setSelected(null)}>X</button>
                  </div>
                </div>
                {summaries[selected] && (
                  <div style={{padding:'8px 16px',background:'var(--bg-hover)',borderBottom:'1px solid var(--border)',fontSize:'0.8rem',color:'var(--text-muted)'}}>
                    <strong>AI Summary:</strong> {summaries[selected]}
                  </div>
                )}
                <div style={{flex:1,overflowY:'auto',padding:'16px',display:'flex',flexDirection:'column',gap:'12px'}}>
                  {[...(activeThread?.messages||[]).slice().reverse()].map(m => (<div key={m.id} style={{display:'flex',justifyContent:m.direction==='outbound'?'flex-end':'flex-start'}}><div style={{maxWidth:'70%',borderRadius:'12px',padding:'10px 14px',fontSize:'0.875rem',background:m.direction==='outbound'?'#2563eb':'var(--bg-card)',color:m.direction==='outbound'?'white':'var(--text)',border:m.direction==='outbound'?'none':'1px solid var(--border)'}}><p style={{margin:0}}>{m.body}</p><p style={{fontSize:'0.7rem',marginTop:'4px',opacity:0.7}}>{fmt(m.created_at)}</p></div></div>))}
                  <div ref={bottomRef} />
                </div>
                <div style={{padding:'12px 16px',borderTop:'1px solid var(--border)',display:'flex',gap:'8px',flexShrink:0}}>
                  <textarea className="form-input" style={{flex:1,resize:'none',fontSize:'0.875rem'}} rows={2} placeholder="Type a message..." value={sendBody} onChange={e => setSendBody(e.target.value)} onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendReply()}}} />
                  <button className="btn btn-primary" onClick={sendReply} disabled={sending||!sendBody}>{sending?'...':'Send'}</button>
                </div>
              </>)}
          </div>
        </div>
      )}
      {tab === 'calls' && (
        <div style={{flex:1,overflowY:'auto',padding:'24px'}}>
          <div style={{maxWidth:'640px',margin:'0 auto',display:'flex',flexDirection:'column',gap:'32px'}}>
            <div>
              <h2 style={{fontSize:'1rem',fontWeight:700,marginBottom:'12px'}}>Make a Call</h2>
              <div style={{display:'flex',gap:'10px'}}>
                <input className="form-input" style={{flex:1}} placeholder="Enter phone number..." value={dialerNum} onChange={e => setDialerNum(e.target.value)} onKeyDown={e => { if(e.key==='Enter'&&dialerNum) makeCall(dialerNum) }} />
                <button className="btn btn-primary" onClick={() => makeCall(dialerNum)} disabled={calling||!dialerNum}>{calling?'Calling...':'Call'}</button>
              </div>
              <p style={{fontSize:'0.75rem',color:'var(--text-muted)',marginTop:'6px'}}>Calls go out from your shop number (713) 663-6979.</p>
            </div>
            {customers.filter(c => c.phone).length > 0 && (<div><h2 style={{fontSize:'1rem',fontWeight:700,marginBottom:'12px'}}>Customer Quick Dial</h2><div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>{customers.filter(c => c.phone).slice(0,20).map(c => (<button key={c.id} className="btn btn-secondary btn-sm" style={{fontSize:'0.8rem'}} onClick={() => makeCall(c.phone, c.name)} disabled={calling}>{c.name}</button>))}</div></div>)}
            <div>
              <h2 style={{fontSize:'1rem',fontWeight:700,marginBottom:'12px'}}>Call Log</h2>
              {activities.length === 0 ? <p style={{color:'var(--text-muted)',fontSize:'0.875rem'}}>No call history yet. Make your first call above!</p> : (
                <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                  {activities.map(a => (<div key={a.id} style={{display:'flex',alignItems:'center',gap:'12px',padding:'12px 16px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'8px'}}><span>Call</span><div style={{flex:1}}><div style={{fontWeight:500,fontSize:'0.875rem'}}>{a.customer_name || a.notes || 'Call'}</div><div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{fmt(a.created_at)}</div></div>{a.phone && <button className="btn btn-secondary btn-sm" style={{fontSize:'0.75rem'}} onClick={() => makeCall(a.phone!, a.customer_name)} disabled={calling}>Call Back</button>}</div>))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {compose && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:'16px'}}>
          <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',width:'100%',maxWidth:'500px',padding:'24px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px'}}><h2 style={{fontSize:'1.125rem',fontWeight:700,margin:0}}>New Message</h2><button className="btn btn-secondary btn-sm" onClick={() => setCompose(false)}>X</button></div>
            <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
              <div style={{display:'flex',gap:'8px'}}>
                <button onClick={() => setSendChannel('sms')} className={sendChannel==='sms'?'btn btn-primary btn-sm':'btn btn-secondary btn-sm'}>SMS</button>
                <button onClick={() => setSendChannel('email')} className={sendChannel==='email'?'btn btn-primary btn-sm':'btn btn-secondary btn-sm'}>Email</button>
              </div>
              {sendChannel==='sms' && customers.filter(c=>c.phone).length>0 && (<div><label className="form-label">Quick Pick</label><div style={{display:'flex',flexWrap:'wrap',gap:'6px',maxHeight:'80px',overflowY:'auto'}}>{customers.filter(c=>c.phone).slice(0,15).map(c => (<button key={c.id} type="button" style={{fontSize:'0.75rem',padding:'3px 10px',borderRadius:'999px',border:'1px solid var(--border)',cursor:'pointer',background:sendTo===c.phone?'#2563eb':'transparent',color:sendTo===c.phone?'white':'var(--text)'}} onClick={()=>setSendTo(c.phone)}>{c.name}</button>))}</div></div>)}
              {sendChannel==='email' && customers.filter(c=>c.email).length>0 && (<div><label className="form-label">Quick Pick</label><div style={{display:'flex',flexWrap:'wrap',gap:'6px',maxHeight:'80px',overflowY:'auto'}}>{customers.filter(c=>c.email).slice(0,15).map(c => (<button key={c.id} type="button" style={{fontSize:'0.75rem',padding:'3px 10px',borderRadius:'999px',border:'1px solid var(--border)',cursor:'pointer',background:sendTo===c.email?'#2563eb':'transparent',color:sendTo===c.email?'white':'var(--text)'}} onClick={()=>setSendTo(c.email)}>{c.name}</button>))}</div></div>)}
              <div><label className="form-label">To ({sendChannel==='sms'?'Phone':'Email'})</label><input className="form-input" value={sendTo} onChange={e=>setSendTo(e.target.value)} placeholder={sendChannel==='sms'?'+1 (713) 555-0000':'customer@email.com'} /></div>
              <div><label className="form-label">Message</label><textarea className="form-textarea" rows={4} value={sendBody} onChange={e=>setSendBody(e.target.value)} placeholder="Type your message..." /></div>
              <div style={{display:'flex',gap:'12px'}}><button className="btn btn-primary" onClick={sendMessage} disabled={sending||!sendTo||!sendBody}>{sending?'Sending...':'Send Message'}</button><button className="btn btn-secondary" onClick={() => setCompose(false)}>Cancel</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
