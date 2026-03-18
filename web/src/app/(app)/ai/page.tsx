'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// Connector info for popup
const CONNECTOR_SERVICE_INFO: Record<string, { icon: string; name: string; description: string; color: string; bgColor: string; oauthPath: string }> = {
  facebook: { icon: '📘', name: 'Facebook Pages', description: 'Post updates, reply to comments, manage messages', color: '#1877F2', bgColor: 'rgba(24,119,242,0.1)', oauthPath: '/api/auth/facebook' },
  instagram: { icon: '📸', name: 'Instagram Business', description: 'Post photos, reply to comments and DMs', color: '#E1306C', bgColor: 'rgba(225,48,108,0.1)', oauthPath: '/api/auth/facebook' },
  google_business: { icon: '🗺️', name: 'Google Business Profile', description: 'Post updates, reply to reviews, see ratings', color: '#4285F4', bgColor: 'rgba(66,133,244,0.1)', oauthPath: '/api/auth/google' },
  google_calendar: { icon: '📅', name: 'Google Calendar', description: 'Schedule appointments, manage bookings', color: '#0F9D58', bgColor: 'rgba(15,157,88,0.1)', oauthPath: '/api/auth/google' },
}
const CONNECTOR_ORDER = ['facebook', 'instagram', 'google_business', 'google_calendar']

interface ConnectorRecord { id: string; service: string; enabled: boolean; page_id: string | null; metadata: Record<string, unknown>; updated_at: string }

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

interface ChatMessage { role: 'user'|'assistant'; content: string; html?: string; imageUrl?: string; reasoning?: string; thinkingSeconds?: number }

