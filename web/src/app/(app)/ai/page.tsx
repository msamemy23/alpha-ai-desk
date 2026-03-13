'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface VoiceCallState {
  callId: string
  to: string
  task: string
  status: 'dialing' | 'active' | 'ended' | 'error'
  summary?: string
  transcript?: Array<{speaker: string; text: string}>
  duration?: number
  recording_url?: string
}

interface ChatMessage { role: 'user'|'assistant'; content: string; html?: string; imageUrl?: string }

const SYSTEM_PROMPT = `You are Alpha AI — the fully autonomous command center for Alpha International Auto Center.

SHOP INFO:
- Name: Alpha International Auto Center | 10710 S Main St, Houston TX 77025
- Phone: (713) 663-6979 | Labor Rate: $120/hr | Tax Rate: 8.25%
- Payment: Cash, Card, Zelle, Cash App
- Technicians: Paul (senior), Devin, Luis, Louie

PERSONALITY: Confident, direct, knowledgeable. Short sentences. You know cars inside and out.

HOW YOU WORK:
You receive a task. You think through ALL steps internally. You execute them one at a time using JSON tool calls. When everything is done, you give ONE final plain-text response confirming what was completed.

You NEVER show your thinking to the user. You NEVER narrate steps. You work silently and report when done.

TOOL CALLS — respond with ONLY a raw JSON object, no markdown, no code blocks, no extra text:

WEB SEARCH:
{"tool":"webSearch","query":"2007 Honda Civic lower control arm price"}

CREATE CUSTOMER:
{"tool":"action","action":"createCustomer","payload":{"name":"John Doe","phone":"555-1234","email":""}}

CREATE JOB:
{"tool":"action","action":"createJob","payload":{"customer_name":"John Doe","vehicle_year":"2019","vehicle_make":"Toyota","vehicle_model":"Camry","status":"Pending","notes":"Front brakes squeaking"}}

CREATE ESTIMATE (visual card):
{"tool":"proposeDocument","type":"Estimate","customer":"John Doe","vehicle":"2019 Toyota Camry","parts":[{"name":"Brake Pads Front","qty":1,"unitPrice":45.99},{"name":"Rotors Front Pair","qty":1,"unitPrice":89.99}],"labors":[{"operation":"Front brake replacement","hours":1.5,"rate":120}],"notes":"Standard brake job"}

CREATE INVOICE:
{"tool":"action","action":"createInvoice","payload":{"type":"Invoice","customer_name":"John Doe","vehicle_year":"2019","vehicle_make":"Toyota","vehicle_model":"Camry","parts":[{"name":"Brake Pads","qty":1,"unitPrice":45.99,"taxable":true}],"labors":[{"operation":"Brake replacement","hours":1.5,"rate":120}],"notes":""}}

UPDATE JOB STATUS:
{"tool":"action","action":"updateJobStatus","payload":{"customer_name":"John Doe","status":"Ready for Pickup"}}

UPDATE CUSTOMER:
{"tool":"action","action":"updateCustomer","payload":{"name":"John Doe","phone":"555-9999"}}

VOID DOCUMENT:
{"tool":"action","action":"voidDocument","payload":{"doc_number":"EST-2025-0001"}}

SCHEDULE FOLLOW-UP:
{"tool":"action","action":"scheduleFollowUp","payload":{"customer_name":"John Doe","channel":"sms","scheduled_for":"2025-01-15T10:00:00Z","message_body":"Hi John, just checking in..."}}

GET CUSTOMER HISTORY:
{"tool":"action","action":"getCustomerHistory","payload":{"customer_name":"John Doe"}}

GET SHOP STATS:
{"tool":"action","action":"getShopStats","payload":{}}

SEND MESSAGE (shows confirmation card):
{"tool":"message","to":"+15551234567","channel":"sms","body":"Hi, your vehicle is ready!"}

PLACE PHONE CALL — connects the user directly to someone (you are NOT on the call):
{"tool":"call","to":"+15551234567","name":"Customer Name"}
Use when user says: "call 2819008141", "call John", "dial this number", "ring them" — just a number or name with no task attached.
NEVER use message tool for a call request.

AI VOICE CALL — AI calls someone and has a FULL CONVERSATION to complete a task (you ARE the caller):
{"tool":"aiVoiceCall","to":"+15551234567","task":"Tell them their car is ready for pickup","callerName":"Alpha International Auto Center"}
Use when user says things like:
- "call John and tell him his car is ready"
- "call 2819008141 and ask if their heart is still free"
- "have AI call AutoZone and order the part"
- "call [number/name] and [do/say/ask something]"
The KEY difference: if there is a MESSAGE or TASK to deliver/handle, use aiVoiceCall. If it's just "call X" with no task, use call.

NAVIGATE:
{"tool":"navigate","view":"jobs"}

RULES:
1. Think through the full plan before starting
2. Execute each step silently — ONE tool call per turn, no explanation text
3. NEVER output text AND a tool call together — pick one
4. For quotes: search part prices first (silently), then proposeDocument with real numbers
5. For new customers: createCustomer first, then continue
6. When ALL steps done: respond in plain text — 1-3 sentences max confirming what was completed
7. NEVER ask for info already in the conversation
8. Confirm destructive actions (void, delete) before executing`

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
  const [voiceCall, setVoiceCall] = useState<VoiceCallState | null>(null)
  const voicePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [jumpingIn, setJumpingIn] = useState(false)
  const [jumpInPhone, setJumpInPhone] = useState('')
  const [showJumpIn, setShowJumpIn] = useState(false)
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

    // AI voice call detection — "AI call", "call [business] and order/ask", "have AI call"
    const aiCallMatch = text.match(/(?:ai\s+call|have\s+(?:the\s+)?ai\s+call|call\s+\w+\s+(?:and|to)\s+(?:order|ask|find|check|get|buy|order|inquire))/i)
    if (aiCallMatch || /\bcall\b.*\b(?:autozone|napa|oreilly|o'reilly|advance|pepboys|store|shop|dealership|dealer|supplier)\b/i.test(text)) {
      // Let the AI handle it — it will use aiVoiceCall tool
    } else {
      // Direct call detection — bypass AI for plain "call XXXXXXXXXX"
    }

    // Direct call detection — bypass AI for explicit call commands
    const callMatch = text.match(/^(?:call|dial|phone|ring)\s+([\d\s\-\(\)\+]+)/i)
    if (callMatch) {
      const phone = callMatch[1].replace(/\s/g, '')
      setStatus('Calling...')
      try {
        const r = await fetch('/api/make-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: phone, name: phone })
        })
        const d = await r.json()
        const msg: ChatMessage = d.ok
          ? { role: 'assistant', content: `Call placed to ${phone}. Dialing now.` }
          : { role: 'assistant', content: `Call failed: ${d.error}` }
        setMessages(prev => [...prev, msg])
      } catch (err) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Call error: ${err instanceof Error ? err.message : 'Unknown'}` }])
      }
      setLoading(false)
      setStatus('')
      return
    }

    const history2 = [...messages, userMsg]
    await agentLoop(history2)
    setLoading(false)
    setStatus('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, loading, messages, shopContext])

  // Poll for voice call status/summary
  const startVoicePoll = useCallback((callId: string) => {
    if (voicePollRef.current) clearInterval(voicePollRef.current)
    voicePollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/call-summary/${callId}`)
        const d = await r.json()
        if (d.ok) {
          setVoiceCall(prev => prev ? {
            ...prev,
            status:        d.status,
            summary:       d.summary,
            transcript:    d.transcript,
            duration:      d.duration,
            recording_url: d.recording_url || prev.recording_url,
          } : null)
          if (d.status === 'ended') {
            if (voicePollRef.current) clearInterval(voicePollRef.current)
            // Add summary to chat
            const summaryMsg: ChatMessage = {
              role: 'assistant',
              content: '',
              html: renderVoiceSummary(d)
            }
            setMessages(prev => [...prev, summaryMsg])
          }
        }
      } catch { /* ignore poll errors */ }
    }, 3000)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    const agentMessages: {role: string; content: string}[] = history.map(m => ({ role: m.role, content: m.content }))

    for (let step = 0; step < 10; step++) {
      const systemWithContext = SYSTEM_PROMPT +
        (shopContext ? `\n\nLive shop context:\n${shopContext}` : '') +
        (accumulated.length ? `\n\nCompleted steps so far:\n${accumulated.join('\n')}` : '')

      setStatus(step === 0 ? 'Thinking...' : 'Working...')

      const res = await fetch(`${settings?.ai_base_url || 'https://openrouter.ai/api/v1'}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings?.ai_model || 'deepseek/deepseek-chat-v3-0324',
          messages: [{ role: 'system', content: systemWithContext }, ...agentMessages],
          max_tokens: 2000,
          temperature: 0.3,
        })
      })

      const data = await res.json()
      if (data.error) {
        const errMsg: ChatMessage = { role: 'assistant', content: `Error: ${data.error.message || JSON.stringify(data.error)}` }
        setMessages(prev => [...prev, errMsg])
        return
      }

      const raw = data.choices?.[0]?.message?.content?.trim() || ''

      // Parse JSON tool call — strip code blocks, extract JSON
      let parsed: Record<string, unknown> | null = null
      try {
        const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
        try { parsed = JSON.parse(cleaned) } catch {
          const match = cleaned.match(/\{[\s\S]*"tool"[\s\S]*\}/)
          if (match) { try { parsed = JSON.parse(match[0]) } catch { parsed = null } }
        }
        if (parsed && !parsed.tool) parsed = null
      } catch { parsed = null }

      // No tool call = final answer — show to user
      if (!parsed) {
        const assistantMsg: ChatMessage = { role: 'assistant', content: raw }
        setMessages(prev => [...prev, assistantMsg])
        speak(raw)
        saveToHistory([...history, assistantMsg])
        return
      }

      // Web Search — execute silently, feed result back to AI
      if (parsed.tool === 'webSearch') {
        setStatus('Searching...')
        let searchResult = 'No results'
        try {
          const r = await fetch(`/api/ai-search?q=${encodeURIComponent(parsed.query as string)}`)
          const d = await r.json()
          searchResult = d.results?.slice(0, 6).map((r: Record<string,string>) => `- ${r.title}: ${r.snippet}`).join('\n') || 'No results'
        } catch { searchResult = 'Search failed' }
        accumulated.push(`[Search: "${parsed.query}"]\n${searchResult}`)
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: `Search results for "${parsed.query}":\n${searchResult}\n\nContinue to the next step silently.` })
        continue
      }

      // DB Action — execute silently, feed result back to AI
      if (parsed.tool === 'action') {
        const actionName = parsed.action as string
        setStatus('Processing...')
        let actionResult = ''
        try {
          const r = await fetch('/api/ai-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: actionName, payload: parsed.payload || {} })
          })
          const d = await r.json()
          actionResult = d.ok ? `Success: ${JSON.stringify(d.data).slice(0, 300)}` : `Failed: ${d.error}`
        } catch (err) {
          actionResult = `Error: ${err instanceof Error ? err.message : 'Unknown'}`
        }
        accumulated.push(`[${actionName}]: ${actionResult}`)
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: `Action "${actionName}" result: ${actionResult}\n\nContinue to the next step silently.` })
        continue
      }

      // Propose Document — show visual estimate card
      if (parsed.tool === 'proposeDocument') {
        const proposalHtml = renderProposal(parsed)
        const assistantMsg: ChatMessage = { role: 'assistant', content: '', html: proposalHtml }
        setMessages(prev => [...prev, assistantMsg])
        saveToHistory([...history, assistantMsg])
        return
      }

      // AI Voice Call — dials with bidirectional streaming, AI handles conversation
      if (parsed.tool === 'aiVoiceCall') {
        setStatus('Initiating AI voice call...')
        try {
          const r = await fetch('/api/ai-voice-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: parsed.to,
              task: parsed.task || 'Have a helpful conversation',
              callerName: parsed.callerName || 'Alpha International Auto Center'
            })
          })
          const d = await r.json()
          if (d.ok) {
            const callState: VoiceCallState = {
              callId: d.callId,
              to: d.to,
              task: parsed.task as string || '',
              status: 'dialing',
            }
            setVoiceCall(callState)
            startVoicePoll(d.callId)
            const assistantMsg: ChatMessage = {
              role: 'assistant',
              content: '',
              html: renderVoiceCallCard(callState)
            }
            setMessages(prev => [...prev, assistantMsg])
          } else {
            const assistantMsg: ChatMessage = { role: 'assistant', content: `AI voice call failed: ${d.error}` }
            setMessages(prev => [...prev, assistantMsg])
          }
        } catch (err) {
          const assistantMsg: ChatMessage = { role: 'assistant', content: `Voice call error: ${err instanceof Error ? err.message : 'Unknown'}` }
          setMessages(prev => [...prev, assistantMsg])
        }
        return
      }

      // Place Phone Call — dials immediately via Telnyx
      if (parsed.tool === 'call') {
        setStatus('Calling...')
        try {
          const r = await fetch('/api/make-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: parsed.to, name: parsed.name })
          })
          const d = await r.json()
          if (d.ok) {
            const assistantMsg: ChatMessage = { role: 'assistant', content: `Call placed to ${parsed.name || parsed.to}. Ringing now.` }
            setMessages(prev => [...prev, assistantMsg])
            saveToHistory([...history, assistantMsg])
          } else {
            const assistantMsg: ChatMessage = { role: 'assistant', content: `Call failed: ${d.error}` }
            setMessages(prev => [...prev, assistantMsg])
          }
        } catch (err) {
          const assistantMsg: ChatMessage = { role: 'assistant', content: `Call error: ${err instanceof Error ? err.message : 'Unknown'}` }
          setMessages(prev => [...prev, assistantMsg])
        }
        return
      }

      // Navigate
      if (parsed.tool === 'navigate') {
        window.location.href = `/${parsed.view as string}`
        return
      }

      // Message — show draft confirmation card
      if (parsed.tool === 'message') {
        setPendingSms({
          to: parsed.to as string,
          body: parsed.body as string,
          channel: (parsed.channel as string) || 'sms',
          subject: parsed.subject as string | undefined,
        })
        const channel = (parsed.channel as string) || 'sms'
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: `Draft ${channel === 'email' ? 'email' : 'text'} ready — review below and hit Send.`
        }
        setMessages(prev => [...prev, assistantMsg])
        saveToHistory([...history, assistantMsg])
        return
      }

      // Unknown — treat as final response
      const assistantMsg: ChatMessage = { role: 'assistant', content: raw }
      setMessages(prev => [...prev, assistantMsg])
      speak(raw)
      saveToHistory([...history, assistantMsg])
      return
    }

    // Max steps reached
    const finalMsg: ChatMessage = {
      role: 'assistant',
      content: accumulated.length
        ? `Done. Completed ${accumulated.length} steps.`
        : 'Had trouble completing that. Please try again.'
    }
    setMessages(prev => [...prev, finalMsg])
    speak(finalMsg.content)
    saveToHistory([...history, finalMsg])
  }

  // Voice call status card
  const renderVoiceCallCard = (state: VoiceCallState): string => {
    const statusColors: Record<string, string> = {
      dialing: '#f59e0b',
      active: '#10b981',
      ended: '#6b7280',
      error: '#ef4444',
    }
    const color = statusColors[state.status] || '#6b7280'
    const statusLabel = state.status.charAt(0).toUpperCase() + state.status.slice(1)
    return `<div class="voice-call-card" style="border:1px solid ${color};border-radius:12px;padding:12px;background:var(--bg-card,#1a1a2e)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block${state.status==='active'?' animation:pulse 1s infinite':''};"></span>
        <strong>AI Voice Call</strong>
        <span style="color:${color};font-size:0.75rem;margin-left:auto">${statusLabel}</span>
      </div>
      <div style="font-size:0.8rem;color:#9ca3af">Calling: ${state.to}</div>
      <div style="font-size:0.8rem;margin-top:4px">${state.task}</div>
      <div style="font-size:0.75rem;color:#6b7280;margin-top:6px">AI is handling the conversation. Summary will appear when the call ends.</div>
    </div>`
  }

  // Voice call summary card (shown after call ends)
  const renderVoiceSummary = (d: {summary?: string; transcript?: Array<{speaker:string;text:string}>; duration?: number; to?: string; recording_url?: string}): string => {
    const lines = (d.transcript || []).map(t =>
      `<div style="margin:3px 0;font-size:0.8rem"><span style="color:${t.speaker==='ai'?'#60a5fa':'#a3e635'};font-weight:600">${t.speaker==='ai'?'AI':'Person'}:</span> ${t.text}</div>`
    ).join('')
    const dur = d.duration ? `${Math.floor(d.duration/60)}m ${d.duration%60}s` : ''
    // Use the proxy route so the recording is always accessible (S3 presigned URLs expire in 10min)
    const proxyUrl = d.recording_url
      ? `/api/recording-proxy?url=${encodeURIComponent(d.recording_url)}`
      : ''
    const recordingBlock = proxyUrl
      ? `<div style="margin-bottom:12px">
          <div style="font-size:0.75rem;color:#9ca3af;margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Call Recording</div>
          <audio controls style="width:100%;border-radius:8px">
            <source src="${proxyUrl}" type="audio/mpeg">
            Your browser does not support audio playback.
          </audio>
          <a href="${proxyUrl}" download="call-recording.mp3" style="display:inline-block;margin-top:4px;font-size:0.75rem;color:#60a5fa">Download MP3</a>
        </div>`
      : ''
    return `<div style="border:1px solid #374151;border-radius:12px;padding:16px;background:var(--bg-card,#1a1a2e)">
      <div style="font-weight:700;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span>📞 AI Call Summary</span>
        <span style="font-size:0.75rem;color:#9ca3af">${dur}</span>
      </div>
      ${recordingBlock}
      ${d.summary ? `<div style="background:#0f172a;border-radius:8px;padding:10px;margin-bottom:10px;font-size:0.85rem;white-space:pre-wrap">${d.summary}</div>` : ''}
      ${lines ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:0.8rem;color:#6b7280">Full Transcript</summary><div style="margin-top:8px;padding:8px;background:#111827;border-radius:8px">${lines}</div></details>` : ''}
    </div>`
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
      const channelLabel = pendingSms.channel === 'email' ? 'Email' : 'SMS'
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        const errMsg = errData.error || 'Send failed'
        setMessages(prev => [...prev, { role: 'assistant', content: `Failed to send ${channelLabel}: ${errMsg}` }])
        showToast(`Failed to send ${channelLabel}: ${errMsg}`)
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `${channelLabel} sent to ${pendingSms.to}` }])
        showToast(`${channelLabel} sent successfully!`)
      }
    } catch (e) {
      showToast('Failed to send message: ' + (e instanceof Error ? e.message : 'Unknown error'))
    }
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
      <div className="p-3 sm:p-6 border-b border-border flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold">Alpha AI</h1>
          <p className="text-xs sm:text-sm text-text-muted mt-0.5 truncate">Full shop control · Create, update, search, message — all from here</p>
        </div>
        <div className="flex gap-2 shrink-0">
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

      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4">
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
            <div className={`max-w-[90%] sm:max-w-[80%] rounded-xl px-4 py-3 text-sm ${m.role === 'user' ? 'bg-blue text-white' : 'bg-bg-card border border-border'}`}>
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

        {/* Live AI Voice Call Panel */}
        {voiceCall && voiceCall.status !== 'ended' && (
          <div className="flex justify-start">
            <div className="max-w-[90%] w-full bg-bg-card border border-green/40 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${voiceCall.status === 'active' ? 'bg-green animate-pulse' : 'bg-yellow-400 animate-pulse'}`} />
                <span className="font-bold text-sm">AI Voice Call</span>
                <span className="ml-auto text-xs text-text-muted">{voiceCall.status === 'active' ? 'Live' : 'Dialing...'}</span>
              </div>
              <div className="text-xs text-text-muted mb-1">Calling: {voiceCall.to}</div>
              <div className="text-sm mb-3">{voiceCall.task}</div>

              {/* Live Transcript */}
              {voiceCall.transcript && voiceCall.transcript.length > 0 && (
                <div className="bg-bg-hover rounded-lg p-3 mb-3 max-h-40 overflow-y-auto">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Live Transcript</p>
                  {voiceCall.transcript.map((t, i) => (
                    <div key={i} className="text-xs mb-1">
                      <span className={`font-bold ${t.speaker === 'ai' ? 'text-blue-400' : 'text-green-400'}`}>
                        {t.speaker === 'ai' ? 'AI: ' : 'Person: '}
                      </span>
                      {t.text}
                    </div>
                  ))}
                </div>
              )}

              {/* Jump In */}
              {voiceCall.status === 'active' && (
                <div>
                  {!showJumpIn ? (
                    <button
                      onClick={() => setShowJumpIn(true)}
                      className="btn btn-secondary btn-sm text-xs"
                    >
                      📲 Jump Into Call
                    </button>
                  ) : (
                    <div className="flex gap-2 items-center">
                      <input
                        type="tel"
                        placeholder="Your phone number"
                        value={jumpInPhone}
                        onChange={e => setJumpInPhone(e.target.value)}
                        className="form-input text-sm flex-1"
                      />
                      <button
                        onClick={async () => {
                          if (!jumpInPhone) return
                          setJumpingIn(true)
                          try {
                            const r = await fetch(`/api/voice-join/${voiceCall.callId}`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ ownerPhone: jumpInPhone }),
                            })
                            const d = await r.json()
                            showToast(d.ok ? `Dialing ${jumpInPhone} to join call...` : `Failed: ${d.error}`)
                            if (d.ok) setShowJumpIn(false)
                          } catch { showToast('Jump-in failed') }
                          setJumpingIn(false)
                        }}
                        disabled={jumpingIn}
                        className="btn btn-primary btn-sm text-xs flex-shrink-0"
                      >
                        {jumpingIn ? 'Dialing...' : 'Call Me'}
                      </button>
                      <button onClick={() => setShowJumpIn(false)} className="btn btn-secondary btn-sm text-xs">✕</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

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
