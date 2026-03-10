'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface ChatMessage { role: 'user'|'assistant'; content: string; html?: string }

const SYSTEM_PROMPT = `You are Alpha AI, the intelligent assistant for Alpha International Auto Center (Houston, TX).
Shop info: 10710 S Main St, Houston TX 77025. Phone: (713) 663-6979. Labor: $120/hr. Tax: 8.25%.
Techs: Paul, Devin, Luis, Louie. Payment: Cash, Card, Zelle, Cash App.

You can help with:
- Looking up customers, jobs, estimates, invoices in the shop database
- Creating estimates with real part prices (search the web for current prices)
- Answering repair/diagnostic questions
- Drafting SMS or email messages to customers
- Analyzing shop performance and revenue
- Anything else the shop needs

When asked about part prices, labor times, or repair procedures, use webSearch to find current info.
Always be professional, accurate, and helpful. You work FOR Alpha Auto Center.

Respond in JSON when using tools:
{"tool":"webSearch","query":"2014 Chevrolet Malibu front brake pads price"}
{"tool":"proposeDocument","type":"Estimate","customer":"...","parts":[...],"labors":[...],"notes":"..."}
{"tool":"navigate","view":"jobs"}
{"tool":"message","to":"customer_id","channel":"sms","body":"..."}

Otherwise respond in plain conversational text.`