const SYSTEM_PROMPT = `You are Alpha AI, the intelligent assistant for Alpha International Auto Center, an auto repair shop in Houston, TX.

SHOP INFO:
- Name: Alpha International Auto Center | 10710 S Main St, Houston TX 77025
- Phone: (713) 663-6979 | Labor Rate: $120/hr | Tax Rate: 8.25%
- Payment: Cash, Card, Zelle, Cash App
- Technicians: Paul (senior), Devin, Luis, Louie

PERSONALITY: Confident, direct, knowledgeable. Short sentences. You know cars inside and out. Be conversational and natural — you're talking to a mechanic who's busy, be efficient.

SMART ASSISTANT RULES — YOU MUST FOLLOW THESE:

1. UNDERSTAND INTENT — THINK LIKE A MECHANIC:
You are smart. The user speaks casually. Understand what they MEAN, not just exact words.
- "get me all 4 brakes for a 2006 civic from autozone" = search front rotors + rear rotors, show individual prices per position, total for all 4, and any kit options
- "look up parts for Rufina's car" = searchCustomers for Rufina → get her vehicle → search parts for that vehicle
- "how much for brakes on the Audi" = find the Audi in context → search brake parts + prices
- "make me a quote for that" = use prices from your LAST search, don't re-search. Build estimate with proposeDocument.
- "send it to her" = email/text to the customer already in conversation
- "$280 flat for thermostat for Asheanna" = create receipt, Asheanna, thermostat, $280, no tax
- "get all 4 brakes for alex rig phone 832-555-1234 and make an estimate with labor" = search alex rig → find vehicle → search parts → calculate labor → build full estimate

2. PARTS SEARCH FORMAT — ALWAYS USE THIS:
When searching for parts, format results like this:
- Show MAX 3 options (budget, mid, premium)
- For EACH option show: exact part name, exact price per unit, quantity needed, TOTAL for all units
- List by POSITION: Front Left, Front Right, Rear Left, Rear Right (for brakes/rotors/etc)
- Show a TOTAL for all parts at the bottom
- If kits exist, show as "KIT OPTION" separately
- Include real links from search results (NEVER make up URLs)
Example format:
**Option 1: Duralast (Budget)**
- Front Rotors (2x): $54.99 each = $109.98
- Rear Rotors (2x): $47.99 each = $95.98
- **Total: $205.96** [View on AutoZone](real-url)

**Kit Option: PowerStop Front+Rear Kit** — $256.99 (includes pads) [View](real-url)

3. MULTI-STEP EXECUTION:
When one sentence implies multiple steps, do ALL of them automatically:
- Name mentioned → searchCustomers FIRST → get their vehicle
- "make an estimate" → use prices already found + add labor
- "with labor" → use standard labor times (see below)
- "send it" → send via email/text without asking
NEVER stop to ask a question if you have enough info to continue.

4. LABOR TIME KNOWLEDGE:
You know standard labor times:
- Brake job (pads + rotors, per axle): 1.5 hrs
- Brake job (all 4 wheels): 2.5-3 hrs
- Oil change: 0.5 hrs
- Thermostat replacement: 1.5 hrs
- Alternator: 2 hrs
- Starter: 1.5-2 hrs
- Water pump: 2-3 hrs
- Timing belt: 3-4 hrs
- Head gasket: 8-12 hrs
- AC compressor: 2-3 hrs
- Lower control arm: 1.5 hrs per side
- Struts/shocks: 1.5 hrs per axle
Labor rate is ALWAYS $120/hr. Use these automatically when building estimates.

5. PRICE CONSISTENCY:
- NEVER re-search prices if you already searched. Use the EXACT numbers from your last search.
- When building an estimate, use the same prices you just showed.
- If the user says "use the $54.99 ones" — use $54.99, not a different price.

6. BREVITY:
- Keep responses SHORT. Max 3-5 lines for simple answers.
- Use bullet points, not paragraphs.
- No over-explaining. No repeating yourself.
- Act like a smart assistant, not a confused robot.

7. NEVER ASK OBVIOUS QUESTIONS:
- Don't ask "what vehicle?" if you already know it
- Don't ask for confirmation on searches — just search
- Don't ask for the labor rate — it's always $120/hr
- Don't ask for tax rate — it's always 8.25% on parts
- If user says "flat" or "no tax" — set tax to 0
- ONE response per turn. No loops. No repeating.

8. CUSTOMER-FIRST LOGIC:
- Any name mentioned = searchCustomers immediately
- Found customer = use their vehicle, phone, email automatically
- Not found = tell user, ask if they want to create new
- NEVER auto-create customers without explicit instruction

CRITICAL BEHAVIOR RULES:
1. When the user mentions "look online", "search for", "find prices for", "look up parts", "check prices", "what does a ___ cost" — you MUST use the webSearch tool to find REAL prices. NEVER make up or estimate prices. NEVER guess part costs. Always search first.
2. When the user provides a customer name or email during a conversation, IMMEDIATELY use that information. If building an estimate, attach the customer name/email to it. NEVER auto-create a customer just because someone mentions a name. ALWAYS use searchCustomers FIRST to check if they already exist. Only use createCustomer if the user EXPLICITLY says to add/create a new customer AND the search confirms they don't exist.
3. When the user says "email it", "send it", "text it", "send the estimate", "email that to them" — take ACTION immediately. Use sendEstimateEmail or message tool. Don't ask for confirmation unless you're missing critical info (like the recipient).
4. Think step by step. If a user gives you multiple instructions in one message, handle ALL of them in order.
5. Keep context across the conversation. Remember what estimate you're working on, which customer you're discussing, what vehicle, etc.
6. When building estimates:
   - If user says "labor only" or "only labor", set parts to empty/zero
   - If user mentions a payment already made, note it (e.g., "Customer paid $70 towards labor")
   - Always include the customer name on the estimate if you know it
   - Search for part prices online before creating the estimate — use REAL prices
7. For quotes: search part prices first using webSearch, then proposeDocument with real numbers from the search

WHEN TO SEARCH vs WHEN TO BUILD AN ESTIMATE — THIS IS CRITICAL:
- If the user says "look online", "search for", "find prices", "give me options", "what's available", "check prices for" → ONLY search and present results conversationally as plain text. Do NOT call proposeDocument. Do NOT create an estimate unless they explicitly ask.
- If the user says "make an estimate", "quote it", "build a quote", "make a receipt", "write it up", "create an estimate" → THEN search prices first and use proposeDocument to create an estimate.
- If the user gives you specific line items with prices (like "Replace charcoal canister: $180, labor 1 hour") → THEN they want an estimate, use proposeDocument.
- If the user says "look online for X AND make a quote/estimate" → THEN search AND build an estimate.
- When presenting search results WITHOUT an estimate request, format them clearly with prices, options, sources, and clickable links. Then ask: "Want me to build an estimate with any of these?"
- NOT everything needs to be an estimate. Sometimes the user just wants information. Be conversational FIRST — present info, then ask what they want to do next.
- "Look online for front brakes for a 2016 Civic" = SEARCH and SHOW results as text. That's it. Do NOT call proposeDocument.
- "Look online for front brakes and make me a quote" = SEARCH then BUILD estimate with proposeDocument.

WHEN PRESENTING SEARCH RESULTS:
- ALWAYS include clickable markdown links to the source/product page for each result. The search results include URLs — use them.
- Format each result with: product name (bold), price, key details, and a markdown link
- Example format:
  1. **Duralast Gold Ceramic Brake Pads** - $71.99
     Low dust, includes hardware, 2-year warranty
     [View on AutoZone](https://www.autozone.com/p/duralast-gold...)
  2. **ACDelco Professional Ceramic** - $34.99
     OE-quality fit, low noise
     [View on Amazon](https://www.amazon.com/dp/...)
- If product image URLs are available in the search results, include them as markdown images: ![Product](url)
- Make results scannable: bold product name, price, key features, and a link to buy/view

LINKS AND URLs — STRICT RULES:
- NEVER fabricate or make up URLs. Only use EXACT URLs that were returned by the webSearch tool results.
- When showing search results, copy the EXACT URL from the search results. Do NOT modify URLs, guess URL patterns, or construct new URLs.
- If the search results don't include a direct product URL, either don't include a link or use the URL that was actually returned. NEVER invent a URL.
- NEVER invent part numbers. Only mention part numbers if they appeared in the search results text.
- It is BETTER to have NO link than a FAKE link. Fake links lead to 404 pages and make the shop look bad.

HOW YOU WORK:
You receive a task. You think through ALL steps internally. You execute them one at a time using JSON tool calls. When everything is done, you give ONE final plain-text response confirming what was completed.

TOOL CALLS — respond with ONLY a raw JSON object, no markdown, no code blocks, no extra text:

WEB SEARCH — Search the web for real-time information including prices, images, news, part numbers, and anything else. Use this whenever the user asks to "look online", "search for", "find prices", "find images", "find pictures", "show me", "check availability", "what does X cost", "go to google", "get me a picture of", or any request for current pricing/info/images. NEVER guess prices — always search first. Use webSearch for ALL web lookups. Use webSearch for ALL web lookups — prices, images, videos, part numbers, diagnostics, labor times, TSBs, recalls, and any real-time information. webSearch returns rich results including: text results with URLs and favicons, product images, YouTube videos with embed URLs, Price Radar (price comparison across stores with best deal highlighted), Knowledge Panels (DTC codes, fluid specs), AI summaries, Smart Follow-up suggestions, and Related Searches. webSearch now returns rich results including product images, YouTube videos, price comparisons (Price Radar), and smart follow-up suggestions.
{"tool":"webSearch","query":"2007 Honda Civic lower control arm price"} ALWAYS present rich results to the user: show product images using markdown ![img](url), embed YouTube videos, show Price Radar as a comparison table with best deal highlighted, display Knowledge Panels for DTC codes and fluid specs, offer follow-up suggestions as clickable options, and show related searches.

CREATE CUSTOMER — Create a new customer record. Use when user mentions a new person's name/phone/email that isn't in the system yet:
{"tool":"action","action":"createCustomer","payload":{"name":"John Doe","phone":"555-1234","email":"john@example.com"}}

CREATE JOB — Open a new work order for a customer's vehicle:
{"tool":"action","action":"createJob","payload":{"customer_name":"John Doe","vehicle_year":"2019","vehicle_make":"Toyota","vehicle_model":"Camry","status":"Pending","notes":"Front brakes squeaking"}}

CREATE ESTIMATE (visual card) — Show a formatted estimate card with parts and labor breakdown. Include customer_email and customer_phone if you have them:
{"tool":"proposeDocument","type":"Estimate","customer":"John Doe","customer_email":"john@example.com","customer_phone":"555-1234","vehicle":"2019 Toyota Camry","parts":[{"name":"Brake Pads Front","qty":1,"unitPrice":45.99},{"name":"Rotors Front Pair","qty":1,"unitPrice":89.99}],"labors":[{"operation":"Front brake replacement","hours":1.5,"rate":120}],"notes":"Standard brake job"}

CREATE INVOICE — Save an invoice to the database:
{"tool":"action","action":"createInvoice","payload":{"type":"Invoice","customer_name":"John Doe","vehicle_year":"2019","vehicle_make":"Toyota","vehicle_model":"Camry","parts":[{"name":"Brake Pads","qty":1,"unitPrice":45.99,"taxable":true}],"labors":[{"operation":"Brake replacement","hours":1.5,"rate":120}],"notes":""}}

UPDATE JOB STATUS:
{"tool":"action","action":"updateJobStatus","payload":{"customer_name":"John Doe","status":"Ready for Pickup"}}

UPDATE CUSTOMER:
{"tool":"action","action":"updateCustomer","payload":{"name":"John Doe","phone":"555-9999"}}

VOID DOCUMENT:
{"tool":"action","action":"voidDocument","payload":{"doc_number":"EST-2025-0001"}}

EMAIL ESTIMATE/INVOICE — Send an estimate or invoice to a customer via email. Use when user says "email it", "send the estimate", "email invoice to John". Can look up by doc_number, customer_name, or customer_id:
{"tool":"action","action":"sendEstimateEmail","payload":{"doc_number":"EST-2025-0001"}}
You can also pass customer_name or customer_id if you don't have the doc_number:
{"tool":"action","action":"sendEstimateEmail","payload":{"customer_name":"John Doe","email":"john@example.com"}}

SEND SMS TO CUSTOMER — Text an estimate or message to a customer. Use when user says "text it", "text the estimate", "send a text":
{"tool":"message","to":"+15551234567","channel":"sms","body":"Hi John, your estimate from Alpha International is ready. Total: $450.00"}

SCHEDULE FOLLOW-UP:
{"tool":"action","action":"scheduleFollowUp","payload":{"customer_name":"John Doe","channel":"sms","scheduled_for":"2025-01-15T10:00:00Z","message_body":"Hi John, just checking in..."}}

SEARCH CUSTOMERS — Search for existing customers by name, phone, email, or any text. ALWAYS use this BEFORE creating a customer. Use when user mentions ANY customer name, asks "find customer", "look up", "who is", "do we have", or any customer reference:
{"tool":"action","action":"searchCustomers","payload":{"query":"John"}}
Searches by partial name, phone number, email, or address. Returns matching customers AND their related jobs. Present results clearly: show name, phone, email, and recent jobs. If no match found, tell the user and ask if they want to create a new customer.

GET CUSTOMER HISTORY — Look up everything about a customer:
{"tool":"action","action":"getCustomerHistory","payload":{"customer_name":"John Doe"}}

GET SHOP STATS — Get current shop performance metrics:
{"tool":"action","action":"getShopStats","payload":{}}

DELETE RECORD:
{"tool":"action","action":"deleteRecord","payload":{"table":"customers","id":"uuid-here"}}

SEND MESSAGE (shows confirmation card):
{"tool":"message","to":"+15551234567","channel":"sms","body":"Hi, your vehicle is ready!"}
For email: {"tool":"message","to":"john@example.com","channel":"email","subject":"Your Estimate","body":"Hi John, attached is your estimate."}

PLACE PHONE CALL — connects the user directly to someone (you are NOT on the call):
{"tool":"call","to":"+15551234567","name":"Customer Name"}
Use when user says: "call 2819008141", "call John", "dial this number", "ring them" — just a number or name with no task attached.

AI VOICE CALL — AI calls someone and has a FULL CONVERSATION to complete a task (you ARE the caller):
{"tool":"aiVoiceCall","to":"+15551234567","task":"Tell them their car is ready for pickup","callerName":"Alpha International Auto Center"}
Use when there is a MESSAGE or TASK to deliver/handle. If it's just "call X" with no task, use call instead.

NAVIGATE:
{"tool":"navigate","view":"jobs"}

CUSTOMER INFORMATION:
- When the user mentions a customer name for an estimate, ask for their email and phone number if not already provided.
- Keep it natural: "Got it — Paul Jones. What's his email and phone so I can add it to the estimate?"
- If the user provides email/phone during conversation, include them when creating the estimate using customer_email and customer_phone fields.
- If the user says they don't have it or to skip it, that's fine — create the estimate without it.
- When proposing an estimate with a customer, always pass customer_email and customer_phone if you have them.

EXECUTION RULES:
1. Think through the full plan before starting
2. Execute each step silently — ONE tool call per turn, no explanation text
3. NEVER output text AND a tool call together — pick one
4. For quotes/estimates: ALWAYS search part prices first (webSearch), then proposeDocument with REAL numbers. But ONLY use proposeDocument if the user actually asked for an estimate/quote — if they just asked to search or find prices, respond with plain text results instead.
5. For new customers: ALWAYS searchCustomers first. Only createCustomer if user explicitly asks AND search confirms they don't exist
6. When ALL steps done: respond in plain text — 1-3 sentences max confirming what was completed
7. NEVER ask for info already in the conversation — use what was provided
8. Confirm destructive actions (void, delete) before executing
9. When user says "email it" or "text it" — just do it, don't ask for confirmation unless you're missing the recipient
10. If a customer name and email are mentioned together, always associate them

SOCIAL MEDIA & CONNECTORS:
- When the user asks to post to Facebook, Instagram, or Google Business — use the connector tool
- When asked to check comments, reviews, or messages — fetch and present them
- When asked to reply to comments or reviews — use the reply connector tool
- When asked to schedule an appointment — use Google Calendar
- When asked to find customers on social media — search Facebook messages and comments
- Always confirm before posting publicly (show draft first, say "Here's the draft — want me to post this?")
- For Instagram posts, an image URL is required

CONNECTOR TOOL CALLS — respond with ONLY a raw JSON object:

FACEBOOK POST:
{"tool":"connector","connector":"facebook","action":"post","payload":{"message":"text here","link":"optional url","target":"page or profile or both"}}

FACEBOOK GET POSTS:
{"tool":"connector","connector":"facebook","action":"get_posts","payload":{}}

FACEBOOK GET COMMENTS:
{"tool":"connector","connector":"facebook","action":"get_comments","payload":{"post_id":"12345_67890"}}

FACEBOOK REPLY COMMENT:
{"tool":"connector","connector":"facebook","action":"reply_comment","payload":{"comment_id":"...","message":"Thanks for your feedback!"}}

FACEBOOK GET MESSAGES:
{"tool":"connector","connector":"facebook","action":"get_messages","payload":{}}

FACEBOOK SEND MESSAGE:
{"tool":"connector","connector":"facebook","action":"send_message","payload":{"recipient_id":"...","message":"Hi there!"}}

INSTAGRAM POST:
{"tool":"connector","connector":"instagram","action":"post","payload":{"image_url":"https://...","caption":"text here"}}

INSTAGRAM GET POSTS:
{"tool":"connector","connector":"instagram","action":"get_posts","payload":{}}

INSTAGRAM GET COMMENTS:
{"tool":"connector","connector":"instagram","action":"get_comments","payload":{"media_id":"..."}}

INSTAGRAM REPLY COMMENT:
{"tool":"connector","connector":"instagram","action":"reply_comment","payload":{"comment_id":"...","message":"Thank you!"}}

GOOGLE BUSINESS POST:
{"tool":"connector","connector":"google_business","action":"post","payload":{"summary":"We're running a spring special this week!","call_to_action":{"type":"LEARN_MORE","url":"https://..."}}}

GOOGLE BUSINESS GET REVIEWS:
{"tool":"connector","connector":"google_business","action":"get_reviews","payload":{}}

GOOGLE BUSINESS REPLY REVIEW:
{"tool":"connector","connector":"google_business","action":"reply_review","payload":{"review_id":"...","reply":"Thank you for your kind review!"}}

GOOGLE CALENDAR LIST EVENTS:
{"tool":"connector","connector":"google_calendar","action":"list_events","payload":{"days":7}}

GOOGLE CALENDAR CREATE EVENT:
{"tool":"connector","connector":"google_calendar","action":"create_event","payload":{"title":"Oil Change - John Doe","start":"2026-03-15T10:00:00","end":"2026-03-15T11:00:00","description":"2019 Toyota Camry"}}

         

 
 
 
    SCHEDULE TASK — Schedule automated tasks to run at specific times. Use when user says "post at 5am", "remind me at", "schedule", "every morning", "do this at 7pm": {"tool":"scheduleTask","name":"Morning Post","schedule":"5:00am","task_prompt":"Post to Facebook: Good morning Houston!"} Schedule formats: "5:00am" (daily), "mon 9:00am" (weekly), "every 2h" (repeating) The task_prompt should be exactly what you'd type in the AI chat to execute the task.  FACEBOOK POST TARGET: When posting to Facebook, ALWAYS include "target" in payload. Ask the user: "Want me to post to the business page, your personal profile, or both?" Target options: "page" (Alpha International), "profile" (Aaron Sammy), "both" (default)  NAVIGATE: {"tool":"navigate","view":"jobs"} — For app views OR URLs. Pass full URL for web pages.  GOOGLE CALENDAR DELETE EVENT:
{"tool":"connector","connector":"google_calendar","action":"delete_event","payload":{"event_id":"..."}}`

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
  const [voiceActive, setVoiceActive] = useState(false)
  const [voiceSpeaking, setVoiceSpeaking] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<'idle'|'listening'|'thinking'|'speaking'>('idle')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const voiceRecRef = useRef<any>(null)
  const voiceSynthRef = useRef<SpeechSynthesisUtterance | null>(null)
  const bestVoiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const voicePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const voiceActiveRef = useRef(false)
  const [jumpingIn, setJumpingIn] = useState(false)
  const [jumpInPhone, setJumpInPhone] = useState('')
  const [showJumpIn, setShowJumpIn] = useState(false)
  const [sendingSms, setSendingSms] = useState(false)
  const [toast, setToast] = useState('')
  const [thinkingElapsed, setThinkingElapsed] = useState(0)
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
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

  // Voice mode: pick best TTS voice
  useEffect(() => {
    const pickBest = () => {
      const voices = window.speechSynthesis?.getVoices() || []
      if (!voices.length) return
      const google = voices.find(v => v.name.includes('Google US English'))
      if (google) { bestVoiceRef.current = google; return }
      const samantha = voices.find(v => v.name.includes('Samantha') || v.name.includes('Alex'))
      if (samantha) { bestVoiceRef.current = samantha; return }
      const natural = voices.find(v => v.name.includes('Natural'))
      if (natural) { bestVoiceRef.current = natural; return }
      const english = voices.find(v => v.lang.startsWith('en'))
      if (english) { bestVoiceRef.current = english; return }
      bestVoiceRef.current = voices[0] || null
    }
    pickBest()
    window.speechSynthesis?.addEventListener('voiceschanged', pickBest)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', pickBest)
  }, [])

  // Voice mode: speak text via TTS, then call onDone
  const voiceSpeak = useCallback((text: string, onDone: () => void) => {
    if (typeof window === 'undefined') { onDone(); return }
    window.speechSynthesis.cancel()
    const plain = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    if (!plain) { onDone(); return }
    const u = new SpeechSynthesisUtterance(plain)
    u.rate = 0.95; u.pitch = 1.0
    if (bestVoiceRef.current) u.voice = bestVoiceRef.current
    voiceSynthRef.current = u
    u.onend = () => { voiceSynthRef.current = null; onDone() }
    u.onerror = () => { voiceSynthRef.current = null; onDone() }
    window.speechSynthesis.speak(u)
  }, [])

  // Voice mode: start listening via SpeechRecognition — sends through send()
  const voiceStartListening = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!voiceActiveRef.current) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    try {
      const rec = new SR()
      voiceRecRef.current = rec
      rec.continuous = false
      rec.interimResults = true
      rec.lang = 'en-US'
      rec.onstart = () => setVoiceStatus('listening')
      rec.onend = () => { voiceRecRef.current = null }
      rec.onerror = () => { voiceRecRef.current = null; if (voiceActiveRef.current) setVoiceStatus('idle') }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (e: any) => {
        const last = e.results[e.results.length - 1]
        if (last.isFinal) {
          const transcript = last[0].transcript.trim()
          if (transcript) {
            voiceRecRef.current = null
            rec.stop()
            setVoiceStatus('thinking')
            // Send through the existing send() function
            sendRef.current?.(transcript)
          }
        }
      }
      rec.start()
    } catch { if (voiceActiveRef.current) setVoiceStatus('idle') }
  }, [])

  // Voice mode: stop listening
  const voiceStopListening = useCallback(() => {
    voiceRecRef.current?.stop()
    voiceRecRef.current = null
    window.speechSynthesis?.cancel()
    voiceSynthRef.current = null
    setVoiceStatus('idle')
  }, [])

  // Voice mode: close/deactivate
  const closeVoiceMode = useCallback(() => {
    voiceRecRef.current?.stop()
    voiceRecRef.current = null
    window.speechSynthesis?.cancel()
    voiceSynthRef.current = null
    setVoiceActive(false)
    voiceActiveRef.current = false
    setVoiceStatus('idle')
    setVoiceSpeaking(false)
  }, [])

  // Keep voiceActiveRef in sync
  useEffect(() => { voiceActiveRef.current = voiceActive }, [voiceActive])

  // Sync voiceStatus with loading state
  useEffect(() => {
    if (!voiceActive) return
    if (loading && voiceStatus !== 'speaking') setVoiceStatus('thinking')
    if (!loading && voiceStatus === 'thinking') setVoiceStatus('idle')
  }, [loading, voiceActive, voiceStatus])

  // Voice mode: watch for new assistant messages and speak them via TTS, then restart mic
  const lastMsgCountRef = useRef(messages.length)
  useEffect(() => {
    if (!voiceActiveRef.current) { lastMsgCountRef.current = messages.length; return }
    if (messages.length <= lastMsgCountRef.current) { lastMsgCountRef.current = messages.length; return }
    // Check the newest message
    const newest = messages[messages.length - 1]
    lastMsgCountRef.current = messages.length
    if (newest.role !== 'assistant') return
    // Don't speak HTML-only messages (estimate cards etc) — speak content if available
    const textToSpeak = newest.content || ''
    if (!textToSpeak) return
    setVoiceStatus('speaking')
    setVoiceSpeaking(true)
    voiceSpeak(textToSpeak, () => {
      setVoiceSpeaking(false)
      if (voiceActiveRef.current) {
        setVoiceStatus('idle')
        // Small delay before restarting mic
        setTimeout(() => voiceStartListening(), 300)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

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

  // Thinking timer — counts up while loading
  useEffect(() => {
    if (loading) {
      setThinkingElapsed(0)
      thinkingTimerRef.current = setInterval(() => setThinkingElapsed(prev => prev + 1), 1000)
    } else {
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current)
      thinkingTimerRef.current = null
      setThinkingElapsed(0)
    }
    return () => { if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current) }
  }, [loading])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // ==================== NEW STATE ====================
  // Feature toggles
    const [features, setFeatures] = useState({ search: true, socialMedia: true, thinking: false })
  const toggleFeature = (key: keyof typeof features) => setFeatures(prev => ({ ...prev, [key]: !prev[key] }))

  // Connectors popup state
  const [showConnectorsPopup, setShowConnectorsPopup] = useState(false)
  const [connectors, setConnectors] = useState<Record<string, ConnectorRecord>>({})
  const [connectorsLoading, setConnectorsLoading] = useState(false)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [connectorToast, setConnectorToast] = useState('')

  const loadConnectors = useCallback(async () => {
    setConnectorsLoading(true)
    try {
      const { data } = await supabase.from('connectors').select('*')
      const map: Record<string, ConnectorRecord> = {}
      for (const c of (data || [])) map[c.service] = c
      setConnectors(map)
    } catch { /* ignore */ }
    setConnectorsLoading(false)
  }, [])

  const handleConnectorDisconnect = useCallback(async (service: string) => {
    setDisconnecting(service)
    try {
      await supabase.from('connectors').update({ enabled: false, access_token: null, refresh_token: null, token_expires_at: null, page_id: null, page_access_token: null, metadata: {}, updated_at: new Date().toISOString() }).eq('service', service)
      setConnectorToast(`${CONNECTOR_SERVICE_INFO[service]?.name || service} disconnected`)
      setTimeout(() => setConnectorToast(''), 3000)
      await loadConnectors()
    } catch { setConnectorToast('Disconnect failed'); setTimeout(() => setConnectorToast(''), 3000) }
    setDisconnecting(null)
  }, [loadConnectors])

  // File attachment state
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string; type: 'text' | 'image' } | null>(null) 
    
  const attachInputRef = useRef<HTMLInputElement>(null)

  const handleFileAttach = useCallback(async (file: File) => {
    const isImage = file.type.startsWith('image/')
    const isPDF = file.type === 'application/pdf'
    const isText = file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.csv')

    if (isImage) {
      const reader = new FileReader()
      reader.onload = () => { setAttachedFile({ name: file.name, content: reader.result as string, type: 'image' }) }
      reader.readAsDataURL(file)
    } else if (isText) {
      const reader = new FileReader()
      reader.onload = () => { setAttachedFile({ name: file.name, content: reader.result as string, type: 'text' }) }
      reader.readAsText(file)
    } else if (isPDF) {
      setAttachedFile({ name: file.name, content: '[Reading PDF...]', type: 'text' })
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pdfjsLib = (window as any).pdfjsLib
          if (pdfjsLib) {
            const arrayBuffer = reader.result as ArrayBuffer
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
            let text = ''
            for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
              const page = await pdf.getPage(i)
              const content = await page.getTextContent()
              text += content.items.map((item: Record<string, unknown>) => item.str).join(' ') + '\n'
            }
            setAttachedFile({ name: file.name, content: text.trim() || '[Empty PDF]', type: 'text' })
          } else {
            setAttachedFile({ name: file.name, content: `[PDF file: ${file.name} — ${(file.size/1024).toFixed(0)}KB. PDF text extraction unavailable.]`, type: 'text' })
          }
        } catch {
          setAttachedFile({ name: file.name, content: `[PDF file: ${file.name}]`, type: 'text' })
        }
      }
      reader.readAsArrayBuffer(file)
    } else {
      const reader = new FileReader()
      reader.onload = () => { setAttachedFile({ name: file.name, content: typeof reader.result === 'string' ? reader.result : `[File: ${file.name}]`, type: 'text' }) }
      reader.readAsText(file)
    }
  }, [])
  // ==================== END NEW STATE ====================

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
    // Build message content — include attached file if any
    let fullContent = text
    let attachImageUrl: string | undefined
    if (attachedFile && !overrideInput) {
      if (attachedFile.type === 'image') {
        attachImageUrl = attachedFile.content
        fullContent = text + (text ? '\n\n' : '') + `[Image attached: ${attachedFile.name}]`
      } else {
        fullContent = text + '\n\n---\n**Attached file: ' + attachedFile.name + '**\n' + attachedFile.content.slice(0, 8000)
      }
      setAttachedFile(null)
    }
    const userMsg: ChatMessage = { role: 'user', content: text, imageUrl: attachImageUrl }
    setMessages(prev => [...prev, userMsg])

    // AI voice call detection — "AI call", "call [business] and order/ask", "have AI call"
    const aiCallMatch = text.match(/(?:ai\s+call|have\s+(?:the\s+)?ai\s+call|call\s+\w+\s+(?:and|to)\s+(?:order|ask|find|check|get|buy|order|inquire))/i)
    if (aiCallMatch || /\bcall\b.*\b(?:autozone|napa|oreilly|o'reilly|advance|pepboys|store|shop|dealership|dealer|supplier)\b/i.test(text)) {
      // Let the AI handle it — it will use aiVoiceCall tool
    } else {
      // Direct call detection — bypass AI for plain "call XXXXXXXXXX"
    }

    // Direct call detection — bypass AI for explicit call commands
    // Matches: "call 2819008141" or "call 2819008141 and ask if he's going to church"
    const callMatch = text.match(/^(?:call|dial|phone|ring)\s+([\d\s\-\(\)\+]+?)(?:\s+(?:and|to|then)\s+(.+))?$/i)
    if (callMatch) {
      const phone = callMatch[1].replace(/\s/g, '')
      const instructions = callMatch[2]?.trim() || ''
      // If user gave instructions ("call X and ask Y"), use them as the AI task
      // If no instructions ("call X"), it's a personal call — no AI script
      const callTask = instructions
        ? instructions
        : '' // empty = no AI script, just connect the call
      setStatus('Calling...')
      try {
        const r = await fetch('/api/make-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: phone, name: phone, task: callTask || undefined })
        })
        const d = await r.json()
        const msg: ChatMessage = d.ok
          ? { role: 'assistant', content: instructions
              ? `AI call placed to ${phone}. Task: ${instructions}`
              : `Call placed to ${phone}. Dialing now.` }
          : { role: 'assistant', content: `Call failed: ${d.error}` }
        setMessages(prev => [...prev, msg])
      } catch (err) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Call error: ${err instanceof Error ? err.message : 'Unknown'}` }])
      }
      setLoading(false)
      setStatus('')
      return
    }

    // Build history with full content (including file)
    const msgForHistory: ChatMessage = fullContent !== text
      ? { role: 'user', content: fullContent, imageUrl: attachImageUrl }
      : userMsg
    const history2 = [...messages, msgForHistory]
    await agentLoop(history2, features)
    setLoading(false)
    setStatus('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, loading, messages, shopContext, attachedFile, features])

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

    const agentLoop = async (history: ChatMessage[], featureFlags?: { search: boolean;  socialMedia: boolean; thinking: boolean }) => {
        const activeFeatures = featureFlags || { search: true, socialMedia: true, thinking: false }
    const { data: settings } = await supabase.from('settings').select('ai_api_key,ai_model,ai_base_url').limit(1).single()
    const apiKey = settings?.ai_api_key
    if (!apiKey) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'No AI API key configured. Go to Settings > AI to add your OpenRouter key.' }])
      return
    }

    const accumulated: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastSearchMedia: {images: any[], videos: any[]} | null = null
    const agentMessages: {role: string; content: string}[] = history.map(m => ({ role: m.role, content: m.content }))

    for (let step = 0; step < 10; step++) {
      const systemWithContext = SYSTEM_PROMPT +
        (shopContext ? `\n\nLive shop context:\n${shopContext}` : '') +
        (accumulated.length ? `\n\nCompleted steps so far:\n${accumulated.join('\n')}` : '') + +
          `\n\nCRITICAL INSTRUCTIONS:\n1. NEW RECEIPT vs REPRINT: When user says "new receipt" or "I need a receipt for [item]", CREATE a NEW document using proposeDocument. Do NOT reprint or lookup old receipts. A "new receipt" means build a fresh one from scratch.\n2. UNDERSTAND SIMPLE REQUESTS: If the user gives you a customer name and says they need something, DO IT. Don't ask them to repeat. Example: "I need a new receipt for thermostat, $280 flat for Asheanna" = immediately create a receipt with those details, no tax, flat total.\n3. CUSTOMER SEARCH: When the user mentions a customer name, phone, or asks about a customer, ALWAYS use searchCustomers first (NOT createCustomer). Show matching results with name, phone, email, jobs. If no match, say so and ask before creating.\n4. NEVER LOOP: Give ONE clear response per turn. If you're unsure, ask ONE clarifying question. Never repeat yourself.\n5. FLAT RATE: When user says "flat" or "no tax", set tax to 0 and use the exact total they gave.\n6. customer search results: when searchcustomers returns results, always show all matching customers with their full details (name, phone, email, vehicles). the search now includes vehicle info from jobs. never show just one customer if multiple matches exist. present each customer clearly so the user can identify the right one.
7. RECEIPT TYPE: When user asks for a receipt, use proposeDocument with type Receipt not Invoice. When user asks for an invoice, use type Invoice. Receipt = proof of payment received. Invoice = bill for work done. Estimate = quote before work. The type field in proposeDocument MUST match exactly what the user asked for.` +
                    `\n\nNATURAL LANGUAGE INTELLIGENCE — YOU ARE SMART, ACT LIKE IT:
- The user is a busy mechanic. They speak casually with typos, slang, abbreviations. FIGURE IT OUT.
- "receipt 280 flat thermostat asheanna" = create receipt, thermostat, $280, Asheanna, no tax
- "brakes civic" = search brake parts for the Civic in context
- "send it" = send whatever you just made to whoever is in context
- "how much we made" = getShopStats, revenue
- "whats rufina owe" = searchCustomers Rufina, check unpaid
- "call him" = call the customer from this conversation
- "280 flat" = $280 total, zero tax, one line item
- "yo check on johns car" = searchCustomers John, show job status
- "add labor 2 hrs" = add 2 hours at $120/hr
- "est" = estimate, "inv" = invoice, "rcpt" = receipt, "cust" = customer
- Pronouns: "his car", "her estimate", "that job" = reference from conversation
- NEVER ask for info you can infer. NEVER repeat back what user said. Just DO IT.
- If user gives a price, USE IT. Dont search. Dont question.
- "flat" or a raw total = no breakdown, no tax, one line.
- "new receipt" = NEW document, not lookup old ones.
- User should NEVER have to repeat themselves.

FEATURE TOGGLES (current state):\n- Web Search: ${activeFeatures.search ? 'ON' : 'OFF'}\n- Social Media: ${activeFeatures.socialMedia ? 'ON' : 'OFF'}\n- Deep Thinking: ${activeFeatures.thinking ? 'ON' : 'OFF'}\nIf a feature is OFF and the user tries to use it, tell them to enable the toggle at the bottom of the chat input.`

      setStatus(step === 0 ? 'Thinking...' : 'Working...')

      const thinkStart = Date.now()
      const res = await fetch(`${settings?.ai_base_url || 'https://openrouter.ai/api/v1'}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings?.ai_model || 'deepseek/deepseek-v3.2',
          messages: [{ role: 'system', content: systemWithContext }, ...agentMessages],
          max_tokens: 1500,
          temperature: 0.2,
          frequency_penalty: 0.6,
          presence_penalty: 0.4,
            ...(activeFeatures.thinking ? { reasoning: { effort: 'high' } } : {}),
        })
      })

      const data = await res.json()
      if (data.error) {
        const errMsg: ChatMessage = { role: 'assistant', content: `Error: ${data.error.message || JSON.stringify(data.error)}` }
        setMessages(prev => [...prev, errMsg])
        return
      }

      const raw = data.choices?.[0]?.message?.content?.trim() || ''

            // OUTPUT SANITIZATION — detect repeating patterns and cut them off
      const sanitizeOutput = (text: string): string => {
        if (!text) return text
        // Detect repeating phrases (3+ repetitions of same 2-20 word phrase)
        const words = text.split(/\s+/)
        if (words.length > 50) {
          for (let len = 2; len <= 20; len++) {
            const phrase = words.slice(0, len).join(' ')
            let count = 0
            for (let i = 0; i <= words.length - len; i += len) {
              if (words.slice(i, i + len).join(' ') === phrase) count++
              else break
            }
            if (count >= 3) return phrase + ' [Response was repetitive and was cut short. Please try again.]'
          }
        }
        // Also check for any substring repeated 5+ times
        const repeatMatch = text.match(/(.{3,50})\1{4,}/)
        if (repeatMatch) return text.slice(0, text.indexOf(repeatMatch[0])) + ' [Repetitive output detected and trimmed.]'
        // Max length guard
        if (text.length > 8000) return text.slice(0, 8000) + '... [Output truncated]'
        return text
      }
      const cleanRaw = sanitizeOutput(raw)
      const reasoning = data.choices?.[0]?.message?.reasoning || data.choices?.[0]?.message?.reasoning_content || ''
      const thinkingSeconds = Math.round((Date.now() - thinkStart) / 1000)

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
        let mediaHtml = ''
            if (lastSearchMedia) {
              const imgs = (lastSearchMedia.images || []).slice(0, 4)
              const vids = (lastSearchMedia.videos || []).slice(0, 3)
              if (vids.length > 0) {
                mediaHtml += '<div style="margin-top:12px"><strong>📺 Videos</strong></div>'
                for (const v of vids) {
                  const yt = (v.url || '').match(/(?:watch\?v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/)
                  if (yt) {
                    mediaHtml += `<div style="margin:8px 0"><iframe width="100%" height="200" src="https://www.youtube.com/embed/${yt[1]}" frameborder="0" allowfullscreen style="border-radius:8px"></iframe><div style="font-size:12px;margin-top:4px">${v.title || ''}</div></div>`
                  }
                }
              }
              if (imgs.length > 0) {
                mediaHtml += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">'
                for (const img of imgs) {
                  const src = typeof img === 'string' ? img : img.url || img.thumbnail || ''
                  if (src) mediaHtml += `<img src="${src}" alt="" onerror="this.style.display='none'" style="max-width:120px;max-height:120px;border-radius:8px;object-fit:cover" />`
                }
                mediaHtml += '</div>'
              }
              lastSearchMedia = null
            }
            const assistantMsg: ChatMessage = { role: 'assistant', content: cleanRaw, html: mediaHtml || undefined, reasoning: reasoning || undefined, thinkingSeconds: reasoning ? thinkingSeconds : undefined }
        setMessages(prev => [...prev, assistantMsg])
        speak(cleanRaw)
        saveToHistory([...history, assistantMsg])
        return
      }

      // Feature gate: block webSearch if search is disabled
      if (parsed.tool === 'webSearch' && !activeFeatures.search) {
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: 'Web search is currently disabled by the user. Respond without searching.' })
        continue
      }

      // Feature gate: block connector tools for social media if socialMedia is disabled
      if (parsed.tool === 'connector' && !activeFeatures.socialMedia) {
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: 'Social media connectors are currently disabled by the user. Inform the user that Social Media toggle is off.' })
        continue
      }

      // Web Search — execute silently, feed result back to AI
      if (parsed.tool === 'webSearch') {
        setStatus('Searching...')

          // Smart parts detection: if query looks like a parts search, use parts-lookup API
      const partsQuery = (parsed.query as string || '').toLowerCase()
      const isPartsSearch = /(?:brake|rotor|pad|control arm|strut|shock|bearing|hub|alternator|starter|water pump|thermostat|timing belt|ac compressor|tie rod|ball joint|axle|caliper|muffler|catalytic|spark plug|coil|fuel pump|radiator|belt|hose|filter|battery).*(?:price|cost|how much|\d{4})/i.test(parsed.query as string) || /\d{4}\s+\w+\s+\w+.*(?:brake|rotor|pad|control arm|strut|shock|part)/i.test(parsed.query as string)
      if (isPartsSearch) {
        setStatus('Looking up parts...')
        try {
          const pr = await fetch('/api/parts-lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: parsed.query }),             signal: AbortSignal.timeout(12000),
          })
          const pd = await pr.json()
          if (pd.ok && pd.data) {
            const d = pd.data
            let partsResult = `SMART PARTS LOOKUP RESULTS for ${d.vehicle}:\n`
            partsResult += `Positions: ${(d.positions || []).join(', ')}\n\n`
            for (const opt of (d.options || [])) {
              partsResult += `**Option: ${opt.brand} (${opt.tier})**\n`
              for (const p of (opt.parts || [])) {
                partsResult += `- ${p.position}: ${p.name}${p.partNumber ? ' #' + p.partNumber : ''} - $${p.price?.toFixed(2)} x${p.quantity || 1}${p.store ? ' [' + p.store + ']' : ''}${p.url ? ' ' + p.url : ''}${p.inStock === true ? ' (In Stock)' : p.inStock === false ? ' (Out of Stock)' : ''}\n`
              }
              partsResult += `Parts Total: $${opt.partsTotal?.toFixed(2)}\n\n`
            }
            for (const kit of (d.kits || [])) {
              partsResult += `**KIT OPTION: ${kit.name}** - $${kit.price?.toFixed(2)} (${kit.includes}) [${kit.store}]${kit.url ? ' ' + kit.url : ''}\n`
            }
            if (d.laborHours) partsResult += `\nLabor: ${d.laborHours} hrs x $${d.laborRate}/hr = $${(d.laborHours * d.laborRate).toFixed(2)}\n`
            partsResult += `Tax Rate: ${d.taxRate}% (on parts)\n`
            if (d.searchUrls?.length) partsResult += `\nSource links:\n` + d.searchUrls.map((s: {store:string;url:string}) => `- ${s.store}: ${s.url}`).join('\n')
            accumulated.push(`[Parts Lookup: "${parsed.query}"]\n${partsResult}`)
            agentMessages.push({ role: 'assistant', content: raw })
            agentMessages.push({ role: 'user', content: `Parts lookup results for "${parsed.query}":\n${partsResult}\n\nPresent these results to the user in a clean formatted way. Use the EXACT prices and URLs from above. Continue to the next step silently.` })
            continue
          }
        } catch { /* fall through to regular search */ }
      }
        let searchResult = 'No results'
        try {
          const r = await fetch(`/api/ai-search?q=${encodeURIComponent(parsed.query as string)}`)
          const d = await r.json()
                      searchResult = d.results?.slice(0, 8).map((r: Record<string,string>, i: number) => `Result ${i + 1}:\nTitle: ${r.title}\nURL: ${r.url}\nSource: ${r.source || ''}\nSnippet: ${r.snippet}`).join('\n\n') || 'No results'
            if (d.results?.length) {
              searchResult += '\n\nIMPORTANT: Use ONLY the exact URLs listed above when linking to products. Do NOT fabricate or guess URLs.'
            }
            if (d.images?.length) {
              searchResult += '\n\nProduct images:\n' + (d.images as {url:string}[]).slice(0, 4).map((img: {url:string}) => `![Product](${img.url})`).join('\n')
            }
            if (d.videos?.length) {
              searchResult += '\n\nYouTube Videos:\n' + (d.videos as {title:string;url:string;channel?:string;embed_url?:string}[]).slice(0, 3).map((v: {title:string;url:string;channel?:string;embed_url?:string}, i: number) => `${i+1}. **${v.title}**${v.channel ? ` (${v.channel})` : ''}\n${v.embed_url || v.url}\n![thumbnail](${v.thumbnail || ''})`).join('\n')
            }
            if (d.price_radar?.length) {
              searchResult += '\n\nPRICE COMPARISON (Price Radar):\n' + (d.price_radar as {store:string;price:number;url:string;shipping?:string}[]).map((p: {store:string;price:number;url:string;shipping?:string}) => `- ${p.store}: $${p.price.toFixed(2)} ${p.shipping || ''} — ${p.url}`).join('\n')
              searchResult += '\nBest price: $' + (d.price_radar as {price:number}[])[0].price.toFixed(2) + ' at ' + (d.price_radar as {store:string}[])[0].store
            }
            if (d.answer) {
              searchResult += '\n\nAI Summary: ' + d.answer
            }
            if (d.follow_ups?.length) {
              searchResult += '\n\nSuggested follow-ups for the user: ' + (d.follow_ups as string[]).join(' | ')
            }
        lastSearchMedia = { images: d.images || [], videos: d.videos || [] }
                    if (d.knowledge_panel) {
              searchResult += '\n\nKNOWLEDGE PANEL — ' + d.knowledge_panel.title + ':\n' + Object.entries(d.knowledge_panel.facts).map(([k, v]: [string, string]) => `- ${k}: ${v}`).join('\n')
              if (d.knowledge_panel.source) searchResult += '\nSource: ' + d.knowledge_panel.source
            }
            if (d.related_searches?.length) {
              searchResult += '\n\nRelated searches: ' + (d.related_searches as string[]).join(' | ')
            }
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
          actionResult = d.ok ? `Success: ${JSON.stringify(d.data).slice(0, 2000)}` : `Failed: ${d.error}`
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
        const v = parsed.view as string; if (v.startsWith('http')) { window.open(v, '_blank') } else { window.location.href = `/${v}` }
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

      // Connector tools — Facebook, Instagram, Google Business, Google Calendar
      if (parsed.tool === 'connector') {
        const connectorName = parsed.connector as string
        const connAction    = parsed.action as string
        const connPayload   = (parsed.payload || {}) as Record<string, unknown>
        setStatus(`Running ${connectorName}...`)
        let connResult = ''
        try {
          const endpointMap: Record<string, string> = {
            facebook:        '/api/connectors/facebook',
            instagram:       '/api/connectors/instagram',
            google_business: '/api/connectors/google-business',
            google_calendar: '/api/connectors/google-calendar',
          }
          const endpoint = endpointMap[connectorName]
          if (!endpoint) {
            connResult = `Unknown connector: ${connectorName}`
          } else {
            const r = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: connAction, ...connPayload }),
            })
            const d = await r.json()
            connResult = d.ok
              ? `Success: ${JSON.stringify(d.data).slice(0, 500)}`
              : `Failed: ${d.error}`
          }
        } catch (err) {
          connResult = `Error: ${err instanceof Error ? err.message : 'Unknown'}`
        }
        accumulated.push(`[${connectorName}.${connAction}]: ${connResult}`)
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: `${connectorName} ${connAction} result: ${connResult}\n\nContinue to the next step silently.` })
        continue
      }

