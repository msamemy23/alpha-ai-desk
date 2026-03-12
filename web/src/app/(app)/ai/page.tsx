'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface ChatMessage { role: 'user'|'assistant'; content: string; html?: string; imageUrl?: string }

const SYSTEM_PROMPT = `You are Alpha AI, the all-powerful AI assistant that CONTROLS every aspect of Alpha International Auto Center's operations.

SHOP INFO:
- Name: Alpha International Auto Center
- Address: 10710 S Main St, Houston TX 77025
- Phone: (713) 663-6979
- Labor Rate: $120/hr · Tax Rate: 8.25%
- Payment: Cash, Card, Zelle, Cash App
- Technicians: Paul (senior), Devin, Luis, Louie
- Specialties: Domestic & foreign, collision, mechanical, paint & body, insurance claims

YOUR PERSONALITY:
- You're the shop's right hand — confident, knowledgeable, direct
- Short clear sentences. No corporate-speak. You know cars inside and out
- Protective of the shop's money and reputation
- Proactively flag things that could cost money or lose customers

TOOLS — respond with a SINGLE raw JSON object (no markdown, no wrapping) to take action:

1. WEB SEARCH
{"tool":"webSearch","query":"2014 Chevrolet Malibu front brake pads price"}

2. CREATE CUSTOMER
{"tool":"action","action":"createCustomer","payload":{"name":"John Doe","phone":"555-1234","email":"john@example.com"}}

3. CREATE JOB
{"tool":"action","action":"createJob","payload":{"customer_name":"John Doe","vehicle_year":"2019","vehicle_make":"Toyota","vehicle_model":"Camry","status":"Pending","notes":"Front brakes squeaking"}}

4. CREATE INVOICE/ESTIMATE
{"tool":"action","action":"createInvoice","payload":{"type":"Estimate","customer_name":"John Doe","vehicle_year":"2019","vehicle_make":"Toyota","vehicle_model":"Camry","parts":[{"name":"Brake Pads","qty":1,"unitPrice":45.99,"taxable":true}],"labors":[{"operation":"Front brake replacement","hours":1.5,"rate":120}],"notes":"Front brake job"}}

5. UPDATE JOB STATUS
{"tool":"action","action":"updateJobStatus","payload":{"id":"uuid","status":"In Progress"}}

6. UPDATE CUSTOMER
{"tool":"action","action":"updateCustomer","payload":{"id":"uuid","phone":"555-9999"}}

7. VOID A DOCUMENT
{"tool":"action","action":"voidDocument","payload":{"id":"uuid"}}

8. DELETE A RECORD
{"tool":"action","action":"deleteRecord","payload":{"table":"jobs","id":"uuid"}}

9. SCHEDULE FOLLOW-UP (sms, email, or call reminder)
{"tool":"action","action":"scheduleFollowUp","payload":{"customer_name":"John Doe","channel":"sms","scheduled_for":"2025-01-15T10:00:00Z","message_body":"Hi John, just checking in on your Camry..."}}

10. GET CUSTOMER HISTORY (jobs, invoices, messages)
{"tool":"action","action":"getCustomerHistory","payload":{"customer_name":"John Doe"}}

11. GET SHOP STATS
{"tool":"action","action":"getShopStats","payload":{}}

12. PROPOSE ESTIMATE (visual card with save button)
{"tool":"proposeDocument","type":"Estimate","customer":"John Doe","vehicle":"2019 Toyota Camry","parts":[{"name":"Brake Pads","qty":1,"unitPrice":45.99}],"labors":[{"operation":"Brake replacement","hours":1.5,"rate":120}],"notes":"Front brake job"}

13. SEND MESSAGE (with confirmation)
{"tool":"message","to":"+15551234567","channel":"sms","body":"Hi, your vehicle is ready for pickup!"}
{"tool":"message","to":"john@example.com","channel":"email","subject":"Vehicle Ready","body":"Your vehicle is ready for pickup."}

14. NAVIGATE
{"tool":"navigate","view":"jobs"}

MULTI-STEP: Chain tool calls silently across up to 8 steps. Never narrate what you're about to do — just do it.

CRITICAL RULES — READ CAREFULLY:
- NEVER say "let me search", "let me check", "I'll look that up" — just output the JSON tool call directly
- NEVER explain your tool calls — execute them silently
- NEVER ask for info you don't need — if customer name/phone is given, use it
- NEVER output a tool call AND text in the same response — pick one
- When building estimates: search prices first (silently), then immediately proposeDocument with real numbers
- When asked to build a quote: do the searches, then output ONE proposeDocument with everything filled in
- Only speak in plain text when the task is fully complete OR you genuinely need missing info
- Keep final responses SHORT — one or two sentences max after completing a task`