export default function AIPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hey! I'm Alpha AI. I can look up jobs, build estimates, draft messages to customers, search for part prices — whatever you need. What's up?" }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [shopContext, setShopContext] = useState('')

  useEffect(() => {
    const loadContext = async () => {
      const [{ data: jobs }, { data: customers }, { data: msgs }] = await Promise.all([
        supabase.from('jobs').select('customer_name,concern,status').not('status','in','("Paid","Closed")').limit(10),
        supabase.from('customers').select('id,name').order('created_at',{ascending:false}).limit(5),
        supabase.from('messages').select('from_address,body,direction').order('created_at',{ascending:false}).limit(5),
      ])
      const ctx = [
        jobs?.length ? `Open jobs: ${jobs.map((j:Record<string,string>)=>`${j.customer_name}: ${j.status}`).join(', ')}` : '',
        customers?.length ? `Recent customers: ${customers.map((c:Record<string,string>)=>c.name).join(', ')}` : '',
        msgs?.length ? `Recent messages: ${msgs.filter((m:Record<string,string>)=>m.direction==='inbound').slice(0,3).map((m:Record<string,string>)=>`"${m.body.slice(0,60)}"`).join('; ')}` : '',
      ].filter(Boolean).join('\n')
      setShopContext(ctx)
    }
    loadContext()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, status])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setLoading(true)
    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    const history = [...messages, userMsg]
    await agentLoop(history)
    setLoading(false)
    setStatus('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, loading, messages, shopContext])

  const agentLoop = async (history: ChatMessage[]) => {
    const { data: settings } = await supabase.from('settings').select('ai_api_key,ai_model,ai_base_url').limit(1).single()
    const apiKey = settings?.ai_api_key
    if (!apiKey) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'No AI API key configured. Go to Settings > AI to add your OpenRouter key.' }])
      return
    }
    const accumulated: string[] = []
    for (let step = 0; step < 5; step++) {
      const systemWithContext = SYSTEM_PROMPT + (shopContext ? `\n\nCurrent shop context:\n${shopContext}` : '') + (accumulated.length ? `\n\nResearch gathered:\n${accumulated.join('\n')}` : '')
      const res = await fetch(`${settings?.ai_base_url || 'https://openrouter.ai/api/v1'}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings?.ai_model || 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [{ role: 'system', content: systemWithContext }, ...history.map(m => ({ role: m.role, content: m.content }))],
          max_tokens: 1500, temperature: 0.7
        })
      })
      const data = await res.json()
      const raw = data.choices?.[0]?.message?.content?.trim() || ''
      let parsed: Record<string, unknown> | null = null
      try { const json = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim(); parsed = JSON.parse(json) } catch { /* plain */ }
      if (parsed?.tool === 'webSearch') {
        setStatus(`Searching: "${parsed.query}"`)
        try {
          const r = await fetch(`/api/ai-search?q=${encodeURIComponent(parsed.query as string)}`)
          const d = await r.json()
          accumulated.push(`Search "${parsed.query}":\n${d.results?.map((r: Record<string,string>) => `- ${r.title}: ${r.snippet}`).join('\n') || 'No results'}`)
        } catch { accumulated.push(`Search "${parsed.query}": No results`) }
        continue
      }
      if (parsed?.tool === 'proposeDocument') {
        setMessages(prev => [...prev, { role: 'assistant', content: raw, html: renderProposal(parsed) }])
        return
      }
      if (parsed?.tool === 'navigate') { window.location.href = `/${parsed.view}`; return }
      if (parsed?.tool === 'message') {
        setMessages(prev => [...prev, { role: 'assistant', content: "I'll draft that message. Go to Messages to send it, or I can send it now — just confirm!" }])
        return
      }
      setMessages(prev => [...prev, { role: 'assistant', content: raw }])
      return
    }
    setMessages(prev => [...prev, { role: 'assistant', content: `I finished researching. Here's what I found:\n\n${accumulated.join('\n\n')}` }])
  }

  const renderProposal = (parsed: Record<string, unknown>): string => {
    const parts = (parsed.parts as Record<string,unknown>[]) || []
    const labors = (parsed.labors as Record<string,unknown>[]) || []
    const partsTotal = parts.reduce((s,p) => s + (Number(p.qty)||1)*(Number(p.unitPrice)||0), 0)
    const laborTotal = labors.reduce((s,l) => s + (Number(l.hours)||0)*(Number(l.rate)||120), 0)
    const tax = partsTotal * 0.0825
    const total = partsTotal + laborTotal + tax
    const fmt = (n: number) => '$' + n.toFixed(2)
    return `<div class="proposal-card">
      <div class="font-bold text-base mb-2">Proposed ${parsed.type || 'Estimate'} — ${parsed.customer || ''}</div>
      ${parts.length ? `<table class="w-full text-xs mb-3"><thead><tr class="text-text-muted"><th class="text-left pb-1">Part</th><th class="text-right pb-1">Qty</th><th class="text-right pb-1">Price</th><th class="text-right pb-1">Total</th></tr></thead><tbody>${parts.map(p=>`<tr><td>${p.name}</td><td class="text-right">${p.qty||1}</td><td class="text-right">${fmt(Number(p.unitPrice)||0)}</td><td class="text-right">${fmt((Number(p.qty)||1)*(Number(p.unitPrice)||0))}</td></tr>`).join('')}</tbody></table>` : ''}
      ${labors.length ? `<table class="w-full text-xs mb-3"><thead><tr class="text-text-muted"><th class="text-left pb-1">Labor</th><th class="text-right pb-1">Hrs</th><th class="text-right pb-1">Total</th></tr></thead><tbody>${labors.map(l=>`<tr><td>${l.operation}</td><td class="text-right">${l.hours}</td><td class="text-right">${fmt((Number(l.hours)||0)*120)}</td></tr>`).join('')}</tbody></table>` : ''}
      <div class="border-t border-border pt-2 space-y-1 text-xs">
        <div class="flex justify-between"><span>Parts</span><span>${fmt(partsTotal)}</span></div>
        <div class="flex justify-between"><span>Labor</span><span>${fmt(laborTotal)}</span></div>
        <div class="flex justify-between"><span>Tax</span><span>${fmt(tax)}</span></div>
        <div class="flex justify-between font-bold text-base mt-1 pt-1 border-t border-border"><span>Total</span><span class="text-green">${fmt(total)}</span></div>
      </div>
      <div class="flex gap-2 mt-3">
        <button onclick="window.location.href='/estimates'" class="btn btn-success btn-sm">Create Estimate</button>
      </div>
    </div>`
  }

  const toggleVoice = async () => {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (!SR) { alert('Voice input not supported. Please use Chrome or Edge.'); return }
      const recognition = new SR()
      recognitionRef.current = recognition
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = 'en-US'
      recognition.onstart = () => setListening(true)
      recognition.onend = () => { setListening(false); recognitionRef.current = null }
      recognition.onerror = () => { setListening(false); recognitionRef.current = null }
      recognition.onresult = (e: SpeechRecognitionEvent) => {
        const t = e.results[0][0].transcript
        setInput(prev => prev ? prev + ' ' + t : t)
      }
      recognition.start()
    } catch { alert('Microphone access denied. Please allow microphone access and try again.') }
  }

  const suggested = [
    "What jobs are open right now?",
    "Build me an estimate for front brakes on a 2019 Toyota Camry",
    "Who hasn't been in for 90+ days?",
    "How much revenue this month?",
    "Draft a follow-up text for customers with unpaid invoices",
  ]

  return (
    <div className="flex flex-col h-screen">
      <div className="p-6 border-b border-border">
        <h1 className="text-xl font-bold">Alpha AI</h1>
        <p className="text-sm text-text-muted mt-0.5">AI assistant with web search · Knows your shop data in real time</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 1 && (
          <div className="grid grid-cols-1 gap-2 max-w-xl">
            <p className="text-xs text-text-muted font-semibold uppercase tracking-wider mb-1">Try asking:</p>
            {suggested.map(s => (
              <button key={s} onClick={() => setInput(s)}
                className="text-left text-sm bg-bg-card border border-border rounded-lg px-4 py-2.5 hover:border-blue/50 hover:bg-bg-hover transition-all">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${m.role === 'user' ? 'bg-blue text-white' : 'bg-bg-card border border-border'}`}>
              {m.html ? <div dangerouslySetInnerHTML={{ __html: m.html }} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
            </div>
          </div>
        ))}
        {(loading || status) && (
          <div className="flex justify-start">
            <div className="bg-bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-muted">
              {status || <span className="animate-pulse">Alpha AI is thinking...</span>}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="p-4 border-t border-border">
        <div className="flex gap-2 items-end">
          <textarea
            className="form-input flex-1 resize-none text-sm"
            rows={2}
            placeholder="Ask anything about your shop, customers, vehicles, parts prices..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          />
          <button
            onClick={toggleVoice}
            title={listening ? 'Stop listening' : 'Voice input'}
            className={`flex items-center justify-center w-10 h-10 rounded-xl border transition-all flex-shrink-0 ${listening ? 'border-red-400 text-red-400 animate-pulse' : 'bg-bg-card border-border text-text-muted hover:border-blue/50 hover:text-blue'}`}
          >
            {listening ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            )}
          </button>
          <button
            className="btn btn-primary flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0"
            onClick={send}
            disabled={loading || !input.trim()}
          >
            {loading
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            }
          </button>
        </div>
        {listening && <p className="text-xs mt-2 text-red-400 animate-pulse">🎤 Listening... speak now</p>}
      </div>
    </div>
  )
}