if (parsed.tool === 'scheduleTask') { setStatus('Scheduling...'); let sr = ''; try { const r = await fetch('/api/automations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', name: parsed.name || 'Scheduled Task', description: parsed.description || '', schedule: parsed.schedule, task_prompt: parsed.task_prompt }) }); const d = await r.json(); sr = d.ok ? `Scheduled "${d.data?.name}" at ${d.data?.schedule}` : `Failed: ${d.error}` } catch (e) { sr = `Error: ${e instanceof Error ? e.message : 'Unknown'}` } accumulated.push(`[scheduleTask]: ${sr}`); agentMessages.push({ role: 'assistant', content: raw }); agentMessages.push({ role: 'user', content: `Schedule result: ${sr}
Continue silently.` }); continue } // Unknown — treat as final response
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
        body: JSON.stringify({
          customer: parsed.customer,
          customer_email: parsed.customer_email,
          customer_phone: parsed.customer_phone,
          vehicle: parsed.vehicle,
          parts: parsed.parts,
          labors: parsed.labors,
          notes: parsed.notes,             type: parsed.type || 'Estimate',
        })
      })
      if (!res.ok) throw new Error('Failed')
      showToast('Document saved')
      setTimeout(() => { window.location.href = '/estimates' }, 1000)
    } catch { showToast('Failed to save estimate') }
  }

  // Render markdown links, images, and bold in chat messages
  const renderMarkdown = (text: string): string => {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return escaped
      // YouTube embeds: [YouTube](embed_url) or bare embed URLs
      .replace(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([\w-]{11})/g, '<div style="margin:8px 0;border-radius:12px;overflow:hidden;max-width:480px"><iframe width="100%" height="270" src="https://www.youtube.com/embed/$1" frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen style="border-radius:12px"></iframe></div>')
            // Images: ![alt](url)
      .replace(/!\[([^\]]*)]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="rounded-lg max-w-[300px] max-h-[300px] object-cover my-1 inline-block" />')
      // Links: [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue underline hover:text-blue/80">$1</a>')
      // Bold: **text**
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // Newlines
      .replace(/\n/g, '<br />')
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
        <button onclick="window.__saveEstimate && window.__saveEstimate('${encodedData}')" class="btn btn-success btn-sm">Save ${parsed.type || 'Estimate'}</button>
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

  const deleteConversation = (entryId: string) => {
    if (!confirm('Delete this conversation?')) return
    setHistory(prev => {
      const updated = prev.filter(h => h.id !== entryId)
      localStorage.setItem('ai_history', JSON.stringify(updated))
      return updated
    })
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
    <div className="flex flex-col h-screen max-h-screen">
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
          {/* Talk to Alpha — voice conversation mode toggle */}
          <button
            onClick={() => {
              if (voiceActive) {
                closeVoiceMode()
              } else {
                setVoiceActive(true)
                voiceActiveRef.current = true
                setVoiceStatus('idle')
                setTimeout(() => voiceStartListening(), 300)
              }
            }}
            className={`btn btn-sm font-semibold text-white ${voiceActive ? 'ring-2 ring-red-400' : ''}`}
            style={{ background: voiceActive ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)', border: 'none' }}
            title={voiceActive ? 'Voice mode ON — tap to stop' : 'Start voice conversation'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="inline mr-1">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            </svg>
            <span className="hidden sm:inline">{voiceActive ? 'Voice On' : 'Talk to Alpha'}</span>
            <span className="sm:hidden">{voiceActive ? 'On' : 'Talk'}</span>
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
                                <button onClick={() => { if (confirm('Delete ALL chat history?')) { setHistory([]); localStorage.removeItem('ai_history'); showToast('All history deleted') }}} className="btn btn-sm text-xs text-red-400 hover:bg-red-400/10 border border-red-400/30">Delete All</button>
              <button onClick={() => setShowHistory(false)} className="btn btn-secondary btn-sm">✕</button>
            </div>
            {history.length === 0 && <p className="text-sm text-text-muted">No conversations yet.</p>}
            {groupHistoryByDate().map(group => (
              <div key={group.label} className="mb-4">
                <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">{group.label}</p>
                {group.entries.map(entry => (
                  <div key={entry.id} className="flex items-center gap-1 mb-2">
                    <button onClick={() => loadConversation(entry)}
                      className="flex-1 text-left p-3 rounded-lg bg-bg-hover hover:bg-blue/10 transition-colors min-w-0">
                      <p className="text-sm font-medium truncate">{entry.preview}</p>
                      <p className="text-xs text-text-muted mt-1">{new Date(entry.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
                    </button>
                    <button
                      onClick={() => deleteConversation(entry.id)}
                      className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      title="Delete conversation"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inline Voice Mode Banner */}
      {voiceActive && (
        <>
          <style>{`
            @keyframes vc-glow-idle { 0%, 100% { box-shadow: 0 0 8px 2px rgba(59,130,246,0.3); } 50% { box-shadow: 0 0 14px 4px rgba(59,130,246,0.5); } }
            @keyframes vc-glow-listening { 0%, 100% { box-shadow: 0 0 8px 3px rgba(239,68,68,0.4); } 50% { box-shadow: 0 0 16px 6px rgba(239,68,68,0.6); } }
            @keyframes vc-glow-thinking { 0% { box-shadow: 0 0 8px 2px rgba(245,158,11,0.4); } 50% { box-shadow: 0 0 14px 4px rgba(245,158,11,0.6); } 100% { box-shadow: 0 0 8px 2px rgba(245,158,11,0.4); } }
            @keyframes vc-glow-speaking { 0%, 100% { box-shadow: 0 0 8px 3px rgba(34,197,94,0.3); } 50% { box-shadow: 0 0 16px 6px rgba(34,197,94,0.5); } }
            .vc-logo-idle { animation: vc-glow-idle 3s ease-in-out infinite; }
            .vc-logo-listening { animation: vc-glow-listening 1.2s ease-in-out infinite; }
            .vc-logo-thinking { animation: vc-glow-thinking 1.5s ease-in-out infinite; }
            .vc-logo-speaking { animation: vc-glow-speaking 1.5s ease-in-out infinite; }
          `}</style>
          <div className="px-3 sm:px-6 py-2 border-b border-border flex items-center gap-3" style={{ background: 'linear-gradient(90deg, rgba(59,130,246,0.08), rgba(139,92,246,0.08))' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/alpha-bot.jpg"
              alt="Alpha AI"
              className={`w-10 h-10 rounded-full object-cover flex-shrink-0 ${
                voiceStatus === 'listening' ? 'vc-logo-listening' :
                voiceStatus === 'thinking' ? 'vc-logo-thinking' :
                voiceStatus === 'speaking' ? 'vc-logo-speaking' :
                'vc-logo-idle'
              }`}
            />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold">Alpha AI</span>
              <span className="mx-2 text-text-muted">·</span>
              <span className="text-sm font-medium" style={{
                color: voiceStatus === 'listening' ? '#ef4444' :
                       voiceStatus === 'thinking' ? '#f59e0b' :
                       voiceStatus === 'speaking' ? '#22c55e' : '#9ca3af'
              }}>
                {voiceStatus === 'listening' ? 'Listening...' :
                 voiceStatus === 'thinking' ? 'Thinking...' :
                 voiceStatus === 'speaking' ? 'Speaking...' : 'Ready'}
              </span>
            </div>
            <button
              onClick={closeVoiceMode}
              className="flex-shrink-0 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              title="Close voice mode"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </>
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
              {/* Thinking/reasoning collapsible section */}
              {m.reasoning && (
                <details className="mb-2 group/think">
                  <summary className="cursor-pointer text-xs text-text-muted hover:text-text-secondary transition-colors select-none flex items-center gap-1.5 list-none [&::-webkit-details-marker]:hidden">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 transition-transform duration-200 group-open/think:rotate-90"><polyline points="9 18 15 12 9 6"/></svg>
                    <span>Thought for {m.thinkingSeconds || 0} second{(m.thinkingSeconds || 0) !== 1 ? 's' : ''}</span>
                  </summary>
                  <div className="mt-2 pl-4 border-l-2 border-border text-xs text-text-muted italic whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                    {m.reasoning}
                  </div>
                </details>
              )}
              {m.html
                ? <div dangerouslySetInnerHTML={{ __html: (m.content ? renderMarkdown(m.content) : '') + (m.html || '') }} />
                : m.role === 'assistant' && (m.content.includes('[') || m.content.includes('**') || m.content.includes('!['))
                  ? <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                  : <p className="whitespace-pre-wrap">{m.content}</p>}
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
              <div className="flex items-center gap-2">
                <span className="flex gap-0.5">
                  <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
                <span>{status || 'Thinking...'}</span>
                {thinkingElapsed > 0 && <span className="text-xs opacity-60">{thinkingElapsed}s</span>}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="p-4 border-t border-border">
        {/* Attached file chip */}
        {attachedFile && (
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center gap-1.5 bg-blue/10 border border-blue/30 rounded-full px-3 py-1 text-xs text-blue max-w-xs">
              <span>{attachedFile.type === 'image' ? '🖼️' : '📎'}</span>
              <span className="truncate max-w-[180px]">{attachedFile.name}</span>
              <button
                onClick={() => setAttachedFile(null)}
                className="ml-1 text-blue/60 hover:text-red-400 transition-colors"
                title="Remove file"
              >✕</button>
            </div>
            {attachedFile.content === '[Reading PDF...]' && (
              <span className="text-xs text-text-muted animate-pulse">Reading...</span>
            )}
          </div>
        )}

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
          {/* File attach (hidden input) */}
          <input ref={attachInputRef} type="file" accept="image/*,.pdf,.txt,.csv,.doc,.docx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileAttach(f); e.target.value = '' }} />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Upload photo for analysis"
            className="flex items-center justify-center w-10 h-10 rounded-xl border bg-bg-card border-border text-text-muted hover:border-blue/50 hover:text-blue transition-all flex-shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          </button>
          <button
            onClick={() => {
              if (voiceActive) {
                // In voice mode: pause/resume listening
                if (voiceStatus === 'listening') {
                  voiceStopListening()
                } else if (voiceStatus === 'idle') {
                  voiceStartListening()
                }
              } else {
                toggleVoice()
              }
            }}
            title={voiceActive ? (voiceStatus === 'listening' ? 'Pause listening' : 'Resume listening') : (listening ? 'Stop listening' : 'Voice input')}
            className={`flex items-center justify-center w-10 h-10 rounded-xl border transition-all flex-shrink-0 ${
              voiceActive
                ? voiceStatus === 'listening'
                  ? 'border-red-400 text-red-400 animate-pulse'
                  : 'border-blue-400 text-blue-400'
                : listening
                  ? 'border-red-400 text-red-400 animate-pulse'
                  : 'bg-bg-card border-border text-text-muted hover:border-blue/50 hover:text-blue'
            }`}
          >
            {(listening || (voiceActive && voiceStatus === 'listening')) ? (
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

        {/* Feature toggle buttons row */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {/* Search toggle */}
          <button
            onClick={() => toggleFeature('search')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border ${
              features.search
                ? 'bg-blue/20 border-blue/50 text-blue'
                : 'bg-bg-card border-border text-text-muted hover:border-blue/30 hover:text-text-secondary'
            }`}
            title={features.search ? 'Web search ON — click to disable' : 'Web search OFF — click to enable'}
          >
            {features.search && <span className="w-1.5 h-1.5 rounded-full bg-blue flex-shrink-0" />}
            🔍 Search
          </button>

          {/* Social toggle */}
          <button
            onClick={() => toggleFeature('socialMedia')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border ${
              features.socialMedia
                ? 'bg-blue/20 border-blue/50 text-blue'
                : 'bg-bg-card border-border text-text-muted hover:border-blue/30 hover:text-text-secondary'
            }`}
            title={features.socialMedia ? 'Social media ON — click to disable' : 'Social media OFF — click to enable'}
          >
            {features.socialMedia && <span className="w-1.5 h-1.5 rounded-full bg-blue flex-shrink-0" />}
            📱 Social
          </button>

                      {/* Thinking toggle */}
            <button
              onClick={() => toggleFeature('thinking')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                features.thinking
                  ? 'bg-purple-500/20 border-purple-500/50 text-purple-400'
                  : 'bg-bg-card border-border text-text-muted hover:border-purple-400/30 hover:text-text-secondary'
              }`}
              title={features.thinking ? 'Deep thinking ON' : 'Deep thinking OFF'}
            >
              {features.thinking && <span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />}
              🧠 Thinking
            </button>

          {/* Connectors button */}
          <button
            onClick={() => { setShowConnectorsPopup(true); loadConnectors() }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border bg-bg-card border-border text-text-muted hover:border-blue/30 hover:text-text-secondary"
            title="Open Connectors"
          >
            🔌 Connectors
          </button>

          {/* Files button */}
          <button
            onClick={() => attachInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border bg-bg-card border-border text-text-muted hover:border-blue/30 hover:text-text-secondary"
            title="Attach a file"
          >
            📎 Files
          </button>
        </div>

        {listening && !voiceActive && <p className="text-xs mt-2 text-red-400 animate-pulse">Listening... speak now</p>}
        {voiceActive && voiceStatus === 'listening' && <p className="text-xs mt-2 text-red-400 animate-pulse">Voice mode active — speak now</p>}
      </div>

      {/* Connectors Popup Modal */}
      {showConnectorsPopup && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h2 className="text-lg font-bold">Connectors</h2>
                <p className="text-xs text-text-muted mt-0.5">Connect social media and calendar accounts for AI to manage</p>
              </div>
              <button
                onClick={() => setShowConnectorsPopup(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-bg-hover hover:bg-red-500/10 hover:text-red-400 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Toast inside popup */}
            {connectorToast && (
              <div className="mx-5 mt-4 px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">✅ {connectorToast}</div>
            )}

            {/* Cards */}
            <div className="p-5">
              {connectorsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {CONNECTOR_ORDER.map(s => (
                    <div key={s} className="h-28 rounded-xl bg-bg-hover animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {CONNECTOR_ORDER.map(service => {
                    const info = CONNECTOR_SERVICE_INFO[service]
                    if (!info) return null
                    const connector = connectors[service]
                    const isConnected = connector?.enabled === true
                    const isLoading = disconnecting === service
                    const accountName = connector?.metadata?.page_name as string | undefined || (connector?.page_id ? `ID: ${connector.page_id}` : null)
                    return (
                      <div key={service} className="rounded-xl border border-border p-4 flex flex-col gap-3" style={{ borderTop: `3px solid ${info.color}` }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: info.bgColor }}>{info.icon}</div>
                            <div>
                              <div className="font-semibold text-sm">{info.name}</div>
                              <div className="text-xs text-text-muted">{info.description}</div>
                            </div>
                          </div>
                          <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${ isConnected ? 'bg-green-500/15 text-green-400' : 'bg-bg-hover text-text-muted' }`}>
                            {isConnected ? '● Connected' : '○ Not connected'}
                          </span>
                        </div>
                        {isConnected && accountName && (
                          <div className="text-xs text-text-muted bg-bg-hover rounded-lg px-3 py-1.5 truncate">
                            <span className="text-text-secondary font-medium">Account:</span> {accountName}
                          </div>
                        )}
                        <div className="flex justify-end">
                          {isConnected ? (
                            <button
                              className="text-sm px-4 py-1.5 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors"
                              onClick={() => handleConnectorDisconnect(service)}
                              disabled={isLoading}
                            >
                              {isLoading ? 'Disconnecting…' : 'Disconnect'}
                            </button>
                          ) : (
                            <button
                              className="text-sm px-4 py-1.5 rounded-lg text-white font-medium transition-opacity hover:opacity-90"
                              style={{ background: info.color }}
                              onClick={() => { window.location.href = info.oauthPath }}
                            >
                              Connect
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="mt-5 p-3 rounded-xl bg-bg-hover border border-border text-xs text-text-muted">
                <span className="font-medium text-text-secondary">💡 Tip:</span> Facebook & Instagram share one OAuth flow. Google Business & Calendar share one Google login.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-green/90 text-white px-4 py-2 rounded-lg text-sm font-medium z-50 animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  )
}