interface HistoryEntry {
  id: string
  date: string
  preview: string
  messages: ChatMessage[]
}

export default function AIPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hey! I'm Alpha AI — your shop's command center. I can create customers, open jobs, build estimates, send texts and emails, look up anyone's history, check shop stats, schedule follow-ups, and more. What do you need?" }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [listening, setListening] = useState(false)
  const [speakEnabled, setSpeakEnabled] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [pendingSms, setPendingSms] = useState<{to:string;body:string;channel?:string;subject?:string}|null>(null)
  const [sendingSms, setSendingSms] = useState(false)
  const [toast, setToast] = useState('')
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [shopContext, setShopContext] = useState('')
  const prefillHandled = useRef(false)

  // Feature 1: TTS helper
  const speak = useCallback((text: string) => {
    if (!speakEnabled || typeof window === 'undefined') return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.95; u.pitch = 1.0
    const voices = window.speechSynthesis.getVoices()
    const natural = voices.find(v => v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Natural'))
    if (natural) u.voice = natural
    window.speechSynthesis.speak(u)
  }, [speakEnabled])

  // Feature 5: Load history from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('ai_history')
      if (stored) setHistory(JSON.parse(stored))
    } catch { /* ignore */ }
  }, [])

  const saveToHistory = useCallback((msgs: ChatMessage[]) => {
    if (msgs.length < 2) return
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      preview: msgs.find(m => m.role === 'user')?.content?.slice(0, 60) || 'Conversation',
      messages: msgs,
    }
    setHistory(prev => {
      const updated = [entry, ...prev].slice(0, 30)
      localStorage.setItem('ai_history', JSON.stringify(updated))
      return updated
    })
  }, [])

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
        msgs?.length ? `Recent messages: ${msgs.filter((m:Record<string,string>)=>m.direction==='inbound').slice(0,3).map((m:Record<string,string>)=>`"${(m.body||'').slice(0,60)}"`).join('; ')}` : '',
      ].filter(Boolean).join('\n')
      setShopContext(ctx)
    }
    loadContext()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, status])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // Auto-send prefill from dashboard AI Alert
  const sendRef = useRef<((overrideInput?: string) => Promise<void>) | null>(null)
  useEffect(() => {
    if (prefillHandled.current) return
    const prefill = localStorage.getItem('ai_prefill')
    if (prefill && sendRef.current) {
      prefillHandled.current = true
      localStorage.removeItem('ai_prefill')
      setTimeout(() => sendRef.current?.(prefill), 500)
    }
  })

  const send = useCallback(async (overrideInput?: string) => {
    const text = (overrideInput || input).trim()
    if (!text || loading) return
    if (!overrideInput) setInput('')
    setLoading(true)
    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    const history = [...messages, userMsg]
    await agentLoop(history)
    setLoading(false)
    setStatus('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, loading, messages, shopContext])

  // Keep sendRef current
  useEffect(() => { sendRef.current = send }, [send])

  // Feature 12: Send image to AI
  const sendImage = async (file: File) => {
    setLoading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = reader.result as string
      const userMsg: ChatMessage = { role: 'user', content: 'Uploaded a photo for analysis', imageUrl: base64 }
      setMessages(prev => [...prev, userMsg])
      const hist = [...messages, userMsg]

      const { data: settings } = await supabase.from('settings').select('ai_api_key,ai_model,ai_base_url').limit(1).single()
      const apiKey = settings?.ai_api_key
      if (!apiKey) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'No AI API key configured.' }])
        setLoading(false); return
      }
      setStatus('Analyzing image...')
      try {
        const res = await fetch(`${settings?.ai_base_url || 'https://openrouter.ai/api/v1'}/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'meta-llama/llama-3.2-11b-vision-instruct:free',
            messages: [
              { role: 'system', content: 'You are Alpha AI for Alpha International Auto Center. The user uploaded a photo. Analyze it in context of the auto shop. If it shows vehicle damage, describe it and suggest repair steps and estimated cost. If it shows an engine or mechanical issue, diagnose it. If it shows something else, describe what you see.' },
              { role: 'user', content: [
                { type: 'image_url', image_url: { url: base64 } },
                { type: 'text', text: 'Analyze this image for our auto shop.' }
              ]}
            ],
            max_tokens: 1500, temperature: 0.7
          })
        })
        const data = await res.json()
        const raw = data.choices?.[0]?.message?.content?.trim() || 'Could not analyze the image.'
        const assistantMsg: ChatMessage = { role: 'assistant', content: raw }
        setMessages(prev => [...prev, assistantMsg])
        speak(raw)
        saveToHistory([...hist, assistantMsg])
      } catch {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Image analysis failed. Try a different model or check your API key.' }])
      }
      setLoading(false); setStatus('')
    }
    reader.readAsDataURL(file)
  }

  const agentLoop = async (history: ChatMessage[]) => {
    const { data: settings } = await supabase.from('settings').select('ai_api_key,ai_model,ai_base_url').limit(1).single()
    const apiKey = settings?.ai_api_key
    if (!apiKey) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'No AI API key configured. Go to Settings > AI to add your OpenRouter key.' }])
      return
    }
    const accumulated: string[] = []
    for (let step = 0; step < 8; step++) {
      const systemWithContext = SYSTEM_PROMPT + (shopContext ? `\n\nCurrent shop context:\n${shopContext}` : '') + (accumulated.length ? `\n\nResearch & action results so far:\n${accumulated.join('\n')}` : '')
      const res = await fetch(`${settings?.ai_base_url || 'https://openrouter.ai/api/v1'}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings?.ai_model || 'deepseek/deepseek-v3.2',
          messages: [{ role: 'system', content: systemWithContext }, ...history.map(m => ({ role: m.role, content: m.content }))],
          max_tokens: 2000, temperature: 0.7
        })
      })
      const data = await res.json()
      const raw = data.choices?.[0]?.message?.content?.trim() || ''

      // Try to parse JSON tool call — handles code blocks, inline JSON, any wrapping
      let parsed: Record<string, unknown> | null = null
      try {
        // Strip markdown code blocks first
        let json = raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim()
        // Try direct parse
        try { parsed = JSON.parse(json) } catch {
          // Try extracting first { ... } block from response
          const match = json.match(/\{[\s\S]*\}/)
          if (match) parsed = JSON.parse(match[0])
        }
        // Only treat as tool call if it has a "tool" key
        if (parsed && !parsed.tool) parsed = null
      } catch { parsed = null }

      // ── Web Search ────────────────────────────────────────
      if (parsed?.tool === 'webSearch') {
        setStatus(`Searching: "${parsed.query}"`)
        try {
          const r = await fetch(`/api/ai-search?q=${encodeURIComponent(parsed.query as string)}`)
          const d = await r.json()
          accumulated.push(`Search "${parsed.query}":\n${d.results?.map((r: Record<string,string>) => `- ${r.title}: ${r.snippet}`).join('\n') || 'No results'}`)
        } catch { accumulated.push(`Search "${parsed.query}": No results`) }
        continue
      }

      // ── AI Action (create, update, delete, stats, history) ─
      if (parsed?.tool === 'action') {
        const actionName = parsed.action as string
        setStatus(`Executing: ${actionName}...`)
        try {
          const r = await fetch('/api/ai-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: actionName, payload: parsed.payload || {} })
          })
          const d = await r.json()
          if (d.ok) {
            accumulated.push(`Action ${actionName} succeeded: ${JSON.stringify(d.data).slice(0, 500)}`)
          } else {
            accumulated.push(`Action ${actionName} failed: ${d.error}`)
          }
        } catch (err) {
          accumulated.push(`Action ${actionName} error: ${err instanceof Error ? err.message : 'Unknown'}`)
        }
        continue
      }

      // ── Propose Document (visual card) ────────────────────
      if (parsed?.tool === 'proposeDocument') {
        const proposalHtml = renderProposal(parsed)
        const assistantMsg: ChatMessage = { role: 'assistant', content: raw, html: proposalHtml }
        setMessages(prev => [...prev, assistantMsg])
        saveToHistory([...history, assistantMsg])
        return
      }

      // ── Navigate ──────────────────────────────────────────
      if (parsed?.tool === 'navigate') {
        window.location.href = `/${parsed.view}`
        return
      }

      // ── Message (SMS/Email with confirmation) ─────────────
      if (parsed?.tool === 'message') {
        setPendingSms({
          to: parsed.to as string,
          body: parsed.body as string,
          channel: (parsed.channel as string) || 'sms',
          subject: parsed.subject as string | undefined,
        })
        const channel = (parsed.channel as string) || 'sms'
        const assistantMsg: ChatMessage = { role: 'assistant', content: `I've drafted a ${channel === 'email' ? 'email' : 'text message'}. Review it below and hit Send to deliver it.` }
        setMessages(prev => [...prev, assistantMsg])
        saveToHistory([...history, assistantMsg])
        return
      }

      // ── Plain text response (final) ───────────────────────
      const assistantMsg: ChatMessage = { role: 'assistant', content: raw }
      setMessages(prev => [...prev, assistantMsg])
      speak(raw)
      saveToHistory([...history, assistantMsg])
      return
    }
    // Exhausted all steps — summarize accumulated results
    const finalMsg: ChatMessage = { role: 'assistant', content: accumulated.length ? `Here's what I found and did:\n\n${accumulated.join('\n\n')}` : 'I completed my research but had trouble forming a response. Please try again.' }
    setMessages(prev => [...prev, finalMsg])
    speak(finalMsg.content)
    saveToHistory([...history, finalMsg])
  }

  // Send SMS/Email
  const confirmSendSms = async () => {
    if (!pendingSms) return
    setSendingSms(true)
    try {
      const res = await fetch('/api/send-message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: pendingSms.to,
          body: pendingSms.body,
          channel: pendingSms.channel || 'sms',
          subject: pendingSms.subject || undefined,
        })
      })
      if (!res.ok) throw new Error('Send failed')
      const channelLabel = pendingSms.channel === 'email' ? 'Email' : 'SMS'
      setMessages(prev => [...prev, { role: 'assistant', content: `${channelLabel} sent to ${pendingSms.to}` }])
      showToast(`${channelLabel} sent successfully!`)
    } catch { showToast('Failed to send message') }
    setPendingSms(null); setSendingSms(false)
  }

  // Feature 4: Save as draft estimate
  const saveEstimate = async (parsed: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/create-estimate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer: parsed.customer, parts: parsed.parts, labors: parsed.labors, notes: parsed.notes })
      })
      if (!res.ok) throw new Error('Failed')
      showToast('Estimate saved as draft')
      setTimeout(() => { window.location.href = '/estimates' }, 1000)
    } catch { showToast('Failed to save estimate') }
  }

  const renderProposal = (parsed: Record<string, unknown>): string => {
    const parts = (parsed.parts as Record<string,unknown>[]) || []
    const labors = (parsed.labors as Record<string,unknown>[]) || []
    const partsTotal = parts.reduce((s,p) => s + (Number(p.qty)||1)*(Number(p.unitPrice)||0), 0)
    const laborTotal = labors.reduce((s,l) => s + (Number(l.hours)||0)*(Number(l.rate)||120), 0)
    const tax = partsTotal * 0.0825
    const total = partsTotal + laborTotal + tax
    const fmt = (n: number) => '$' + n.toFixed(2)
    const encodedData = btoa(JSON.stringify(parsed))
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
        <button onclick="window.__saveEstimate && window.__saveEstimate('${encodedData}')" class="btn btn-success btn-sm">Save as Draft Estimate</button>
        <button onclick="window.location.href='/estimates'" class="btn btn-secondary btn-sm">View Estimates</button>
      </div>
    </div>`
  }

  // Feature 4: Global handler for saving estimate from HTML
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__saveEstimate = (encodedData: string) => {
      try { const parsed = JSON.parse(atob(encodedData)); saveEstimate(parsed) } catch { showToast('Failed to parse estimate data') }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => { delete (window as any).__saveEstimate }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const loadConversation = (entry: HistoryEntry) => {
    setMessages(entry.messages)
    setShowHistory(false)
  }

  const groupHistoryByDate = () => {
    const today = new Date().toDateString()
    const yesterday = new Date(Date.now() - 86400000).toDateString()
    const groups: { label: string; entries: HistoryEntry[] }[] = [
      { label: 'Today', entries: [] },
      { label: 'Yesterday', entries: [] },
      { label: 'Older', entries: [] },
    ]
    history.forEach(h => {
      const d = new Date(h.date).toDateString()
      if (d === today) groups[0].entries.push(h)
      else if (d === yesterday) groups[1].entries.push(h)
      else groups[2].entries.push(h)
    })
    return groups.filter(g => g.entries.length > 0)
  }

  const suggested = [
    "What jobs are open right now?",
    "Build me an estimate for front brakes on a 2019 Toyota Camry",
    "Who hasn't been in for 90+ days?",
    "How much revenue this month?",
    "Create a new customer: John Smith, 555-123-4567",
    "Open a new job for the white 2020 Honda Civic — AC not blowing cold",
    "What are today's shop stats?",
    "Schedule a follow-up text to remind about the oil change",
    "Draft a follow-up text for customers with unpaid invoices",
    "Who hasn't paid in over 30 days?",
    "Which tech has the most open jobs right now?",
    "Write a supplement request for an insurance job",
    "Look up everything we have on Maria Garcia",
    "Generate a slow-day outreach message",
    "Give me a Google review response",
  ]

  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-col h-screen">
      <div className="p-6 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Alpha AI</h1>
          <p className="text-sm text-text-muted mt-0.5">Full shop control · Create, update, search, message — all from here</p>
        </div>
        <div className="flex gap-2">
          {/* Feature 5: History button */}
          <button onClick={() => setShowHistory(!showHistory)} className="btn btn-secondary btn-sm" title="Conversation History">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            History
          </button>
          {/* Feature 1: Speaker toggle */}
          <button
            onClick={() => { setSpeakEnabled(!speakEnabled); if (speakEnabled) window.speechSynthesis?.cancel() }}
            className={`btn btn-sm ${speakEnabled ? 'btn-primary' : 'btn-secondary'}`}
            title={speakEnabled ? 'Voice output ON' : 'Voice output OFF'}
          >
            {speakEnabled ? '🔊' : '🔇'} Voice
          </button>
        </div>
      </div>

      {/* Feature 5: History panel */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowHistory(false)} />
          <div className="relative ml-auto w-80 bg-bg-card border-l border-border h-full overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">Chat History</h2>
              <button onClick={() => setShowHistory(false)} className="btn btn-secondary btn-sm">✕</button>
            </div>
            {history.length === 0 && <p className="text-sm text-text-muted">No conversations yet.</p>}
            {groupHistoryByDate().map(group => (
              <div key={group.label} className="mb-4">
                <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">{group.label}</p>
                {group.entries.map(entry => (
                  <button key={entry.id} onClick={() => loadConversation(entry)}
                    className="w-full text-left p-3 rounded-lg bg-bg-hover hover:bg-blue/10 mb-2 transition-colors">
                    <p className="text-sm font-medium truncate">{entry.preview}</p>
                    <p className="text-xs text-text-muted mt-1">{new Date(entry.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl">
            <p className="text-xs text-text-muted font-semibold uppercase tracking-wider mb-1 col-span-full">Try asking:</p>
            {suggested.map(s => (
              <button key={s} onClick={() => { setInput(s); send(s) }}
                className="text-left text-sm bg-bg-card border border-border rounded-lg px-4 py-2.5 hover:border-blue/50 hover:bg-bg-hover transition-all">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${m.role === 'user' ? 'bg-blue text-white' : 'bg-bg-card border border-border'}`}>
              {/* Feature 12: Image preview */}
              {m.imageUrl && (
                <div className="mb-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.imageUrl} alt="Uploaded" className="rounded-lg max-w-[200px] max-h-[150px] object-cover" />
                </div>
              )}
              {m.html ? <div dangerouslySetInnerHTML={{ __html: m.html }} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
            </div>
          </div>
        ))}

        {/* SMS/Email confirmation card */}
        {pendingSms && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-bg-card border border-blue/30 rounded-xl px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wider text-blue mb-2">
                Draft {pendingSms.channel === 'email' ? 'Email' : 'SMS'}
              </p>
              <p className="text-sm text-text-secondary mb-1">To: {pendingSms.to}</p>
              {pendingSms.subject && <p className="text-sm text-text-secondary mb-1">Subject: {pendingSms.subject}</p>}
              <div className="bg-bg-hover rounded-lg p-3 text-sm mb-3">{pendingSms.body}</div>
              <div className="flex gap-2">
                <button onClick={confirmSendSms} disabled={sendingSms} className="btn btn-primary btn-sm">{sendingSms ? 'Sending...' : 'Send Now'}</button>
                <button onClick={() => setPendingSms(null)} className="btn btn-secondary btn-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}

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
            placeholder="Ask anything — or tell me to create, update, message, search..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          />
          {/* Feature 12: Photo button */}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) sendImage(f); e.target.value = '' }} />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Upload photo for analysis"
            className="flex items-center justify-center w-10 h-10 rounded-xl border bg-bg-card border-border text-text-muted hover:border-blue/50 hover:text-blue transition-all flex-shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          </button>
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
            onClick={() => send()}
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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-green/90 text-white px-4 py-2 rounded-lg text-sm font-medium z-50 animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  )
}
