'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { AGENTS, SKILLS } from '@/lib/ai/capabilities'
import { classifyRequest, type RouteDecision } from '@/lib/ai/router'
import { normalizeDocumentDraft } from '@/lib/ai/document-draft'
import { getLaborFlatAmount, laborLineTotal, partLineTotal } from '@/lib/document-money'
import type { RepairSearchResult } from '@/lib/repair/sources'
import { parseRepairQuery } from '@/lib/repair/sources'
import { buildRepairPresentation, detectRepairDtc, repairVehicleLabel, repairWorkspaceUrl, REPAIR_DTC_GUIDES } from '@/lib/repair/presentation'
import {
  formatBrowserOpenResult,
  formatDownloadResult,
  isVerifiedBrowserOpen,
  isVerifiedDownloadResult,
  looksLikePartsRequest,
  normalizePartsQuery,
  parseBrowserRequest,
  parseDesktopImageRequest,
  wantsKaptureSetup,
  wantsOpenPreviousDesktopFile,
  type DesktopOpenResult,
} from '@/lib/ai/desktop-actions'

type SpeechRecognition = any
type SpeechRecognitionEvent = any

// Connector info for popup
const CONNECTOR_SERVICE_INFO: Record<string, { icon: string; name: string; description: string; color: string; bgColor: string; oauthPath: string }> = {
  facebook: { icon: 'FB', name: 'Facebook Pages', description: 'Post updates, reply to comments, manage messages', color: '#1877F2', bgColor: 'rgba(24,119,242,0.1)', oauthPath: '/api/auth/facebook' },
  instagram: { icon: 'IG', name: 'Instagram Business', description: 'Post photos, reply to comments and DMs', color: '#E1306C', bgColor: 'rgba(225,48,108,0.1)', oauthPath: '/api/auth/facebook' },
  google_business: { icon: 'GB', name: 'Google Business Profile', description: 'Post updates, reply to reviews, see ratings', color: '#4285F4', bgColor: 'rgba(66,133,244,0.1)', oauthPath: '/api/auth/google' },
  google_calendar: { icon: 'GC', name: 'Google Calendar', description: 'Schedule appointments, manage bookings', color: '#0F9D58', bgColor: 'rgba(15,157,88,0.1)', oauthPath: '/api/auth/google' },
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

type BrowserPanelStep = {action:string;screenshot?:string;screenshotUrl?:string;url:string;title:string}
type PrefetchedManual = {
  url: string
  title: string
  procedureText: string
  images: { url: string; alt: string }[]
  intent: 'procedure' | 'diagram'
  diagramFound: boolean
}
type RepairChatResult = { query: string; data: RepairSearchResult; manual?: PrefetchedManual }

// Pick the vehicle variant automatically instead of making him click an engine
// wall: engine-keyed entries carry the deep manual content; prefer automatics;
// avoid hybrid unless he asked for one.
function pickBestManualStart(matches: Array<{ title: string; url: string; hasImages?: boolean }>, query: string) {
  if (!matches?.length) return null
  const q = query.toLowerCase()
  return matches
    .map(m => {
      let decoded = m.url
      try { decoded = decodeURIComponent(m.url) } catch { /* raw */ }
      const t = `${m.title} ${decoded}`.toLowerCase()
      let s = 0
      if (/\b[lv]\d+-\d/i.test(decoded)) s += 30
      if (/automatic/i.test(t)) s += 8
      if (/hybrid/i.test(t) && !/hybrid/.test(q)) s -= 20
      if (m.hasImages) s += 4
      return { m, s }
    })
    .sort((a, b) => b.s - a.s)[0].m
}
type RepairDtcGuide = {
  meaning: string
  checks: string[]
  dontAssume: string[]
  action: string
  focusTerms: string
  removalTerms: string
  requiredTerms: string[]
}
interface ChatMessage { role: 'user'|'assistant'|'browser'; content: string; html?: string; imageUrl?: string; reasoning?: string; thinkingSeconds?: number; browserSteps?: BrowserPanelStep[]; repairResult?: RepairChatResult }
type ToolActivity = { time: string; agent: string; skill?: string; tool: string; status: 'running' | 'ok' | 'error'; detail: string }

function getAIErrorMessage(data: unknown, fallback = 'AI request failed') {
  if (!data || typeof data !== 'object') return fallback
  const error = (data as { error?: unknown }).error
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  try { return JSON.stringify(error) } catch { return fallback }
}

async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  } catch {
    // Cookie auth may still work; let the server return the real error if not.
  }
  return headers
}

// Stream a manual diagram through our own origin so it renders inline in the chat
// (charm.li / lemon-manuals block hot-linking).
function proxiedImage(url: string) {
  return `/api/repair-image?url=${encodeURIComponent(url)}`
}

// Render manual procedure text safely: escape HTML, then bold the **headings**.
// Newlines are preserved by whitespace-pre-wrap on the container.
function renderProcedureHtml(text: string) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-text-primary">$1</strong>')
}

const SYSTEM_PROMPT = `You are Alpha AI, the intelligent assistant for Alpha International Auto Center, an auto repair shop in Houston, TX.

SHOP INFO:
- Name: Alpha International Auto Center | 10710 S Main St, Houston TX 77025
- Phone: (713) 663-6979 | Labor Rate: $120/hr | Tax Rate: 8.25%
- Payment: Cash, Card, Zelle, Cash App
- Technicians: Paul (senior), Devin, Luis, Louie

PERSONALITY: Confident, direct, knowledgeable. Short sentences. You know cars inside and out. Be conversational and natural - you're talking to a mechanic who's busy, be efficient.

SMART ASSISTANT RULES - YOU MUST FOLLOW THESE:

1. UNDERSTAND INTENT - THINK LIKE A MECHANIC:
You are smart. The user speaks casually. Understand what they MEAN, not just exact words.
- "get me all 4 brakes for a 2006 civic from autozone" = search front rotors + rear rotors, show individual prices per position, total for all 4, and any kit options
- "look up parts for Rufina's car" = searchCustomers for Rufina ? get her vehicle ? search parts for that vehicle
- "how much for brakes on the Audi" = find the Audi in context ? search brake parts + prices
- "make me a quote for that" = use prices from your LAST search, don't re-search. Build estimate with proposeDocument.
- "send it to her" = email/text to the customer already in conversation
- "$280 flat for thermostat for Asheanna" = create invoice, Asheanna, thermostat, $280, no tax
- "get all 4 brakes for alex rig phone 832-555-1234 and make an estimate with labor" = search alex rig ? find vehicle ? search parts ? calculate labor ? build full estimate

2. PARTS SEARCH FORMAT - ALWAYS USE THIS:
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

**Kit Option: PowerStop Front+Rear Kit** - $256.99 (includes pads) [View](real-url)

3. MULTI-STEP EXECUTION:
When one sentence implies multiple steps, do ALL of them automatically:
- Name mentioned ? searchCustomers FIRST ? get their vehicle
- "make an estimate" ? use prices already found + add labor
- "with labor" ? use standard labor times (see below)
- "send it" ? draft the exact email/text and use the confirmation flow before sending
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
- If the user says "use the $54.99 ones" - use $54.99, not a different price.

6. BREVITY:
- Keep responses SHORT. Max 3-5 lines for simple answers.
- Use bullet points, not paragraphs.
- No over-explaining. No repeating yourself.
- Act like a smart assistant, not a confused robot.

7. NEVER ASK OBVIOUS QUESTIONS:
- Don't ask "what vehicle?" if you already know it
- Don't ask for confirmation on searches - just search
- Don't ask for the labor rate - it's always $120/hr
- Don't ask for tax rate - it's always 8.25% on parts
- If user says "flat" or "no tax" - set tax to 0
- ONE response per turn. No loops. No repeating.

8. CUSTOMER-FIRST LOGIC:
- Any name mentioned = searchCustomers immediately
- Found customer = use their vehicle, phone, email automatically
- Not found = tell user, ask if they want to create new
- NEVER auto-create customers without explicit instruction

CRITICAL BEHAVIOR RULES:
0. REPAIR, DIAGNOSTIC, AND DIAGRAM QUESTIONS ARE MANUAL-ONLY. For any car problem, trouble code (P0420, etc.), symptom, wiring diagram, schematic, fuse/relay location, torque spec, capacity, or repair procedure, the answer comes ONLY from the repair manual sources - NEVER from webSearch. Do NOT use webSearch for repair/diagnostic/diagram/spec questions. Only go to the web if the user EXPLICITLY says to look it up online or search the web, and even then the manual stays the primary source. webSearch is for PARTS PRICES, not repair information.
1. When the user mentions "look online", "search for", "find prices for", "look up parts", "check prices", "what does a ___ cost" - you MUST use the webSearch tool to find REAL prices.
3. When the user says "go to website", "browse to", "visit", "open URL", or gives a specific URL to check:
{"tool":"browse","url":"https://example.com","task":"what is on this page"} NEVER make up or estimate prices. NEVER guess part costs. Always search first.
2. When the user provides a customer name or email during a conversation, IMMEDIATELY use that information. If building an estimate, attach the customer name/email to it. NEVER auto-create a customer just because someone mentions a name. ALWAYS use searchCustomers FIRST to check if they already exist. Only use createCustomer if the user EXPLICITLY says to add/create a new customer AND the search confirms they don't exist.
3. When the user says "email it", "send it", "text it", "send the estimate", "email that to them" - resolve the document and recipient, then show the confirmation card before sending. Never send SMS, email, calls, external posts, payments, deletes, checkout submissions, or MCP action tools without confirmation.
4. Think step by step. If a user gives you multiple instructions in one message, handle ALL of them in order.
5. Keep context across the conversation. Remember what estimate you're working on, which customer you're discussing, what vehicle, etc.
6. When building estimates:
   - If user says "labor only" or "only labor", set parts to empty/zero
   - If user mentions a payment already made, note it (e.g., "Customer paid $70 towards labor")
   - Always include the customer name on the estimate if you know it
   - Search for part prices online before creating the estimate - use REAL prices
7. For quotes: search part prices first using webSearch, then proposeDocument with real numbers from the search

WHEN TO SEARCH vs WHEN TO BUILD AN ESTIMATE - THIS IS CRITICAL:
- If the user says "look online", "search for", "find prices", "give me options", "what's available", "check prices for" ? ONLY search and present results conversationally as plain text. Do NOT call proposeDocument. Do NOT create an estimate unless they explicitly ask.
- If the user says "make an estimate", "quote it", "build a quote", "make a invoice", "write it up", "create an estimate" ? THEN search prices first and use proposeDocument to create an estimate.
- If the user gives you specific line items with prices (like "Replace charcoal canister: $180, labor 1 hour") ? THEN they want an estimate, use proposeDocument.
- If the user says "look online for X AND make a quote/estimate" ? THEN search AND build an estimate.
- When presenting search results WITHOUT an estimate request, format them clearly with prices, options, sources, and clickable links. Then ask: "Want me to build an estimate with any of these?"
- NOT everything needs to be an estimate. Sometimes the user just wants information. Be conversational FIRST - present info, then ask what they want to do next.
- "Look online for front brakes for a 2016 Civic" = SEARCH and SHOW results as text. That's it. Do NOT call proposeDocument.
- "Look online for front brakes and make me a quote" = SEARCH then BUILD estimate with proposeDocument.

WHEN PRESENTING SEARCH RESULTS:
- ALWAYS include clickable markdown links to the source/product page for each result. The search results include URLs - use them.
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

LINKS AND URLs - STRICT RULES:
- NEVER fabricate or make up URLs. Only use EXACT URLs that were returned by the webSearch tool results.
- When showing search results, copy the EXACT URL from the search results. Do NOT modify URLs, guess URL patterns, or construct new URLs.
- If the search results don't include a direct product URL, either don't include a link or use the URL that was actually returned. NEVER invent a URL.
- NEVER invent part numbers. Only mention part numbers if they appeared in the search results text.
- It is BETTER to have NO link than a FAKE link. Fake links lead to 404 pages and make the shop look bad.

HOW YOU WORK:
You receive a task. You think through ALL steps internally. You execute them one at a time using JSON tool calls. When everything is done, you give ONE final plain-text response confirming what was completed.

TOOL CALLS - respond with ONLY a raw JSON object, no markdown, no code blocks, no extra text:

WEB SEARCH - Search the web for real-time information including prices, images, news, part numbers, and anything else. Use this whenever the user asks to "look online", "search for", "find prices", "find images", "find pictures", "show me", "check availability", "what does X cost", "go to google", "get me a picture of", or any request for current pricing/info/images. NEVER guess prices - always search first. Use webSearch for ALL web lookups. Use webSearch for ALL web lookups - prices, images, videos, part numbers, diagnostics, labor times, TSBs, recalls, and any real-time information. webSearch returns rich results including: text results with URLs and favicons, product images, YouTube videos with embed URLs, Price Radar (price comparison across stores with best deal highlighted), Knowledge Panels (DTC codes, fluid specs), AI summaries, Smart Follow-up suggestions, and Related Searches. webSearch now returns rich results including product images, YouTube videos, price comparisons (Price Radar), and smart follow-up suggestions.
{"tool":"webSearch","query":"2007 Honda Civic lower control arm price"} ALWAYS present rich results to the user: show product images using markdown ![img](url), embed YouTube videos, show Price Radar as a comparison table with best deal highlighted, display Knowledge Panels for DTC codes and fluid specs, offer follow-up suggestions as clickable options, and show related searches.

REPAIR / DIAGNOSTIC / DIAGRAM LOOKUP - For ANY car problem, trouble code (P0420), symptom, wiring diagram, fuse/relay location, torque spec, capacity, or repair procedure, use repairSearch to pull from the repair manuals. This is the ONLY source for repair info - NEVER use webSearch for repair/diagnostic/diagram questions. Include the vehicle in the query; if you don't know the vehicle, ASK the user first instead of guessing.
{"tool":"repairSearch","query":"2012 Honda Accord P0420 catalytic converter diagnostic"}

CREATE CUSTOMER - Create a new customer record. Use when user mentions a new person's name/phone/email that isn't in the system yet:
{"tool":"action","action":"createCustomer","payload":{"name":"John Doe","phone":"555-1234","email":"john@example.com"}}

CREATE JOB - Open a new work order for a customer's vehicle:
{"tool":"action","action":"createJob","payload":{"customer_name":"John Doe","vehicle_year":"2019","vehicle_make":"Toyota","vehicle_model":"Camry","status":"Pending","notes":"Front brakes squeaking"}}

CREATE DOCUMENT (visual preview card) - ALWAYS use proposeDocument for ALL document types: Invoices, Estimates, AND Invoices. This shows a formatted preview card with parts and labor breakdown so the user can review before saving. Include customer_email and customer_phone if you have them. Set "type" to "Invoice", "Estimate", or "Invoice" as appropriate:
{"tool":"proposeDocument","type":"Estimate","customer":"John Doe","customer_email":"john@example.com","customer_phone":"555-1234","vehicle":"2019 Toyota Camry","parts":[{"name":"Brake Pads Front","qty":1,"unitPrice":45.99},{"name":"Rotors Front Pair","qty":1,"unitPrice":89.99}],"labors":[{"operation":"Front brake replacement","hours":1.5,"rate":120}],"notes":"Standard brake job"}
For invoices: {"tool":"proposeDocument","type":"Invoice","customer":"John Doe","customer_email":"john@example.com","customer_phone":"555-1234","vehicle":"2019 Toyota Camry","parts":[{"name":"Brake Pads","qty":1,"unitPrice":45.99}],"labors":[{"operation":"Brake replacement","hours":1.5,"rate":120}],"notes":""}
For invoices (same as invoices, use type Invoice): {"tool":"proposeDocument","type":"Invoice","customer":"John Doe","customer_email":"john@example.com","customer_phone":"555-1234","vehicle":"2019 Toyota Camry","parts":[{"name":"Thermostat","qty":1,"unitPrice":280}],"labors":[],"notes":"Flat rate","apply_tax":false,"tax_rate":0}
IMPORTANT: NEVER use createInvoice directly. ALWAYS use proposeDocument so the user can preview, edit, or delete before saving.
DOCUMENT PRICE RULES:
- If the user says "for $X", "total $X", "price is $X", "flat", "for everything", or "parts and labor", treat that amount as the hard final total.
- Do not add another mentioned number unless the user clearly says it is a separate line charge.
- Preserve itemized services as separate labor lines. For flat-total work, use labors with {"operation":"...","amount":X,"pricing":"flat"} instead of fake parts.
- Flat/customer-supplied/parts-and-labor invoices are no tax unless the user explicitly asks for tax.
- Never output a $0 line when the user gave a price for that work.

UPDATE JOB STATUS:
{"tool":"action","action":"updateJobStatus","payload":{"customer_name":"John Doe","status":"Ready for Pickup"}}

UPDATE CUSTOMER:
{"tool":"action","action":"updateCustomer","payload":{"name":"John Doe","phone":"555-9999"}}

VOID DOCUMENT:
{"tool":"action","action":"voidDocument","payload":{"doc_number":"EST-2025-0001"}}

EMAIL ESTIMATE/INVOICE - Send an estimate or invoice to a customer via email. Use when user says "email it", "send the estimate", "email invoice to John". Can look up by doc_number, customer_name, or customer_id:
{"tool":"action","action":"sendEstimateEmail","payload":{"doc_number":"EST-2025-0001"}}
You can also pass customer_name or customer_id if you don't have the doc_number:
{"tool":"action","action":"sendEstimateEmail","payload":{"customer_name":"John Doe","email":"john@example.com"}}

SEND SMS TO CUSTOMER - Text an estimate or message to a customer. Use when user says "text it", "text the estimate", "send a text":
{"tool":"message","to":"+15551234567","channel":"sms","body":"Hi John, your estimate from Alpha International is ready. Total: $450.00"}

SCHEDULE FOLLOW-UP:
{"tool":"action","action":"scheduleFollowUp","payload":{"customer_name":"John Doe","channel":"sms","scheduled_for":"2025-01-15T10:00:00Z","message_body":"Hi John, just checking in..."}}

SEARCH CUSTOMERS - Search for existing customers by name, phone, email, or any text. ALWAYS use this BEFORE creating a customer. Use when user mentions ANY customer name, asks "find customer", "look up", "who is", "do we have", or any customer reference:
{"tool":"action","action":"searchCustomers","payload":{"query":"John"}}
Searches by partial name, phone number, email, or address. Returns matching customers AND their related jobs. Present results clearly: show name, phone, email, and recent jobs. If no match found, tell the user and ask if they want to create a new customer.

GET CUSTOMER HISTORY - Look up everything about a customer:
{"tool":"action","action":"getCustomerHistory","payload":{"customer_name":"John Doe"}}

GET SHOP STATS - Get current shop performance metrics:
{"tool":"action","action":"getShopStats","payload":{}}

DELETE RECORD:
{"tool":"action","action":"deleteRecord","payload":{"table":"customers","id":"uuid-here"}}

SEND MESSAGE (shows confirmation card before sending):
{"tool":"message","to":"+15551234567","channel":"sms","body":"Hi, your vehicle is ready!","customerId":"uuid-if-known","customerName":"John Doe"}
For email: {"tool":"message","to":"john@example.com","channel":"email","subject":"Your Estimate","body":"Hi John, attached is your estimate.","customerId":"uuid-if-known","customerName":"John Doe"}
CRITICAL for email: ALWAYS use searchCustomers first to get their email. Put the real email in "to". Include "customerId" and "customerName" whenever you have them - this links the message to the customer record. If the user gave you an email, use it. If you only have a name, search first.
IMPORTANT: If user says "email [name] this message" - search for that customer first, get their email, then call message tool with email in "to" and their customerId.

PLACE PHONE CALL - connects the user directly to someone (you are NOT on the call):
{"tool":"call","to":"+15551234567","name":"Customer Name"}
Use when user says: "call 2819008141", "call John", "dial this number", "ring them" - just a number or name with no task attached.

AI VOICE CALL - AI calls someone and has a FULL CONVERSATION to complete a task (you ARE the caller):
{"tool":"aiVoiceCall","to":"+15551234567","task":"Tell them their car is ready for pickup","callerName":"Alpha International Auto Center"}
Use when there is a MESSAGE or TASK to deliver/handle. If it's just "call X" with no task, use call instead.

NAVIGATE:
{"tool":"navigate","view":"jobs"}

CUSTOMER INFORMATION:
- When the user mentions a customer name for an estimate or invoice, ask for their email and phone number if not already provided.
- Keep it natural: "Got it - Paul Jones. What's his email and phone so I can add it to the estimate?"
- If the user provides email/phone during conversation, ALWAYS include them when creating estimates AND invoices using customer_email and customer_phone fields.
- If the user says they don't have it or to skip it, that's fine - create the document without it.
- When proposing an estimate or creating an invoice, always pass customer_email and customer_phone if you have them. This is critical - never drop phone or email that the user provided.

EXECUTION RULES:
1. Think through the full plan before starting
2. Execute each step silently - ONE tool call per turn, no explanation text
3. NEVER output text AND a tool call together - pick one
4. For quotes/estimates: ALWAYS search part prices first (webSearch), then proposeDocument with REAL numbers. But ONLY use proposeDocument if the user actually asked for an estimate/quote - if they just asked to search or find prices, respond with plain text results instead.
5. For new customers: ALWAYS searchCustomers first. Only createCustomer if user explicitly asks AND search confirms they don't exist
6. When ALL steps done: respond in plain text - 1-3 sentences max confirming what was completed
7. NEVER ask for info already in the conversation - use what was provided
8. Confirm destructive actions (void, delete) before executing
9. When user says "email it" or "text it" - just do it, don't ask for confirmation unless you're missing the recipient
10. If a customer name and email are mentioned together, always associate them

SOCIAL MEDIA & CONNECTORS:
- When the user asks to post to Facebook, Instagram, or Google Business - use the connector tool
- When asked to check comments, reviews, or messages - fetch and present them
- When asked to reply to comments or reviews - use the reply connector tool
- When asked to schedule an appointment - use Google Calendar
- When asked to find customers on social media - search Facebook messages and comments
- Always confirm before posting publicly (show draft first, say "Here's the draft - want me to post this?")
- For Instagram posts, an image URL is required
- If a connector returns an error containing 'pending approval' or 'case 2-5894000040376', tell the user: 'Google Business API access is pending approval from Google - you submitted the request today and should hear back within 5 business days via msamemy23@gmail.com.'

CONNECTOR TOOL CALLS - respond with ONLY a raw JSON object:

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

         

 
 
 
    SCHEDULE TASK - Schedule automated tasks to run at specific times. Use when user says "post at 5am", "remind me at", "schedule", "every morning", "do this at 7pm": {"tool":"scheduleTask","name":"Morning Post","schedule":"5:00am","task_prompt":"Post to Facebook: Good morning Houston!"} Schedule formats: "5:00am" (daily), "mon 9:00am" (weekly), "every 2h" (repeating) The task_prompt should be exactly what you'd type in the AI chat to execute the task.  FACEBOOK POST TARGET: When posting to Facebook, ALWAYS include "target" in payload. Ask the user: "Want me to post to the business page, your personal profile, or both?" Target options: "page" (Alpha International), "profile" (Aaron Sammy), "both" (default)  NAVIGATE: {"tool":"navigate","view":"jobs"} - For app views OR URLs. Pass full URL for web pages.  GOOGLE CALENDAR DELETE EVENT:
{"tool":"connector","connector":"google_calendar","action":"delete_event","payload":{"event_id":"..."}}
STAFF MANAGEMENT - Add, remove, or list shop employees. Use when user says "add employee", "hire someone", "remove staff", "fire", "who works here", "list the team":
Add employee:    {"tool":"action","action":"addStaff","payload":{"name":"Carlos","role":"technician"}}
Remove employee: {"tool":"action","action":"removeStaff","payload":{"name":"Carlos"}}
List all staff:  {"tool":"action","action":"listStaff","payload":{}}
Roles available: technician | employee | manager | owner

TIME CLOCK REPORT - Get attendance and hours worked for any date range or specific employee. Use when user asks "how many hours did X work", "show me attendance", "time report", "who clocked in today", "payroll hours":
All staff:       {"tool":"action","action":"getTimeclockReport","payload":{"startDate":"2026-03-01","endDate":"2026-03-26"}}
One employee:    {"tool":"action","action":"getTimeclockReport","payload":{"startDate":"2026-03-01","endDate":"2026-03-26","staff_name":"Paul"}}
Dates are YYYY-MM-DD. Omit staff_name to get all employees.

APPOINTMENTS - Create, update, or delete scheduled appointments. Use when user says "schedule an appointment", "book a time", "cancel appointment", "move the appointment", "reschedule":
Create: {"tool":"action","action":"createAppointment","payload":{"customer_name":"John Smith","scheduled_date":"2026-03-27","scheduled_time":"10:00","service":"Oil Change","vehicle":"2019 Honda Civic","notes":"Prefers synthetic"}}
Update: {"tool":"action","action":"updateAppointment","payload":{"id":"123","status":"Confirmed","scheduled_time":"11:00"}}
Delete: {"tool":"action","action":"deleteAppointment","payload":{"id":"123"}}

DOCUMENTS - Update existing estimates or invoices. Use when user says "mark as paid", "update the invoice", "change the status", "add notes to the estimate", "close this job out":
{"tool":"action","action":"updateDocument","payload":{"id":"uuid-here","status":"Paid","notes":"Customer paid cash"}}
Updatable fields: status | notes | amount | tax | warranty_type | warranty_months | warranty_mileage

AUTOMATION CONTROL - Turn built-in automations on/off, run them now, or check status. Use when user says "turn on review requests", "enable service reminders", "pause follow-ups", "run win-back campaign now", "what automations are running":
Toggle on:  {"tool":"automationControl","action":"toggle","id":"review_requests","enabled":true}
Toggle off: {"tool":"automationControl","action":"toggle","id":"service_reminders","enabled":false}
Run now:    {"tool":"automationControl","action":"run_now","id":"estimate_followups"}
Status:     {"tool":"automationControl","action":"status"}
Automation IDs: review_requests | estimate_followups | re_engagement | service_reminders | lead_discovery | lead_outreach | sms_blast | social_posts | review_responses | appointment_reminders

WEB AUTOMATION - Browse the web, research prices, scrape competitor sites, search the internet. Use when user asks to "check", "look up", "find price", "search online", "go to website", "check competitor", "research":
{"tool":"webAutomation","type":"search","query":"NAPA oil filter W7317 price"}
{"tool":"webAutomation","type":"scrape","url":"https://example.com","task":"find their prices"}
{"tool":"webAutomation","type":"parts_price","query":"2019 Toyota Camry oil filter"}
{"tool":"webAutomation","type":"monitor_competitor","url":"https://competitor-shop.com","task":"what services do they offer"}

CLARIFICATION RULE - If you do not fully understand what the user is asking, ALWAYS ask a clarifying question BEFORE taking any action. Never guess on destructive or irreversible actions (delete, remove, send, deactivate). If user says "remove him" with multiple employees ask which one. If user says "send it" without specifying a document ask which document and to whom.
`

const DESKTOP_TOOLS_PROMPT = `DESKTOP TOOLS (only available in the desktop app - window.electronAPI must exist):
These tools control limited desktop features. If the user asks to open Chrome, download an image/file, open a file that Alpha AI saved, use Kapture, notify, print, save, screenshot, get system info, or browse using the local computer, you MUST use one of these tools. Never claim a desktop action succeeded until the tool result says ok:true.

DESKTOP OPEN APP - Open an allowlisted Windows app. Currently supports Google Chrome and Comet:
{"tool":"desktopOpenApp","app":"chrome"}
{"tool":"desktopOpenApp","app":"comet"}
Open Chrome to a URL:
{"tool":"desktopOpenApp","app":"chrome","url":"https://www.google.com/search?q=pikachu"}

DESKTOP DOWNLOAD IMAGE - Search for or download a public image and save it to the Desktop. Use when the user asks for a picture/image/photo to be downloaded:
{"tool":"desktopDownloadImage","query":"Pikachu","filename":"pikachu.png","open":true}
If you already have an exact image URL from webSearch, pass it:
{"tool":"desktopDownloadImage","url":"https://example.com/image.png","filename":"image.png","open":true}

DESKTOP OPEN FILE - Open a file that Alpha AI saved/downloaded/selected in this desktop session. Use the exact path returned by desktopSave, desktopPDF, or desktopDownloadImage:
{"tool":"desktopOpenFile","path":"C:\\\\Users\\\\aaron\\\\Desktop\\\\pikachu.png"}

DESKTOP KAPTURE SETUP - Open Chrome to the Kapture extension/setup page and explain the connection steps:
{"tool":"desktopKaptureSetup"}

DESKTOP NOTIFY - Send a native Windows desktop notification. Use when user says "notify me", "send a notification", "alert me", "remind me with a popup":
{"tool":"desktopNotify","title":"Job Ready","body":"2019 Honda Civic is ready for pickup"}

DESKTOP BROWSE - Use local browser to scrape a website or search the web. Faster than Vercel-based scraping, works on any site. Use when user says "browse to", "check that site", "scrape", or "use the desktop browser":
{"tool":"desktopBrowse","url":"https://autozone.com/p/oil-filter","task":"get the price"}
For search: {"tool":"desktopBrowse","type":"search","query":"2019 Honda Civic oil filter price AutoZone"}

DESKTOP PRINT - Open the system print dialog for the current page:
{"tool":"desktopPrint"}

DESKTOP SAVE PDF - Save the current page as a PDF file (shows save dialog):
{"tool":"desktopPDF","filename":"invoice-2026.pdf"}

DESKTOP SAVE FILE - Save any text content as a file (shows save dialog):
{"tool":"desktopSave","content":"file content here","filename":"notes.txt"}

DESKTOP SCREENSHOT - Take a screenshot of the current app window:
{"tool":"desktopScreenshot"}

DESKTOP SYSTEM INFO - Get non-identifying shop computer hardware info: OS, RAM, CPU. Use when user asks about computer specs, memory, system version, or overall system info:
{"tool":"desktopSystemInfo"}

DESKTOP MCP STATUS - Discover advanced local MCP agents, skills, resources, prompts, and tools. Use this before any MCP action, or when the user asks what desktop/browser tools are available:
{"tool":"desktopMcpStatus"}

DESKTOP MCP TOOL - Call an allowlisted local MCP tool. Servers:
- windows: Windows-MCP for Windows apps, UI snapshots, screenshots, app control, and desktop automation.
- kapture: Kapture Chrome DevTools browser automation. Requires the Kapture Chrome extension and a connected tab.

Always discover tools first with desktopMcpStatus, then call exact tool names from the result:
{"tool":"desktopMcpTool","server":"windows","name":"Snapshot","arguments":{}}
{"tool":"desktopMcpTool","server":"windows","name":"Screenshot","arguments":{}}
{"tool":"desktopMcpTool","server":"kapture","name":"list_tabs","arguments":{}}
{"tool":"desktopMcpTool","server":"kapture","name":"dom","arguments":{"tabId":"TAB_ID"}}

MCP safety rules:
- Ask the user for confirmation before changing Windows apps, typing, clicking, sending data, closing tabs, changing files/settings, using PowerShell, registry, process, clipboard, or any destructive action.
- If a native confirmation dialog appears, tell the user exactly what action is being requested.
- Prefer read-only tools first: windows Snapshot/Screenshot/Scrape and kapture list_tabs/tab_detail/dom/elements/screenshot/console_logs/network_requests.
- If Kapture says no tabs are connected, tell the user to install/open the Kapture Chrome extension, click the Kapture toolbar extension, and connect the tab.`

function formatPartsLookupText(query: string, data: any, browserResult?: DesktopOpenResult) {
  const opened = browserResult
    ? isVerifiedBrowserOpen(browserResult)
      ? `Opened ${browserResult.app || 'browser'} to the search page and verified the local process started. Parts data below comes from verified source lookup, not an unverified browser claim.\n\n`
      : `Browser open was not verified: ${browserResult.error || 'unknown error'}.\n\n`
    : ''
  const options = Array.isArray(data?.options) ? data.options : []
  const kits = Array.isArray(data?.kits) ? data.kits : []
  const sourceUrls = Array.isArray(data?.searchUrls) ? data.searchUrls : []
  const positions = Array.isArray(data?.positions) ? data.positions : []
  let text = `${opened}Parts lookup for ${data?.vehicle || query}`
  if (positions.length) text += `\nPositions: ${positions.join(', ')}`
  text += '\n'

  if (!options.length && !kits.length) {
    text += '\nI could not verify exact prices from the parts lookup. I am not going to make up numbers.'
    if (sourceUrls.length) {
      text += '\n\nReal source links found:\n' + sourceUrls.slice(0, 8).map((item: { store?: string; url?: string }) => `- ${item.store || 'source'}: ${item.url}`).join('\n')
    }
    return text
  }

  for (const option of options.slice(0, 3)) {
    text += `\n**${option.brand || 'Option'}${option.tier ? ` (${option.tier})` : ''}**\n`
    for (const part of (option.parts || [])) {
      const price = typeof part.price === 'number' ? `$${part.price.toFixed(2)}` : 'price not verified'
      text += `- ${part.position || 'Part'}: ${part.name || 'Unnamed part'}${part.partNumber ? ` #${part.partNumber}` : ''} - ${price} x${part.quantity || 1}${part.store ? ` [${part.store}]` : ''}${part.url ? `\n  ${part.url}` : ''}\n`
    }
    if (typeof option.partsTotal === 'number') text += `Parts total: $${option.partsTotal.toFixed(2)}\n`
  }

  for (const kit of kits.slice(0, 3)) {
    const price = typeof kit.price === 'number' ? `$${kit.price.toFixed(2)}` : 'price not verified'
    text += `\n**Kit option: ${kit.name || 'Kit'}** - ${price}${kit.includes ? ` (${kit.includes})` : ''}${kit.store ? ` [${kit.store}]` : ''}${kit.url ? `\n${kit.url}` : ''}\n`
  }

  if (data?.laborHours && data?.laborRate) {
    text += `\nLabor reference: ${data.laborHours} hrs x $${data.laborRate}/hr = $${(data.laborHours * data.laborRate).toFixed(2)}`
  }
  if (data?.taxRate) text += `\nTax rate: ${data.taxRate}% on parts`
  return text
}

function formatRepairSearchText(query: string, data: any) {
  const view = buildRepairPresentation(query, data as RepairSearchResult)
  const checks = view.checks.slice(0, 3).map((item: string) => `- ${item}`).join('\n')
  const links = view.actionLinks.slice(0, 3).map(link => `- ${link.label}: ${link.url}`).join('\n')
  return `${view.mechanicSummary}\n\n${view.checkHeading}:\n${checks || '- I need the exact vehicle/engine before giving a confident answer.'}\n\n${view.primaryActionLabel}:\n${links || '- Tell me the engine or VIN and I will narrow this down.'}\n\nNext: ${view.action}`
}

const REPAIR_ANCHOR_TERMS = /\b(?:repair|diagnos|diagnostic|dtc|code|manual|procedure|removal|remove|install|replace|diagram|wiring|schematic|pinout|spec|torque|tsb|recall|symptom|check engine|misfire|brake|brakes|rotor|pad|caliper|control arm|strut|shock|coolant|radiator|thermostat|reservoir|alternator|starter|sensor|oxygen|catalytic|converter|suspension|steering|airbag|adas|hybrid|ev)\b/i
const REPAIR_FOLLOWUP_TERMS = /\b(?:order|firing\s+order|cylinder\s+order|cylinder\s+layout|plug\s+wire|coil|fuse|fuses|fuse\s+box|relay|relays|location|where|diagram|wiring|schematic|pinout|removal|remove|install|replace|replacement|procedure|steps?|spec|torque|test|testing|check|checks?)\b/i
// Explicit "go online" intent. Repair answers stay manual-only unless this is present.
const ONLINE_INTENT = /\b(online|search\s+(?:the\s+)?web|web\s+search|google\s+(?:it|this|that)|look\s+(?:it\s+up|up)\s+online|check\s+online|search\s+online|on\s+the\s+internet|the\s+internet)\b/i

// How the repair answer talks: a master tech texting the owner back, answering from
// real knowledge — not a form, and never stalling because the manual lookup was thin.
const REPAIR_VOICE_PROMPT = `You are Alpha AI, a master auto technician talking to the shop owner. You know OBD-II codes, symptoms, and how cars actually fail — answer from that knowledge, in plain conversational English, like you're texting him back.

Lead with the real answer: what the code or symptom means on his specific vehicle, the most common causes in the order you'd actually check them, and what it usually takes to fix. Pull in the MANUAL INFO below for vehicle-specific details — diagrams, exact specs, torque values, sensor locations — whenever it's there.

If the manual section is empty or thin, STILL answer from your own expertise. Never stall with "no source found" or "verify the source first." The only thing you don't do is invent a precise number you don't actually have: if you're not sure of an exact torque spec or wiring pinout, give the practical answer and tell him to confirm that exact figure on the manual page.

No labeled sections, no headers, no bulleted form — just talk to him. The REAL manual steps and images may be rendered below your reply — when they are, talk him through the highlights and gotchas naturally (don't re-list every step; they can see them). Only say a diagram is below when the DIAGRAM STATUS says one is actually displayed — if the book has no drawing, say that straight and offer to look online. When it fits, end by offering the obvious next move. Keep it short and useful — a few sentences, not an essay.`

function hasRepairAnchor(value: string) {
  return REPAIR_ANCHOR_TERMS.test(value) || REPAIR_FOLLOWUP_TERMS.test(value) || /\b(?:19|20)?\d{2}\b/.test(value) || /\b[PCBU][0-9A-F]{4}\b/i.test(value) || /\b[A-HJ-NPR-Z0-9]{17}\b/i.test(value)
}

function isFreshRepairVehicleOrCode(value: string) {
  return /\b(?:19|20)?\d{2}\b/.test(value) || /\b[PCBU][0-9A-F]{4}\b/i.test(value) || /\b[A-HJ-NPR-Z0-9]{17}\b/i.test(value)
}

function isLikelyRepairFollowup(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean)
  return REPAIR_FOLLOWUP_TERMS.test(value) || (words.length > 0 && words.length <= 8)
}

function followupIntentFor(text: string, guide?: RepairDtcGuide) {
  const trimmed = text.trim()
  if (/\border\b|firing\s+order|cylinder\s+order|plug\s+wire|cylinder\s+layout/i.test(trimmed)) {
    return 'firing order cylinder order cylinder layout spark plug wire coil routing'
  }
  if (/\bfuses?\b|fuse\s+box|relays?/i.test(trimmed)) {
    return 'fuse box fuse relay location diagram'
  }
  if (/\bwhere|location|located|bank\s*1|bank\s*one/i.test(trimmed)) {
    return guide ? `component location bank 1 sensor location ${guide.focusTerms}` : `component location ${trimmed}`
  }
  if (/\bdiagram|wiring|schematic|pinout\b/i.test(trimmed)) {
    return `wiring diagram schematic pinout ${trimmed}`
  }
  if (/\b(removal|remove|install|replace|replacement|procedure|steps?)\b/i.test(trimmed)) {
    return guide ? `removal procedure ${guide.removalTerms}` : `removal procedure ${trimmed}`
  }
  if (/\btest|testing|check|checks?\b/i.test(trimmed)) {
    return guide ? `diagnostic test checks ${guide.focusTerms}` : `diagnostic test checks ${trimmed}`
  }
  return guide ? `${guide.focusTerms} ${trimmed}` : trimmed
}

function buildRepairLookupQuery(text: string, lastContext: RepairChatResult | null) {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const hasFreshVehicleOrCode = isFreshRepairVehicleOrCode(trimmed)
  if (!hasFreshVehicleOrCode && lastContext && isLikelyRepairFollowup(trimmed)) {
    const vehicle = repairVehicleLabel(lastContext.data.normalizedVehicle)
    const dtc = detectRepairDtc(`${lastContext.query} ${lastContext.data.query}`)
    const guide = dtc ? REPAIR_DTC_GUIDES[dtc] : undefined
    const focus = guide?.focusTerms || lastContext.data.operationLines?.map(line => line.label).join(' ') || lastContext.data.draft?.operation || ''
    const intent = followupIntentFor(trimmed, guide)
    return [vehicle, dtc, focus, intent].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  }
  return trimmed
}

function RepairResultCard({ result, onAskNext }: { result: RepairChatResult; onAskNext?: (text: string) => void }) {
  const { query, data } = result
  const view = buildRepairPresentation(query, data)
  const [content, setContent] = useState<{ procedureText: string; images: { url: string; alt: string }[]; intent: string; sourceUrl: string; sourceTitle: string; diagramFound: boolean } | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)

  // The lookup usually prefetched the manual content along with the answer — use
  // it directly. Only fetch here for older messages restored from history.
  useEffect(() => {
    if (result.manual) {
      setContent({
        procedureText: result.manual.procedureText,
        images: result.manual.images,
        intent: result.manual.intent,
        sourceUrl: result.manual.url,
        sourceTitle: result.manual.title,
        diagramFound: result.manual.diagramFound,
      })
      return
    }
    const best = pickBestManualStart(data.manualMatches || [], query)
    if (!best) { setContent(null); return }
    let cancelled = false
    setLoadingContent(true)
    ;(async () => {
      try {
        const res = await fetch('/api/repair-manual', {
          method: 'POST',
          headers: await getAuthJsonHeaders(),
          body: JSON.stringify({ url: best.url, query }),
          signal: AbortSignal.timeout(45000),
        })
        const json = await res.json().catch(() => ({}))
        const d = json?.data || {}
        const imgs: { url: string; alt?: string }[] = Array.isArray(d.images) ? d.images : []
        if (!cancelled) setContent({
          procedureText: typeof d.procedureText === 'string' ? d.procedureText : '',
          images: imgs.slice(0, 6).map(img => ({ url: img.url, alt: img.alt || best.title })),
          intent: typeof d.intent === 'string' ? d.intent : 'procedure',
          sourceUrl: typeof d.url === 'string' ? d.url : best.url,
          sourceTitle: typeof d.title === 'string' ? d.title : best.title,
          diagramFound: imgs.length > 0,
        })
      } catch {
        if (!cancelled) setContent(null)
      } finally {
        if (!cancelled) setLoadingContent(false)
      }
    })()
    return () => { cancelled = true }
  }, [data, query, result.manual])

  return (
    <div className="space-y-3 text-sm">
      {loadingContent && !content && (
        <section className="rounded-lg border border-border bg-bg-hover p-4 text-sm text-text-muted">Pulling it straight from the manual…</section>
      )}
      {content?.procedureText && content.procedureText.length > 60 && (
        <section className="rounded-lg border border-green/25 bg-green/[0.06] p-4">
          <div className="text-xs font-black uppercase text-green">From the manual{content.sourceTitle ? ` — ${content.sourceTitle}` : ''}</div>
          <div className="mt-2 max-w-none whitespace-pre-wrap text-sm leading-6 text-text-secondary" dangerouslySetInnerHTML={{ __html: renderProcedureHtml(content.procedureText) }} />
          <a href={content.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-[11px] font-bold text-blue hover:underline">Open the full manual page</a>
        </section>
      )}
      {content && content.images.length > 0 && (
        <section className="rounded-lg border border-blue/25 bg-blue/5 p-4">
          <div className="text-xs font-black uppercase text-blue">Diagram</div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {content.images.map(img => (
              <a key={img.url} href={proxiedImage(img.url)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-white/10 bg-white transition-colors hover:border-blue/50">
                <img src={proxiedImage(img.url)} alt={img.alt} loading="lazy" className="h-auto w-full object-contain" />
              </a>
            ))}
          </div>
          <div className="mt-2 text-[11px] font-bold text-text-muted">Tap to enlarge. Straight from the manual.</div>
        </section>
      )}
      {content && content.intent === 'diagram' && !content.diagramFound && (
        <section className="rounded-lg border border-amber/30 bg-amber/10 p-4">
          <div className="text-sm font-bold text-amber">This manual doesn&apos;t carry a diagram for that.</div>
          <p className="mt-1 text-sm text-text-secondary">The steps and specs are still here — but no drawing in the book for this one.</p>
          <button className="btn btn-secondary btn-sm mt-3" onClick={() => onAskNext?.(`look online for a ${query} diagram`)}>
            Look online for one
          </button>
        </section>
      )}

      <section className="rounded-lg border border-border bg-bg-hover p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs font-black uppercase text-blue">Open in the manual</div>
          <button className="btn btn-secondary btn-sm shrink-0" onClick={() => { window.location.href = repairWorkspaceUrl(query) }}>Repair workspace</button>
        </div>
        {view.needsExactVehicle && <div className="mt-1 text-xs font-bold text-amber">Pick the engine below for the exact diagram, spec, or steps.</div>}
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {view.actionLinks.map(link => {
            const choice = view.vehicleChoices.find(item => item.url === link.url)
            const isManualChoice = link.confidence === 'manual_choice'
            return isManualChoice ? (
              <div key={`${link.kind}-${link.url}`} className="rounded-md border border-amber/25 bg-amber/10 p-3">
                <span className="block font-black text-text-primary">{link.label}</span>
                <span className="mt-1 block text-xs leading-5 text-text-secondary">{link.detail}</span>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn btn-primary btn-sm" onClick={() => onAskNext?.(choice?.selectionQuery || `${query} ${link.label}`)}>
                    Use This Engine
                  </button>
                  <a href={link.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Open Source</a>
                </div>
              </div>
            ) : (
              <a key={`${link.kind}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" className="rounded-md border border-white/10 bg-white/[0.035] p-3 transition-colors hover:border-blue/50 hover:bg-blue/10">
                <span className="block font-black text-text-primary">{link.label}</span>
                <span className="mt-1 block text-xs leading-5 text-text-secondary">{link.detail}</span>
                <span className="mt-2 inline-flex rounded border border-white/10 px-2 py-1 text-[10px] font-black uppercase text-text-muted">{link.provider || 'source link'}</span>
              </a>
            )
          })}
          {!view.actionLinks.length && <div className="text-text-muted">Tell me the engine or VIN and I will narrow this down to the right page.</div>}
        </div>
      </section>

      {view.askNext.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {view.askNext.map(item => (
            <button key={item} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-bold text-text-secondary hover:border-green/40 hover:text-text-primary" onClick={() => onAskNext?.(item)}>
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function wantsDesktopMcpCheck(text: string) {
  const lower = text.toLowerCase()
  const mentionsLocalTools = /\b(mcp|mcps|windows-mcp|kapture|tools?|skills?|agents?)\b/.test(lower)
  const asksCheck = /\b(check|test|verify|status|make sure|working|work|available|list|show|what)\b/.test(lower)
  return mentionsLocalTools && asksCheck
}


interface HistoryEntry {
  id: string
  date: string
  preview: string
  messages: ChatMessage[]
}


function BrowserPanel({ steps }: { steps: BrowserPanelStep[] }) {
  const [idx, setIdx] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [hovered, setHovered] = useState(false)
  useEffect(() => {
    setImgError(false)
    const fallback = setTimeout(() => setLoaded(true), 3000)
    if (idx < steps.length - 1) {
      const t = setTimeout(() => setIdx(i => i + 1), 2200)
      return () => { clearTimeout(t); clearTimeout(fallback) }
    }
    return () => clearTimeout(fallback)
  }, [idx, steps.length])
  const step = steps[idx] || steps[0]
  if (!step) return null
  const imgSrc = step.screenshotUrl || (step.screenshot ? `data:image/png;base64,${step.screenshot}` : null)
  const isDone = idx >= steps.length - 1
  let hostname = ''
  try { hostname = new URL(step.url).hostname } catch { hostname = step.url }
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
  const openUrl = () => window.open(step.url, '_blank', 'noopener,noreferrer')
  return (
    <div style={{borderRadius:'12px',overflow:'hidden',border:'1px solid rgba(255,255,255,0.1)',marginBottom:'4px',boxShadow:'0 4px 24px rgba(0,0,0,0.4)'}}>
      {/* Title bar */}
      <div style={{background:'#1c1c2e',padding:'8px 12px',display:'flex',alignItems:'center',gap:'8px',borderBottom:'1px solid rgba(255,255,255,0.07)'}}>
        <div style={{display:'flex',gap:'5px',flexShrink:0}}>
          <div style={{width:10,height:10,borderRadius:'50%',background:'#ff5f57'}} />
          <div style={{width:10,height:10,borderRadius:'50%',background:'#febc2e'}} />
          <div style={{width:10,height:10,borderRadius:'50%',background:'#28c840'}} />
        </div>
        <div style={{flex:1,background:'rgba(255,255,255,0.07)',borderRadius:'6px',padding:'4px 10px',fontSize:'11px',color:'#9ca3af',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer'}} onClick={openUrl} title="Click to open in browser">
          {step.url}
        </div>
        <button onClick={openUrl} title="Open in browser" style={{flexShrink:0,background:'rgba(74,222,128,0.15)',border:'1px solid rgba(74,222,128,0.3)',borderRadius:'6px',padding:'3px 10px',fontSize:'11px',color:'#4ade80',cursor:'pointer',display:'flex',alignItems:'center',gap:'4px',fontWeight:600}}>
          Open
        </button>
        <div style={{fontSize:'10px',color:isDone?'#4ade80':'#6b7280',flexShrink:0,fontWeight:600}}>{idx+1}/{steps.length}</div>
      </div>
      {/* Screenshot / content area */}
      <div
        style={{position:'relative',background:'#0a0a14',minHeight:200,cursor:'pointer'}}
        onClick={openUrl}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title="Click to open in browser"
      >
        {imgSrc && !imgError ? (
          <>
            <img key={imgSrc} src={imgSrc} alt="" style={{width:'100%',display:'block',opacity:loaded?1:0,transition:'opacity 0.4s ease'}} onLoad={()=>setLoaded(true)} onError={()=>{setImgError(true);setLoaded(true)}} />
            {!loaded && (
              <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,background:'#0a0a14'}}>
                <div style={{width:28,height:28,borderRadius:'50%',border:'3px solid rgba(74,222,128,0.2)',borderTopColor:'#4ade80'}} />
                <span style={{fontSize:'11px',color:'#4ade80'}}>Loading page...</span>
              </div>
            )}
            {/* Hover overlay */}
            {loaded && hovered && (
              <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',transition:'opacity 0.2s'}}>
                <div style={{background:'rgba(74,222,128,0.9)',color:'#000',fontWeight:700,fontSize:'14px',padding:'10px 24px',borderRadius:'8px',display:'flex',alignItems:'center',gap:'8px'}}>
                  Open in Browser
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'40px 24px',gap:16,minHeight:200}}>
            <img src={faviconUrl} alt="" style={{width:48,height:48,borderRadius:8,background:'rgba(255,255,255,0.05)',padding:4}} onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />
            <div style={{fontSize:'18px',fontWeight:600,color:'#e5e7eb',textAlign:'center'}}>{step.title || hostname}</div>
            <div style={{fontSize:'12px',color:'#6b7280',textAlign:'center',maxWidth:400}}>{step.url}</div>
            <div style={{marginTop:8,padding:'6px 16px',borderRadius:20,background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.2)',fontSize:'11px',color:'#4ade80'}}>{isDone ? 'Page analyzed' : 'Browsing...'}</div>
          </div>
        )}
      </div>
      {/* Status bar */}
      <div style={{background:'#12121f',padding:'10px 14px',borderTop:'1px solid rgba(255,255,255,0.05)',display:'flex',alignItems:'center',gap:'10px'}}>
        <span style={{fontSize:'11px',fontWeight:700,flexShrink:0}}>WEB</span>
        <span style={{fontSize:'12px',color:'#d1d5db',flex:1,lineHeight:1.5}}>{step.action}</span>
        {!isDone && <span style={{fontSize:'10px',color:'#4ade80',flexShrink:0,fontWeight:600}}>Working</span>}
        {isDone && <span style={{fontSize:'10px',color:'#4ade80',flexShrink:0,fontWeight:600}}>Done</span>}
      </div>
    </div>
  )
}

export default function AIPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hey! I'm Alpha AI, your shop command center. I can create customers, open jobs, build estimates, send texts and emails, look up anyone's history, check shop stats, schedule follow-ups, and more. What do you need?" }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [listening, setListening] = useState(false)
  const [speakEnabled, setSpeakEnabled] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
const [pendingSms, setPendingSms] = useState<{to:string;body:string;channel?:string;subject?:string;customerId?:string;customerName?:string}|null>(null)
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
  const lastDesktopFileRef = useRef<string | null>(null)
  const lastRepairContextRef = useRef<RepairChatResult | null>(null)
  // Set when we ask the user for the vehicle on a repair question; the next reply resumes the lookup.
  const pendingRepairQueryRef = useRef<string | null>(null)
  const [routeDecision, setRouteDecision] = useState<RouteDecision | null>(null)
  const [toolTimeline, setToolTimeline] = useState<ToolActivity[]>([])
  const [repairOnlyMode, setRepairOnlyMode] = useState(false)

  const addToolEvent = useCallback((event: Omit<ToolActivity, 'time'>) => {
    setToolTimeline(prev => [{
      ...event,
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
    }, ...prev].slice(0, 12))
  }, [])

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

  // Voice mode: start listening via SpeechRecognition - sends through send()
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
    // Don't speak HTML-only messages (estimate cards etc) - speak content if available
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
    const params = new URLSearchParams(window.location.search)
    const isRepairMode = params.get('mode') === 'repair' || localStorage.getItem('ai_repair_mode') === 'true'
    if (!isRepairMode) return
    setRepairOnlyMode(true)
    setMessages([{
      role: 'assistant',
      content: 'Repair Only Mode is on. I will stay focused on diagnostics, repair sources, safety checks, work notes, and estimate-ready repair details.',
    }])
  }, [])

  useEffect(() => {
    const loadContext = async () => {
      const [{ data: jobs }, { data: customers }, { data: msgs }, { data: settings }] = await Promise.all([
        supabase.from('jobs').select('customer_name,concern,status').not('status','in','("Paid","Closed")').limit(10),
        supabase.from('customers').select('id,name').order('created_at',{ascending:false}).limit(5),
        supabase.from('messages').select('from_address,body,direction').order('created_at',{ascending:false}).limit(5),
        supabase.from('settings').select('shop_name,shop_address,shop_phone,labor_rate,tax_rate,payment_methods').limit(1).single(),
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = settings as any
      const shopInfoOverride = s ? [
        `SHOP INFO (use these exact values, overriding any defaults):`,
        `- Name: ${s.shop_name || 'Alpha International Auto Center'}`,
        `- Address: ${s.shop_address || '10710 S Main St, Houston TX 77025'}`,
        `- Phone: ${s.shop_phone || '(713) 663-6979'}`,
        `- Labor Rate: $${s.labor_rate || 120}/hr`,
        `- Tax Rate: ${s.tax_rate || 8.25}%`,
        s.payment_methods?.length ? `- Payment: ${Array.isArray(s.payment_methods) ? s.payment_methods.join(', ') : s.payment_methods}` : '',
      ].filter(Boolean).join('\n') : ''
      const ctx = [
        shopInfoOverride,
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

  useEffect(() => {
    const latestRepair = [...messages].reverse().find(message => message.repairResult)?.repairResult
    if (latestRepair) lastRepairContextRef.current = latestRepair
  }, [messages])

  // Thinking timer - counts up while loading
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
    const [features, setFeatures] = useState({ search: true, socialMedia: true, thinking: false, desktopTools: true })
  // Desktop mode detection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isDesktop = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron
  const toggleFeature = (key: keyof typeof features) => setFeatures(prev => ({ ...prev, [key]: !prev[key] }))
  const toggleRepairMode = () => {
    const next = !repairOnlyMode
    setRepairOnlyMode(next)
    if (next) {
      localStorage.setItem('ai_repair_mode', 'true')
      setFeatures(current => ({ ...current, socialMedia: false }))
    } else {
      localStorage.removeItem('ai_repair_mode')
    }
  }

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
            setAttachedFile({ name: file.name, content: `[PDF file: ${file.name} - ${(file.size/1024).toFixed(0)}KB. PDF text extraction unavailable.]`, type: 'text' })
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

  const runRepairLookup = useCallback(async (text: string, userMsg: ChatMessage, forceRepairMode = false) => {
    const previousRepairContext = lastRepairContextRef.current
    const isFollowup = !!previousRepairContext && !isFreshRepairVehicleOrCode(text) && isLikelyRepairFollowup(text)
    const lookupQuery = buildRepairLookupQuery(text, previousRepairContext)
    const fallbackVehicle = isFollowup ? previousRepairContext?.data.normalizedVehicle : undefined
    const agentName = AGENTS.find(agent => agent.id === 'repair')?.name || 'Repair Agent'
    const skillName = SKILLS.find(skill => skill.id === 'source_backed_repair_research')?.name || 'Source-backed repair research'

    const finish = (assistantMsg: ChatMessage) => {
      setMessages(prev => [...prev, assistantMsg])
      saveToHistory([...messages, userMsg, assistantMsg])
      speak(assistantMsg.content)
      return true
    }

    // ── Always ask for the vehicle when we don't have one (this message OR the
    // running conversation). Never guess, never fall back to the web. ──
    const parsedNow = parseRepairQuery(text)
    const hasVehicleNow = !!(parsedNow.year && (parsedNow.make || parsedNow.model)) || !!parsedNow.vin
    const contextVehicle = previousRepairContext?.data.normalizedVehicle
    const hasContextVehicle = !!(contextVehicle && contextVehicle.year && (contextVehicle.make || contextVehicle.model))
    if (!hasVehicleNow && !hasContextVehicle) {
      // Remember the repair question so the user's next reply (the vehicle) resumes it.
      pendingRepairQueryRef.current = text
      addToolEvent({ agent: agentName, skill: skillName, tool: 'repairSearch', status: 'error', detail: 'Need the vehicle first' })
      return finish({
        role: 'assistant',
        content: 'Which vehicle? Give me the year, make, and model — and the engine or trim if you have it. I need it to pull the right diagram, spec, or procedure from the manual.',
      })
    }

    // Manual is the source of truth. Only blend in the web when the user explicitly asks to go online.
    const wantsOnline = ONLINE_INTENT.test(text)

    addToolEvent({ agent: agentName, skill: skillName, tool: 'repairSearch', status: 'running', detail: lookupQuery })
    setStatus('Searching repair manual...')

    try {
      const rr = await fetch('/api/repair-search', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ query: lookupQuery, vehicle: fallbackVehicle }),
        signal: AbortSignal.timeout(60000),
      })
      const rd = await rr.json().catch(() => ({}))
      if (rr.ok && rd?.ok && rd.data) {
        const repairData = rd.data as RepairSearchResult
        const repairResult = { query: lookupQuery, data: repairData }
        const newConfidence = repairData.workflow?.vehicleMatch?.confidence ?? 0
        const previousConfidence = previousRepairContext?.data.workflow?.vehicleMatch?.confidence ?? 0
        if (!previousRepairContext || isFreshRepairVehicleOrCode(text) || newConfidence >= previousConfidence || repairData.normalizedVehicle?.year) {
          lastRepairContextRef.current = repairResult
        }
        addToolEvent({ agent: agentName, skill: skillName, tool: 'repairSearch', status: 'ok', detail: `${repairData.sources?.length || 0} source cards, ${repairData.manualMatches?.length || 0} manual matches` })

        const manualSummary = formatRepairSearchText(lookupQuery, repairData)
        const vehicleForAnswer = repairVehicleLabel(repairData.normalizedVehicle)

        // Pull the ACTUAL manual content before writing a word, so the answer
        // talks about what's really below — real steps, a real diagram, or an
        // honest "this book doesn't have that picture".
        let manual: PrefetchedManual | null = null
        const bestStart = pickBestManualStart(repairData.manualMatches || [], lookupQuery)
        if (bestStart) {
          setStatus('Pulling it from the manual...')
          try {
            const mr = await fetch('/api/repair-manual', {
              method: 'POST',
              headers: await getAuthJsonHeaders(),
              body: JSON.stringify({ url: bestStart.url, query: lookupQuery }),
              signal: AbortSignal.timeout(45000),
            })
            const mj = await mr.json().catch(() => ({}))
            if (mr.ok && mj?.ok && mj.data) {
              const d = mj.data
              manual = {
                url: typeof d.url === 'string' ? d.url : bestStart.url,
                title: typeof d.title === 'string' ? d.title : bestStart.title,
                procedureText: typeof d.procedureText === 'string' ? d.procedureText : '',
                images: Array.isArray(d.images) ? d.images.slice(0, 6) : [],
                intent: d.intent === 'diagram' ? 'diagram' : 'procedure',
                diagramFound: !!d.diagramFound,
              }
            }
          } catch { /* manual content is optional — the answer still writes */ }
        }
        const repairResultFull: RepairChatResult = { ...repairResult, manual: manual || undefined }

        // Pull the web in only when he explicitly asked to go online. The manual is
        // always the base; the web just fills gaps.
        let webText = ''
        if (wantsOnline) {
          setStatus('Adding web sources...')
          try {
            const wr = await fetch(`/api/ai-search?q=${encodeURIComponent(lookupQuery)}`, { headers: await getAuthJsonHeaders(), signal: AbortSignal.timeout(20000) })
            const wd = await wr.json().catch(() => ({}))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const results: any[] = Array.isArray(wd?.results) ? wd.results : Array.isArray(wd?.data?.results) ? wd.data.results : []
            webText = results.slice(0, 5).map((r, i) => `${i + 1}. ${r.title || r.url || ''}\n${String(r.content || r.snippet || r.description || '').slice(0, 300)}\n${r.url || ''}`).join('\n\n')
          } catch { /* web is optional — manual still wins */ }
        }

        // Always write the answer like a normal AI talking — plain English, no form,
        // grounded in the manual. This is what shows in chat and what gets spoken.
        setStatus('Writing the answer...')
        let answer = ''
        try {
          const synth = await fetch('/api/ai-completions', {
            method: 'POST',
            headers: await getAuthJsonHeaders(),
            body: JSON.stringify({
              messages: [
                { role: 'system', content: REPAIR_VOICE_PROMPT },
                { role: 'user', content: [
                  `He asked: ${text}`,
                  `Vehicle: ${vehicleForAnswer || 'not given yet'}${manual?.title ? ` (manual page found: "${manual.title}")` : ''}`,
                  manual?.procedureText
                    ? `\nTHE ACTUAL MANUAL CONTENT (the real steps/sections are ALSO displayed below your reply — talk him through the highlights naturally, point out gotchas, don't re-list every step verbatim):\n${manual.procedureText.slice(0, 3500)}`
                    : `\nMANUAL INFO (may be thin):\n${manualSummary}`,
                  manual
                    ? (manual.diagramFound
                      ? '\nDIAGRAM STATUS: a real diagram image from the manual IS displayed below your reply — refer to it.'
                      : '\nDIAGRAM STATUS: NO diagram image exists on this manual page. If he asked for a picture/diagram, say that straight and offer to look online for one. NEVER claim a diagram is shown.')
                    : '',
                  wantsOnline ? `\nWEB (he asked to look online):\n${webText || '(nothing useful came back)'}` : '',
                ].filter(Boolean).join('\n') },
              ],
              max_tokens: 700,
              temperature: 0.4,
            }),
          })
          const sd = await synth.json().catch(() => ({}))
          const out = sd.choices?.[0]?.message?.content?.trim()
          if (synth.ok && out) answer = out
        } catch { /* fall back to the manual summary below */ }

        return finish({ role: 'assistant', content: answer || manualSummary, repairResult: repairResultFull })
      }

      addToolEvent({ agent: agentName, skill: skillName, tool: 'repairSearch', status: 'error', detail: rd?.error || 'Repair lookup failed' })
      return finish({
        role: 'assistant',
        content: `Repair lookup failed: ${rd?.error || 'Unknown error'}. Try year, make, model, engine, and the exact component, symptom, diagram, or DTC.`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown repair lookup error'
      addToolEvent({ agent: agentName, skill: skillName, tool: 'repairSearch', status: 'error', detail: message })
      return finish({
        role: 'assistant',
        content: `Repair lookup failed: ${message}. Try the Repair page with year, make, model, engine, and the exact component, symptom, diagram, or DTC.`,
      })
    } finally {
      setStatus('')
    }
  }, [addToolEvent, messages, saveToHistory, speak])

  const runDirectDesktopCommand = useCallback(async (text: string, userMsg: ChatMessage) => {
    if (!features.desktopTools || !isDesktop || typeof window === 'undefined') return false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const desktopApi = (window as any).electronAPI
    if (!desktopApi) return false
    const route = classifyRequest(text)
    const agentName = AGENTS.find(agent => agent.id === route.agentId)?.name || route.agentId
    const skillName = route.skillIds[0] ? (SKILLS.find(skill => skill.id === route.skillIds[0])?.name || route.skillIds[0]) : undefined

    const finish = (assistantMsg: ChatMessage) => {
      setMessages(prev => [...prev, assistantMsg])
      saveToHistory([...messages, userMsg, assistantMsg])
      speak(assistantMsg.content)
      return true
    }

    try {
      if (route.intent === 'mcp_status' || wantsDesktopMcpCheck(text)) {
        addToolEvent({ agent: agentName, skill: skillName, tool: 'mcpDiscover', status: 'running', detail: 'Discovering Windows-MCP and Kapture tools' })
        setStatus('Checking MCP tools...')
        const mcpResult = await desktopApi.mcp.tools()
        const servers = Array.isArray(mcpResult?.servers) ? mcpResult.servers : []
        const okServers = servers.filter((server: { ok?: boolean }) => server.ok)
        const extras = await Promise.all(okServers.map(async (server: { id: string }) => {
          const [resources, prompts] = await Promise.all([
            desktopApi.mcp.resources(server.id).catch((e: Error) => ({ ok: false, error: e.message, resources: [] })),
            desktopApi.mcp.prompts(server.id).catch((e: Error) => ({ ok: false, error: e.message, prompts: [] })),
          ])
          return { id: server.id, resources, prompts }
        }))

        const shouldRunSelfTest = /\b(test|verify|make sure|working|work)\b/i.test(text)
        let windowsTest: { ok?: boolean; error?: string } | null = null
        let kaptureTest: { ok?: boolean; error?: string; content?: Array<{ type?: string; text?: string }> } | null = null

        if (shouldRunSelfTest) {
          setStatus('Testing MCP read-only tools...')
          const [windowsResult, kaptureResult] = await Promise.allSettled([
            desktopApi.mcp.callTool('windows', 'Screenshot', { use_annotation: false }, false),
            desktopApi.mcp.callTool('kapture', 'list_tabs', {}, false),
          ])
          windowsTest = windowsResult.status === 'fulfilled' ? windowsResult.value : { ok: false, error: windowsResult.reason?.message || 'Windows-MCP test failed' }
          kaptureTest = kaptureResult.status === 'fulfilled' ? kaptureResult.value : { ok: false, error: kaptureResult.reason?.message || 'Kapture test failed' }
        }

        const toolCount = (server: { tools?: unknown[] }) => Array.isArray(server.tools) ? server.tools.length : 0
        const skillCount = extras.reduce((count, item: { resources?: { resources?: unknown[] }; prompts?: { prompts?: unknown[] } }) => (
          count + (Array.isArray(item.resources?.resources) ? item.resources.resources.length : 0) + (Array.isArray(item.prompts?.prompts) ? item.prompts.prompts.length : 0)
        ), 0)
        const windowsServer = servers.find((server: { id?: string }) => server.id === 'windows')
        const kaptureServer = servers.find((server: { id?: string }) => server.id === 'kapture')
        const kaptureText = kaptureTest?.content?.find(item => item.type === 'text')?.text || ''
        const connectedTabs = (() => {
          try {
            const parsed = JSON.parse(kaptureText)
            return Array.isArray(parsed.tabs) ? parsed.tabs.length : null
          } catch {
            return null
          }
        })()

        const lines = [
          `Windows-MCP: ${windowsServer?.ok ? `connected (${toolCount(windowsServer)} tools)` : `not connected (${windowsServer?.error || 'unknown error'})`}${windowsTest ? (windowsTest.ok ? '; Screenshot test passed' : `; Screenshot test failed: ${windowsTest.error || 'unknown error'}`) : ''}.`,
          `Kapture: ${kaptureServer?.ok ? `connected (${toolCount(kaptureServer)} tools)` : `not connected (${kaptureServer?.error || 'unknown error'})`}${kaptureTest ? (kaptureTest.ok ? `; list_tabs passed${connectedTabs !== null ? ` (${connectedTabs} connected tab${connectedTabs === 1 ? '' : 's'})` : ''}` : `; list_tabs failed: ${kaptureTest.error || 'unknown error'}`) : ''}.`,
          `MCP skills/context: ${skillCount ? `${skillCount} resources/prompts exposed` : 'no extra MCP resources/prompts exposed by these servers'}.`,
        ]

        if (connectedTabs === 0) {
          lines.push('Kapture browser automation is ready at the MCP layer, but Chrome has no connected Kapture tab yet. Install/open the extension, click the Kapture toolbar button, and connect the tab.')
        }

        addToolEvent({ agent: agentName, skill: skillName, tool: 'mcpDiscover', status: okServers.length ? 'ok' : 'error', detail: `${okServers.length}/${servers.length || 0} MCP servers connected` })
        return finish({ role: 'assistant', content: lines.join('\n') })
      }

      if (route.intent === 'browser_kapture' && !wantsKaptureSetup(text)) {
        addToolEvent({ agent: agentName, skill: skillName, tool: 'kapture.list_tabs', status: 'running', detail: 'Checking connected browser tabs' })
        setStatus('Checking Kapture tabs...')
        const result = await desktopApi.mcp.callTool('kapture', 'list_tabs', {}, false)
        const textContent = Array.isArray(result?.content)
          ? result.content.find((item: { type?: string; text?: string }) => item.type === 'text')?.text
          : ''
        let tabCount: number | null = null
        let activeTitle = ''
        try {
          const parsed = JSON.parse(textContent || '{}')
          const tabs = Array.isArray(parsed.tabs) ? parsed.tabs : []
          tabCount = tabs.length
          activeTitle = tabs.find((tab: { active?: boolean; title?: string }) => tab.active)?.title || tabs[0]?.title || ''
        } catch {
          tabCount = null
        }
        if (!result?.ok || tabCount === 0) {
          addToolEvent({ agent: agentName, skill: skillName, tool: 'kapture.list_tabs', status: 'error', detail: result?.error || 'No connected Kapture tab' })
          return finish({
            role: 'assistant',
            content: 'Kapture is installed at the MCP layer, but no Chrome tab is connected yet. Open Chrome, click the Kapture extension button on the tab, connect it, then ask again. I will not claim tab automation worked until list_tabs shows a connected tab.',
          })
        }
        addToolEvent({ agent: agentName, skill: skillName, tool: 'kapture.list_tabs', status: 'ok', detail: `${tabCount} connected tab${tabCount === 1 ? '' : 's'}${activeTitle ? `; active: ${activeTitle}` : ''}` })
        return finish({
          role: 'assistant',
          content: `Kapture is connected to ${tabCount} tab${tabCount === 1 ? '' : 's'}${activeTitle ? ` (${activeTitle})` : ''}. Read-only inspection can run now. Clicks, typing, submits, logins, deletes, posts, and sends require confirmation first.`,
        })
      }

      if (wantsOpenPreviousDesktopFile(text)) {
        const filePath = lastDesktopFileRef.current
        if (!filePath) {
          return finish({ role: 'assistant', content: 'I do not have a saved file from this desktop session yet.' })
        }
        addToolEvent({ agent: agentName, skill: skillName, tool: 'desktopOpenFile', status: 'running', detail: filePath })
        setStatus('Opening file...')
        const result = await desktopApi.files.openApproved(filePath)
        const verifiedOpen = result?.ok && result.verified === true && result.opened === true
        addToolEvent({ agent: agentName, skill: skillName, tool: 'desktopOpenFile', status: verifiedOpen ? 'ok' : 'error', detail: verifiedOpen ? filePath : (result?.error || 'File open not verified') })
        return finish({
          role: 'assistant',
          content: verifiedOpen
            ? `Opened ${filePath}.`
            : `Could not verify file open for ${filePath}: ${result?.error || 'Unknown error'}`,
        })
      }

      if (route.intent === 'repair_lookup') {
        addToolEvent({ agent: agentName, skill: skillName, tool: 'repairSearch', status: 'running', detail: text })
        setStatus('Searching repair sources...')
        const rr = await fetch('/api/repair-search', {
          method: 'POST',
          headers: await getAuthJsonHeaders(),
          body: JSON.stringify({ query: text }),
          signal: AbortSignal.timeout(60000),
        })
        const rd = await rr.json().catch(() => ({}))
        if (rr.ok && rd?.ok && rd.data) {
          addToolEvent({ agent: agentName, skill: skillName, tool: 'repairSearch', status: 'ok', detail: `${rd.data.sources?.length || 0} source cards` })
          return finish({
            role: 'assistant',
            content: formatRepairSearchText(text, rd.data),
          })
        }
        addToolEvent({ agent: agentName, skill: skillName, tool: 'repairSearch', status: 'error', detail: rd?.error || 'Repair lookup failed' })
        return finish({
          role: 'assistant',
          content: `Repair lookup failed: ${rd?.error || 'Unknown error'}. Try the Repair page with year, make, model, engine, and the exact component or DTC.`,
        })
      }

      if (route.intent === 'parts_lookup' || looksLikePartsRequest(text)) {
        const browserRequest = parseBrowserRequest(text)
        const partsQuery = normalizePartsQuery(text)
        let browserResult: DesktopOpenResult | undefined
        if (browserRequest) {
          addToolEvent({ agent: agentName, skill: skillName, tool: 'openBrowser', status: 'running', detail: `${browserRequest.app} search for ${partsQuery}` })
          setStatus(`Opening ${browserRequest.app === 'comet' ? 'Comet' : 'Chrome'}...`)
          const browserUrl = `https://www.google.com/search?q=${encodeURIComponent(partsQuery)}`
          browserResult = await desktopApi.system.openApp(browserRequest.app, browserUrl)
          const verifiedOpen = isVerifiedBrowserOpen(browserResult)
          addToolEvent({ agent: agentName, skill: skillName, tool: 'openBrowser', status: verifiedOpen ? 'ok' : 'error', detail: verifiedOpen ? `${browserRequest.app} process verified` : (browserResult?.error || 'Browser launch not verified') })
        }

        addToolEvent({ agent: agentName, skill: skillName, tool: 'partsLookup', status: 'running', detail: partsQuery })
        setStatus('Looking up parts...')
        const pr = await fetch('/api/parts-lookup', {
          method: 'POST',
          headers: await getAuthJsonHeaders(),
          body: JSON.stringify({ query: partsQuery }),
          signal: AbortSignal.timeout(45000),
        })
        const pd = await pr.json().catch(() => ({}))
        if (pr.ok && pd?.ok && pd.data) {
          const verifiedCount = Array.isArray(pd.data?.options) ? pd.data.options.reduce((count: number, option: { parts?: unknown[] }) => count + (Array.isArray(option.parts) ? option.parts.length : 0), 0) : 0
          addToolEvent({ agent: agentName, skill: skillName, tool: 'partsLookup', status: 'ok', detail: `${verifiedCount} verified price item${verifiedCount === 1 ? '' : 's'}; ${pd.data?.searchUrls?.length || 0} source link${pd.data?.searchUrls?.length === 1 ? '' : 's'}` })
          return finish({ role: 'assistant', content: formatPartsLookupText(partsQuery, pd.data, browserResult) })
        }
        addToolEvent({ agent: agentName, skill: skillName, tool: 'partsLookup', status: 'error', detail: pd?.error || 'Exact prices unavailable' })

        const search = await fetch(`/api/ai-search?q=${encodeURIComponent(partsQuery)}`, { signal: AbortSignal.timeout(20000) })
        const searchData = await search.json().catch(() => ({}))
        const links = Array.isArray(searchData?.results)
          ? searchData.results.slice(0, 6).map((item: { title?: string; url?: string; snippet?: string }, index: number) => (
            `${index + 1}. ${item.title || 'Result'}\n${item.url || ''}${item.snippet ? `\n${item.snippet}` : ''}`
          )).join('\n\n')
          : ''
        const prefix = browserResult
          ? isVerifiedBrowserOpen(browserResult)
            ? `Opened ${browserResult.app || 'browser'} to a search for "${partsQuery}" and verified the process started.\n\n`
            : `Browser open was not verified: ${browserResult.error || 'unknown error'}.\n\n`
          : ''
        return finish({
          role: 'assistant',
          content: `${prefix}I could not verify exact part prices from the lookup API, so I am not going to make up prices.${links ? `\n\nReal search results:\n${links}` : ''}`,
        })
      }

      const imageRequest = parseDesktopImageRequest(text)
      if (imageRequest) {
        const chromeRequest = parseBrowserRequest(text)
        let chromeResult: DesktopOpenResult | null = null
        if (chromeRequest) {
          addToolEvent({ agent: agentName, skill: skillName, tool: 'openBrowser', status: 'running', detail: `${chromeRequest.app} image search for ${imageRequest.query}` })
          setStatus(`Opening ${chromeRequest.app === 'comet' ? 'Comet' : 'Chrome'}...`)
          chromeResult = await desktopApi.system.openApp(chromeRequest.app, `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(imageRequest.query)}`)
          const verifiedOpen = isVerifiedBrowserOpen(chromeResult)
          addToolEvent({ agent: agentName, skill: skillName, tool: 'openBrowser', status: verifiedOpen ? 'ok' : 'error', detail: verifiedOpen ? `${chromeRequest.app} process verified` : String(chromeResult?.error || 'Browser launch not verified') })
        }

        addToolEvent({ agent: agentName, skill: skillName, tool: 'desktopDownloadImage', status: 'running', detail: imageRequest.query })
        setStatus('Downloading image...')
        const result = await desktopApi.files.downloadImage({
          query: imageRequest.query,
          filename: imageRequest.filename,
          open: imageRequest.open,
        })

        if (isVerifiedDownloadResult(result)) {
          lastDesktopFileRef.current = String(result.path)
          addToolEvent({ agent: agentName, skill: skillName, tool: 'desktopDownloadImage', status: 'ok', detail: String(result.path) })
          const chromeNote = chromeResult && !isVerifiedBrowserOpen(chromeResult) ? ` Browser search was not verified: ${chromeResult.error || 'Unknown error'}.` : ''
          return finish({
            role: 'assistant',
            content: `${formatDownloadResult(result, imageRequest.query)}${chromeNote}`,
          })
        }

        addToolEvent({ agent: agentName, skill: skillName, tool: 'desktopDownloadImage', status: 'error', detail: result?.error || 'Unknown error' })
        return finish({ role: 'assistant', content: `Image download failed: ${result?.error || 'Unknown error'}` })
      }

      const chromeRequest = parseBrowserRequest(text)
      if (chromeRequest) {
        addToolEvent({ agent: agentName, skill: skillName, tool: 'openBrowser', status: 'running', detail: `${chromeRequest.app}${chromeRequest.query ? ` search: ${chromeRequest.query}` : ''}` })
        setStatus(`Opening ${chromeRequest.app === 'comet' ? 'Comet' : 'Chrome'}...`)
        const result = await desktopApi.system.openApp(chromeRequest.app, chromeRequest.url)
        const verifiedOpen = isVerifiedBrowserOpen(result)
        addToolEvent({ agent: agentName, skill: skillName, tool: 'openBrowser', status: verifiedOpen ? 'ok' : 'error', detail: verifiedOpen ? `${chromeRequest.app} process verified` : (result?.error || 'Browser launch not verified') })
        return finish({
          role: 'assistant',
          content: formatBrowserOpenResult(result, chromeRequest),
        })
      }

      if (wantsKaptureSetup(text)) {
        addToolEvent({ agent: agentName, skill: skillName, tool: 'desktopKaptureSetup', status: 'running', detail: 'Opening setup page' })
        setStatus('Opening Kapture setup...')
        const result = await desktopApi.kapture.openSetup()
        addToolEvent({ agent: agentName, skill: skillName, tool: 'desktopKaptureSetup', status: result?.ok ? 'ok' : 'error', detail: result?.ok ? 'Setup opened' : (result?.error || 'Unknown error') })
        return finish({
          role: 'assistant',
          content: result?.ok
            ? `Opened the Kapture setup page in Chrome. Install the extension, open the tab you want to automate, then connect it from Kapture.`
            : `Kapture setup did not open: ${result?.error || 'Unknown error'}`,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      addToolEvent({ agent: agentName, skill: skillName, tool: 'desktopAction', status: 'error', detail: message })
      return finish({ role: 'assistant', content: `Desktop action failed: ${message}` })
    } finally {
      setStatus('')
    }

    return false
  }, [addToolEvent, features.desktopTools, isDesktop, messages, saveToHistory, speak])

  const send = useCallback(async (overrideInput?: string) => {
    const text = (overrideInput || input).trim()
    if (!text || loading) return
    if (!overrideInput) setInput('')
    setLoading(true)
    // Build message content - include attached file if any
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

    // Resume a repair lookup that was waiting on the vehicle: if we just asked
    // "which vehicle?" and this reply names one, re-run with the remembered question.
    if (pendingRepairQueryRef.current) {
      const pendingVehicle = parseRepairQuery(text)
      const looksLikeVehicle = !!(pendingVehicle.year || pendingVehicle.make || pendingVehicle.model || pendingVehicle.vin)
      const pending = pendingRepairQueryRef.current
      pendingRepairQueryRef.current = null
      if (looksLikeVehicle) {
        await runRepairLookup(`${pending} ${text}`.trim(), userMsg, false)
        setLoading(false)
        setStatus('')
        return
      }
    }

    const classifiedDecision = classifyRequest(text)
    const decision: RouteDecision = repairOnlyMode
      ? {
          ...classifiedDecision,
          intent: 'repair_lookup',
          agentId: 'repair',
          skillIds: ['source_backed_repair_research'],
          confidence: Math.max(classifiedDecision.confidence, 0.95),
          requiresToolResult: true,
          requiresConfirmation: classifiedDecision.requiresConfirmation,
          reasons: ['repair-only chat tab', ...classifiedDecision.reasons],
        }
      : classifiedDecision
    setRouteDecision(decision)
    const routeAgent = AGENTS.find(agent => agent.id === decision.agentId)?.name || decision.agentId
    const routeSkill = decision.skillIds[0] ? (SKILLS.find(skill => skill.id === decision.skillIds[0])?.name || decision.skillIds[0]) : undefined
    addToolEvent({
      agent: routeAgent,
      skill: routeSkill,
      tool: 'agentRouter',
      status: 'ok',
      detail: `${decision.intent} (${Math.round(decision.confidence * 100)}% confidence)`,
    })

    if (repairOnlyMode || decision.intent === 'repair_lookup') {
      await runRepairLookup(text, userMsg, repairOnlyMode)
      setLoading(false)
      setStatus('')
      return
    }

    if (await runDirectDesktopCommand(text, userMsg)) {
      setLoading(false)
      setStatus('')
      return
    }

    // AI voice call detection - "AI call", "call [business] and order/ask", "have AI call"
    const aiCallMatch = text.match(/(?:ai\s+call|have\s+(?:the\s+)?ai\s+call|call\s+\w+\s+(?:and|to)\s+(?:order|ask|find|check|get|buy|order|inquire))/i)
    if (aiCallMatch || /\bcall\b.*\b(?:autozone|napa|oreilly|o'reilly|advance|pepboys|store|shop|dealership|dealer|supplier)\b/i.test(text)) {
      // Let the AI handle it - it will use aiVoiceCall tool
    } else {
      // Direct call detection - bypass AI for plain "call XXXXXXXXXX"
    }

    // Direct call detection - bypass AI for explicit call commands
    // Matches: "call 2819008141" or "call 2819008141 and ask if he's going to church"
    const callMatch = text.match(/^(?:call|dial|phone|ring)\s+([\d\s\-\(\)\+]+?)(?:\s+(?:and|to|then)\s+(.+))?$/i)
    if (callMatch) {
      const phone = callMatch[1].replace(/\s/g, '')
      const instructions = callMatch[2]?.trim() || ''
      addToolEvent({ agent: routeAgent, skill: routeSkill, tool: 'call', status: 'error', detail: 'Blocked until call confirmation' })
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `I can call ${phone}${instructions ? ` and ask: ${instructions}` : ''}, but calls require confirmation before I dial.`,
      }])
      setLoading(false)
      setStatus('')
      return
    }

    // Build history with full content (including file)
    const msgForHistory: ChatMessage = fullContent !== text
      ? { role: 'user', content: fullContent, imageUrl: attachImageUrl }
      : userMsg
    const history2 = [...messages, msgForHistory]
    try {
      await agentLoop(history2, features, decision)
    } catch (err) {
      const errText = err instanceof Error ? err.message : 'Something went wrong'
      setMessages(prev => [...prev, { role: 'assistant', content: `Ran into an issue: ${errText}. Try again.` }])
    }
    setLoading(false)
    setStatus('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, loading, messages, shopContext, attachedFile, features, repairOnlyMode, runRepairLookup, runDirectDesktopCommand, addToolEvent])

  // Poll for voice call status/summary
  const startVoicePoll = useCallback((callId: string) => {
    if (voicePollRef.current) clearInterval(voicePollRef.current)
    voicePollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/call-summary/${callId}`, { headers: await getAuthJsonHeaders() })
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

      setStatus('Analyzing image...')
      try {
        const res = await fetch('/api/ai-completions', {
          method: 'POST',
          headers: await getAuthJsonHeaders(),
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
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.error) throw new Error(getAIErrorMessage(data, `Image analysis failed (${res.status})`))
        const raw = data.choices?.[0]?.message?.content?.trim() || 'Could not analyze the image.'
        const assistantMsg: ChatMessage = { role: 'assistant', content: raw }
        setMessages(prev => [...prev, assistantMsg])
        speak(raw)
        saveToHistory([...hist, assistantMsg])
      } catch (err) {
        const errText = err instanceof Error ? err.message : 'Try a different model or check your API key.'
        setMessages(prev => [...prev, { role: 'assistant', content: `Image analysis failed: ${errText}` }])
      }
      setLoading(false); setStatus('')
    }
    reader.readAsDataURL(file)
  }

    const agentLoop = async (history: ChatMessage[], featureFlags?: { search: boolean;  socialMedia: boolean; thinking: boolean }, routeOverride?: RouteDecision) => {
        const activeFeatures = featureFlags || { search: true, socialMedia: true, thinking: false }

    const accumulated: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastSearchMedia: {images: any[], videos: any[]} | null = null
    const agentMessages: {role: string; content: string}[] = history.map(m => ({ role: m.role, content: m.content }))

    for (let step = 0; step < 10; step++) {
      const repairOnlyContext = repairOnlyMode
        ? `\n\nREPAIR ONLY MODE:
- This chat tab is only for repair diagnostics, source-backed repair research, safety checks, shop notes, and estimate-ready repair details.
- Keep answers simple: what it means, what to check first, what not to assume, and the next shop action.
- Use repairSearch for vehicle, DTC, manual, procedure, diagram, safety, and repair-source questions.
- Do not invent torque specs, labor times, wiring pinouts, reset steps, protected manual text, or parts prices. Say when source verification is required.
- If the user asks for unrelated customer admin, marketing, browser, file, call, SMS, payment, delete, or posting work, say this tab is repair-only and tell them to use normal Alpha AI chat.`
        : ''
      const systemWithContext = SYSTEM_PROMPT + repairOnlyContext + (isDesktop && features.desktopTools ? ('\n\n' + DESKTOP_TOOLS_PROMPT) : '') +
        (shopContext ? `\n\nLive shop context:\n${shopContext}` : '') +
        (accumulated.length ? `\n\nCompleted steps so far:\n${accumulated.join('\n')}` : '') +
          `\n\nCRITICAL INSTRUCTIONS:\n1. NEW INVOICE vs REPRINT: When user says "new invoice" or "I need a invoice for [item]", CREATE a NEW document using proposeDocument. Do NOT reprint or lookup old invoices. A "new invoice" means build a fresh one from scratch.\n2. UNDERSTAND SIMPLE REQUESTS: If the user gives you a customer name and says they need something, DO IT. Don't ask them to repeat. Example: "I need a new invoice for thermostat, $280 flat for Asheanna" = immediately create a invoice with those details, no tax, flat total.\n3. CUSTOMER SEARCH: When the user mentions a customer name, phone, or asks about a customer, ALWAYS use searchCustomers first (NOT createCustomer). Show matching results with name, phone, email, jobs. If no match, say so and ask before creating.\n4. NEVER LOOP: Give ONE clear response per turn. If you're unsure, ask ONE clarifying question. Never repeat yourself.\n5. FLAT RATE: When user says "flat" or "no tax", set tax to 0 and use the exact total they gave.\n6. customer search results: when searchcustomers returns results, always show all matching customers with their full details (name, phone, email, vehicles). the search now includes vehicle info from jobs. never show just one customer if multiple matches exist. present each customer clearly so the user can identify the right one.
7. INVOICE TYPE: When user asks for an invoice, always use proposeDocument with type Invoice. Invoice = proof of payment received. Invoice = bill for work done. Estimate = quote before work. The type field in proposeDocument MUST match exactly what the user asked for.
8. HARD TOTALS: If user gives a total/flat/final price, that amount is the final document total. Keep the work itemized, but use flat labor amounts and no tax so the total equals exactly what the user said. Do not add old context prices into a new invoice unless the user clearly asks for separate charges.` +
                    `\n\nNATURAL LANGUAGE INTELLIGENCE - YOU ARE SMART, ACT LIKE IT:
- The user is a busy mechanic. They speak casually with typos, slang, abbreviations. FIGURE IT OUT.
- "invoice 280 flat thermostat asheanna" = create invoice, thermostat, $280, Asheanna, no tax
- "brakes civic" = search brake parts for the Civic in context
- "send it" = resolve the draft/document and recipient, then ask for confirmation before any outbound send
- "how much we made" = getShopStats, revenue
- "whats rufina owe" = searchCustomers Rufina, check unpaid
- "call him" = call the customer from this conversation
- "280 flat" = $280 total, zero tax, one line item
- "yo check on johns car" = searchCustomers John, show job status
- "add labor 2 hrs" = add 2 hours at $120/hr
- "est" = estimate, "inv" = invoice, "rcpt" = invoice, "cust" = customer
- Pronouns: "his car", "her estimate", "that job" = reference from conversation
- NEVER ask for info you can infer. NEVER repeat back what user said. Just DO IT.
- If user gives a price, USE IT. Dont search. Dont question.
- "flat" or a raw total = no breakdown, no tax, one line.
- "new invoice" = NEW document, not lookup old ones.
- User should NEVER have to repeat themselves.

FEATURE TOGGLES (current state):\n- Web Search: ${activeFeatures.search ? 'ON' : 'OFF'}\n- Social Media: ${activeFeatures.socialMedia ? 'ON' : 'OFF'}\n- Deep Thinking: ${activeFeatures.thinking ? 'ON' : 'OFF'}\n- Repair Mode: ${repairOnlyMode ? 'ON' : 'OFF'}\nIf a feature is OFF and the user tries to use it, tell them to enable the toggle at the bottom of the chat input.`

      setStatus(step === 0 ? 'Thinking...' : 'Working...')

      const thinkStart = Date.now()
      // Context overflow fix: keep only the last 30 messages to stay within model context limits.
      // Always keep the first message (original user request) + last 29 for continuity.
      const trimmedMsgs = agentMessages.length > 30
        ? [agentMessages[0], ...agentMessages.slice(-29)]
        : agentMessages
      const res = await fetch('/api/ai-completions', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({
          messages: [{ role: 'system', content: systemWithContext }, ...trimmedMsgs],
          max_tokens: 1500,
          temperature: 0.2,
          frequency_penalty: 0.6,
          presence_penalty: 0.4,
            ...(activeFeatures.thinking ? { reasoning: { effort: 'high' } } : {}),
        })
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        const errMsg: ChatMessage = { role: 'assistant', content: `AI error: ${getAIErrorMessage(data, `Request failed (${res.status})`)}` }
        setMessages(prev => [...prev, errMsg])
        return
      }

      const raw = data.choices?.[0]?.message?.content?.trim() || ''

            // OUTPUT SANITIZATION - detect repeating patterns and cut them off
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

      // Parse JSON tool call ? strip code blocks, extract JSON
      let parsed: Record<string, unknown> | null = null
      try {
        const cleaned = raw.replace(/\\\json\s*/gi, '').replace(/\\\\s*/g, '').trim()
        try { parsed = JSON.parse(cleaned) } catch {
          const match = cleaned.match(/\{[\s\S]*(?:"tool"|"tools")[\s\S]*\}/)
          if (match) { try { parsed = JSON.parse(match[0]) } catch { parsed = null } }
        }
        // Normalize common AI model misspellings/variants
        if (parsed) {
          if (!parsed.tool && parsed.tools) { parsed.tool = parsed.tools; delete parsed.tools }
          if (parsed.tool === 'connect' || parsed.tool === 'connectors') parsed.tool = 'connector'
          if (!parsed.connector && parsed.connect) { parsed.connector = parsed.connect; delete parsed.connect }
          if (!parsed.action && parsed.actions) { parsed.action = parsed.actions; delete parsed.actions }
          if (!parsed.payload && parsed.paylods) { parsed.payload = parsed.paylods; delete parsed.paylods }
          if (!parsed.payload && parsed.payloads) { parsed.payload = parsed.payloads; delete parsed.payloads }
          // Normalize connector names: Google_Business ? google_business, etc.
          if (typeof parsed.connector === 'string') {
            parsed.connector = (parsed.connector as string).toLowerCase().replace(/\s+/g, '_')
          }
          if (!parsed.tool) parsed = null
        }
      } catch { parsed = null }

      // No tool call = final answer - show to user
      if (!parsed) {
        let mediaHtml = ''
            if (lastSearchMedia) {
              const imgs = (lastSearchMedia.images || []).slice(0, 4)
              const vids = (lastSearchMedia.videos || []).slice(0, 3)
              if (vids.length > 0) {
                mediaHtml += '<div style="margin-top:12px"><strong>Videos</strong></div>'
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

      const activeRoute = routeOverride || routeDecision || classifyRequest(history[history.length - 1]?.content || '')
      const loopAgent = AGENTS.find(agent => agent.id === activeRoute.agentId)?.name || activeRoute.agentId
      const loopSkill = activeRoute.skillIds[0] ? (SKILLS.find(skill => skill.id === activeRoute.skillIds[0])?.name || activeRoute.skillIds[0]) : undefined
      addToolEvent({
        agent: loopAgent,
        skill: loopSkill,
        tool: String(parsed.tool),
        status: 'running',
        detail: 'Model requested tool execution',
      })

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

      // Repair manual lookup - backstop for repair questions that reached the loop.
      // Always answers from the manuals, never the web.
      if (parsed.tool === 'repairSearch') {
        setStatus('Searching repair manual...')
        let repairText = 'No manual results'
        try {
          const rr = await fetch('/api/repair-search', {
            method: 'POST',
            headers: await getAuthJsonHeaders(),
            body: JSON.stringify({ query: parsed.query, vehicle: parsed.vehicle }),
            signal: AbortSignal.timeout(60000),
          })
          const rd = await rr.json().catch(() => ({}))
          if (rr.ok && rd?.ok && rd.data) {
            const repairData = rd.data as RepairSearchResult
            lastRepairContextRef.current = { query: String(parsed.query || ''), data: repairData }
            repairText = formatRepairSearchText(String(parsed.query || ''), repairData)
            addToolEvent({ agent: loopAgent, skill: loopSkill, tool: 'repairSearch', status: 'ok', detail: `${repairData.sources?.length || 0} source cards, ${repairData.manualMatches?.length || 0} manual matches` })
          } else {
            addToolEvent({ agent: loopAgent, skill: loopSkill, tool: 'repairSearch', status: 'error', detail: rd?.error || 'Repair lookup failed' })
          }
        } catch (e) {
          addToolEvent({ agent: loopAgent, skill: loopSkill, tool: 'repairSearch', status: 'error', detail: e instanceof Error ? e.message : 'Repair lookup failed' })
        }
        accumulated.push(`[Repair manual lookup: "${parsed.query}"]\n${repairText}`)
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: `Repair manual results for "${parsed.query}":\n${repairText}\n\nAnswer the repair question from THIS manual data only. Lead with what it means and what to check, and include the source links. Do NOT use web search. Do NOT invent torque specs, pinouts, or procedures the manual does not show.` })
        continue
      }

      // Web Search - execute silently, feed result back to AI
      if (parsed.tool === 'webSearch') {
        setStatus('Searching...')

          // Smart parts detection: if query looks like a parts search, use parts-lookup API
      const partsQuery = String(parsed.query || '')
      const isPartsSearch = /(?:brake|rotor|pad|control arm|strut|shock|bearing|hub|alternator|starter|water pump|thermostat|timing belt|ac compressor|tie rod|ball joint|axle|caliper|muffler|catalytic|spark plug|coil|fuel pump|radiator|belt|hose|filter|battery).*(?:price|cost|how much|\d{4})/i.test(partsQuery) || /\d{4}\s+\w+\s+\w+.*(?:brake|rotor|pad|control arm|strut|shock|part)/i.test(partsQuery)
      if (isPartsSearch) {
        setStatus('Looking up parts...')
        try {
          const pr = await fetch('/api/parts-lookup', {
            method: 'POST',
            headers: await getAuthJsonHeaders(),
            body: JSON.stringify({ query: parsed.query }),
            signal: AbortSignal.timeout(45000),
          })
          const pd = await pr.json()
          if (pd.ok && pd.data) {
            const d = pd.data
            const verifiedCount = Array.isArray(d.options) ? d.options.reduce((count: number, opt: { parts?: unknown[] }) => count + (Array.isArray(opt.parts) ? opt.parts.length : 0), 0) : 0
            addToolEvent({ agent: loopAgent, skill: loopSkill, tool: 'partsLookup', status: 'ok', detail: `${verifiedCount} verified price item${verifiedCount === 1 ? '' : 's'}` })
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
        } catch (e) {
          addToolEvent({ agent: loopAgent, skill: loopSkill, tool: 'partsLookup', status: 'error', detail: e instanceof Error ? e.message : 'Parts lookup failed' })
          /* fall through to regular search */
        }
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
              searchResult += '\n\nYouTube Videos:\n' + (d.videos as {title:string;url:string;channel?:string;embed_url?:string;thumbnail?:string}[]).slice(0, 3).map((v: {title:string;url:string;channel?:string;embed_url?:string;thumbnail?:string}, i: number) => `${i+1}. **${v.title}**${v.channel ? ` (${v.channel})` : ''}\n${v.embed_url || v.url}\n![thumbnail](${v.thumbnail || ''})`).join('\n')
            }
            if (d.price_radar?.length) {
              searchResult += '\n\nPRICE COMPARISON (Price Radar):\n' + (d.price_radar as {store:string;price:number;url:string;shipping?:string}[]).map((p: {store:string;price:number;url:string;shipping?:string}) => `- ${p.store}: $${p.price.toFixed(2)} ${p.shipping || ''} - ${p.url}`).join('\n')
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
              searchResult += '\n\nKNOWLEDGE PANEL - ' + d.knowledge_panel.title + ':\n' + Object.entries(d.knowledge_panel.facts).map(([k, v]) => `- ${k}: ${String(v)}`).join('\n')
              if (d.knowledge_panel.source) searchResult += '\nSource: ' + d.knowledge_panel.source
            }
            if (d.related_searches?.length) {
              searchResult += '\n\nRelated searches: ' + (d.related_searches as string[]).join(' | ')
            }
            addToolEvent({ agent: loopAgent, skill: loopSkill, tool: 'webSearch', status: 'ok', detail: `${d.results?.length || 0} result${d.results?.length === 1 ? '' : 's'}` })
            } catch (e) {
              searchResult = 'Search failed'
              addToolEvent({ agent: loopAgent, skill: loopSkill, tool: 'webSearch', status: 'error', detail: e instanceof Error ? e.message : 'Search failed' })
            }
        accumulated.push(`[Search: "${parsed.query}"]\n${searchResult}`)
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: `Search results for "${parsed.query}":\n${searchResult}\n\nContinue to the next step silently.` })
        continue
      }

      // Browse - calls /api/web-automation and shows live browser panel
      if (parsed.tool === 'browse' || parsed.tool === 'webAutomation') {
        const browseUrl = (parsed.url || '') as string
        const browseTask = (parsed.task || parsed.query || '') as string

        // Detect search-on-engine pattern: e.g. url=google.com + task="search for pikachu"
        const isSearchEngine = browseUrl && /^https?:\/\/(www\.)?(google|bing|duckduckgo|yahoo)\.(com|co\.\w+)(\/)?(\?.*)?$/i.test(browseUrl)
        const searchMatch = browseTask && browseTask.match(/search\s+(?:for\s+|on\s+google\s+for\s+)?(.+)/i)
        const extractedQuery = searchMatch ? searchMatch[1].replace(/\s+picture[s]?\s*$/i, ' pictures').trim() : ''

        // If browsing a search engine with a search task, simulate full search flow
        if (isSearchEngine && extractedQuery) {
          const engineUrl = browseUrl.replace(/\?.*/,'').replace(/\/?$/,'')
          const resultsUrl = `https://duckduckgo.com/?q=${encodeURIComponent(extractedQuery)}`
          const engineScreenshot = `/api/screenshot?url=${encodeURIComponent(engineUrl)}`
          const resultsScreenshot = `/api/screenshot?url=${encodeURIComponent(resultsUrl)}`
          setStatus(`Searching Google for "${extractedQuery}"...`)
          // Generate multi-step browser panel immediately
          const searchSteps: BrowserPanelStep[] = [
            { action: `Navigating to ${engineUrl}...`, screenshotUrl: engineScreenshot, url: engineUrl, title: 'Google' },
            { action: `Typing: "${extractedQuery}"`, screenshotUrl: engineScreenshot, url: engineUrl, title: 'Google' },
            { action: `Searching for "${extractedQuery}"...`, screenshotUrl: resultsScreenshot, url: resultsUrl, title: `${extractedQuery} - Search Results` },
          ]
          setMessages(prev => [...prev, { role: 'browser' as const, content: '', browserSteps: searchSteps }])
          // Also scrape results for AI answer
          let browseResult = ''
          try {
            const br = await fetch('/api/web-automation', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'scrape', url: resultsUrl, task: browseTask }),
              signal: AbortSignal.timeout(28000),
            })
            const bd = await br.json()
            browseResult = bd.analysis || bd.text?.slice(0, 1000) || `Searched Google for "${extractedQuery}"`
          } catch { browseResult = `Searched Google for "${extractedQuery}"` }
          accumulated.push(`[Browse: "Search Google for ${extractedQuery}"]\n${browseResult}`)
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: `Browse result for search "${extractedQuery}":\n${browseResult}\n\nPresent this to the user clearly.` })
          setStatus('')
          continue
        }

        setStatus(browseUrl ? `Browsing ${browseUrl}...` : 'Browsing...')
        let browseResult = ''
        let browseSteps: BrowserPanelStep[] = []
        try {
          const br = await fetch('/api/web-automation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: browseUrl ? 'scrape' : 'search', url: browseUrl || undefined, query: browseTask || undefined, task: browseTask || undefined }),
            signal: AbortSignal.timeout(28000),
          })
          const bd = await br.json()
          if (bd.ok) {
            browseResult = bd.analysis || bd.text?.slice(0, 1000) || JSON.stringify(bd).slice(0, 400)
            browseSteps = (bd.steps || []) as BrowserPanelStep[]
            if (browseSteps.length === 0 && browseUrl) {
              const sUrl = `/api/screenshot?url=${encodeURIComponent(browseUrl)}`
              browseSteps = [
                { action: `Navigating to ${browseUrl}...`, screenshotUrl: sUrl, url: browseUrl, title: bd.title || browseUrl },
                { action: `Reading: ${bd.title || browseUrl}`, screenshotUrl: sUrl, url: browseUrl, title: bd.title || browseUrl },
                ...(browseResult ? [{ action: `Done: ${browseResult.slice(0, 120)}`, screenshotUrl: sUrl, url: browseUrl, title: bd.title || browseUrl }] : [])
              ] as BrowserPanelStep[]
            }
          } else {
            browseResult = bd.error || 'Browse failed'
          }
        } catch (e) { browseResult = e instanceof Error ? e.message : 'Browse error' }
        if (browseSteps.length > 0) {
          setMessages(prev => [...prev, { role: 'browser' as const, content: '', browserSteps: browseSteps }])
        }
        accumulated.push(`[Browse: "${browseUrl || browseTask}"]\n${browseResult}`)
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: `Browse result for "${browseUrl || browseTask}":\n${browseResult}\n\nPresent this to the user clearly.` })
        setStatus('')
        continue
      }

      // DB Action - execute silently, feed result back to AI
      if (parsed.tool === 'action') {
        const actionName = parsed.action as string
        const confirmationActions = new Set(['sendEstimateEmail', 'deleteRecord', 'voidDocument', 'convertEstimateToInvoice'])
        if (confirmationActions.has(actionName)) {
          addToolEvent({ agent: loopAgent, skill: loopSkill, tool: `action.${actionName}`, status: 'error', detail: 'Blocked until user confirmation' })
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: `${actionName} is ready, but I need confirmation before running it. I will not send, delete, void, convert, post, call, or charge anything without you confirming first.`,
          }
          setMessages(prev => [...prev, assistantMsg])
          saveToHistory([...history, assistantMsg])
          setStatus('')
          return
        }
        setStatus('Processing...')
        let actionResult = ''
        try {
          const r = await fetch('/api/ai-action', {
            method: 'POST',
            headers: await getAuthJsonHeaders(),
            body: JSON.stringify({ action: actionName, payload: parsed.payload || {} })
          })
          const d = await r.json()
          actionResult = d.ok ? `Success: ${JSON.stringify(d.data).slice(0, 2000)}` : `Failed: ${d.error}`
          addToolEvent({ agent: loopAgent, skill: loopSkill, tool: `action.${actionName}`, status: d.ok ? 'ok' : 'error', detail: d.ok ? 'Shop action completed' : (d.error || 'Shop action failed') })
        } catch (err) {
          actionResult = `Error: ${err instanceof Error ? err.message : 'Unknown'}`
          addToolEvent({ agent: loopAgent, skill: loopSkill, tool: `action.${actionName}`, status: 'error', detail: err instanceof Error ? err.message : 'Unknown' })
        }
        accumulated.push(`[${actionName}]: ${actionResult}`)
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: `Action "${actionName}" result: ${actionResult}\n\nContinue to the next step silently.` })
        continue
      }

      // Propose Document - show visual estimate card
      if (parsed.tool === 'proposeDocument') {
        const latestUserText = [...history].reverse().find((message) => message.role === 'user')?.content || ''
        const proposalHtml = renderProposal(parsed, latestUserText)
        const assistantMsg: ChatMessage = { role: 'assistant', content: '', html: proposalHtml }
        setMessages(prev => [...prev, assistantMsg])
        saveToHistory([...history, assistantMsg])
        return
      }

      // AI Voice Call - dials with bidirectional streaming, AI handles conversation
      if (parsed.tool === 'aiVoiceCall') {
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: `I can place the AI voice call to ${parsed.to || 'that number'}, but calls require confirmation. Confirm the number and task before I dial.`,
        }
        addToolEvent({ agent: loopAgent, skill: loopSkill, tool: 'aiVoiceCall', status: 'error', detail: 'Blocked until call confirmation' })
        setMessages(prev => [...prev, assistantMsg])
        saveToHistory([...history, assistantMsg])
        setStatus('')
        return
      }

      // Place Phone Call - requires explicit user confirmation before dialing
      if (parsed.tool === 'call') {
        addToolEvent({ agent: loopAgent, skill: loopSkill, tool: 'call', status: 'error', detail: 'Blocked until call confirmation' })
        const assistantMsg: ChatMessage = { role: 'assistant', content: `I can call ${parsed.name || parsed.to}, but calls require confirmation before dialing.` }
        setMessages(prev => [...prev, assistantMsg])
        saveToHistory([...history, assistantMsg])
        setStatus('')
        return
      }

      // Navigate
      if (parsed.tool === 'navigate') {
        const v = parsed.view as string; if (v.startsWith('http')) { window.open(v, '_blank') } else { window.location.href = `/${v}` }
        return
      }

      // Message - show draft confirmation card
      if (parsed.tool === 'message') {
        setPendingSms({
          to: parsed.to as string,
          body: parsed.body as string,
          channel: (parsed.channel as string) || 'sms',
          subject: parsed.subject as string | undefined,
          customerId: parsed.customerId as string | undefined,
          customerName: parsed.customerName as string | undefined,
        })
        const channel = (parsed.channel as string) || 'sms'
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: `Draft ${channel === 'email' ? 'email' : 'text'} ready - review below and hit Send.`
        }
        setMessages(prev => [...prev, assistantMsg])
        saveToHistory([...history, assistantMsg])
        return
      }

      // Connector tools - Facebook, Instagram, Google Business, Google Calendar
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

if (parsed.tool === 'scheduleTask') { setStatus('Scheduling...'); let sr = ''; try { const r = await fetch('/api/automations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', name: parsed.name || 'Scheduled Task', description: parsed.description || '', schedule: parsed.schedule, task_prompt: parsed.task_prompt }) }); const d = await r.json(); sr = d.ok ? `Scheduled "${d.data?.name}" at ${d.data?.schedule}` : `Failed: ${d.error}` } catch (e) { sr = `Error: ${e instanceof Error ? e.message : 'Unknown'}` } accumulated.push(`[scheduleTask]: ${sr}`); agentMessages.push({ role: 'assistant', content: raw }); agentMessages.push({ role: 'user', content: `Schedule result: ${sr}\nContinue silently.` }); continue }

      // -- Automation Control -----------------------------------------------
      if (parsed.tool === 'automationControl') {
        setStatus('Checking automations...')
        let acResult = ''
        try {
          const acAction = parsed.action as string
          if (acAction === 'status') {
            const r = await fetch('/api/automations')
            const d = await r.json()
            acResult = d.ok ? `Automations: ${JSON.stringify((d.data || []).map((a: Record<string,unknown>) => ({ name: a.name, enabled: a.enabled, last_run: a.last_run }))).slice(0, 600)}` : `Failed: ${d.error}`
          } else if (acAction === 'toggle') {
            const r = await fetch('/api/automations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'toggle', id: parsed.id, enabled: parsed.enabled }),
            })
            const d = await r.json()
            acResult = d.ok ? `Automation ${parsed.enabled ? 'enabled' : 'disabled'}: ${d.data?.name || parsed.id}` : `Failed: ${d.error}`
          } else if (acAction === 'run_now') {
            const r = await fetch('/api/automations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'run_now', id: parsed.id }),
            })
            const d = await r.json()
            acResult = d.ok ? `Automation triggered: ${d.data?.name || parsed.id}` : `Failed: ${d.error}`
          } else {
            acResult = `Unknown automationControl action: ${acAction}`
          }
        } catch (err) {
          acResult = `Error: ${err instanceof Error ? err.message : 'Unknown'}`
        }
        accumulated.push(`[automationControl.${parsed.action}]: ${acResult}`)
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: `Automation result: ${acResult}\n\nContinue silently.` })
        setStatus('')
        continue
      }

      // -- DESKTOP TOOLS (Electron only) --------------------------------------
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isElectronEnv = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron

      if (parsed.tool === 'desktopOpenApp') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Desktop app launching only works in the Alpha AI Desk desktop app. Let the user know.' })
          continue
        }
        setStatus('Opening app...')
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (window as any).electronAPI.system.openApp((parsed.app || parsed.appName || 'chrome') as string, (parsed.url as string) || '')
          accumulated.push(`[Desktop open app]: ${JSON.stringify(result)}`)
          const appName = String(parsed.app || parsed.appName || 'chrome').toLowerCase().includes('comet') ? 'comet' : 'chrome'
          const msg: ChatMessage = {
            role: 'assistant',
            content: formatBrowserOpenResult(result, { app: appName, url: (parsed.url as string) || '', query: '' }),
          }
          setMessages(prev => [...prev, msg])
          saveToHistory([...history, msg])
          setStatus('')
          return
        } catch (e) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: `Desktop open app failed: ${e instanceof Error ? e.message : 'Unknown error'}` })
        }
        setStatus('')
        continue
      }

      if (parsed.tool === 'desktopDownloadImage') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Desktop image download only works in the Alpha AI Desk desktop app. Let the user know.' })
          continue
        }
        setStatus('Downloading image...')
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (window as any).electronAPI.files.downloadImage({
            url: (parsed.url as string) || '',
            query: (parsed.query as string) || (parsed.search as string) || '',
            filename: (parsed.filename as string) || (parsed.name as string) || 'downloaded-image.png',
            open: parsed.open === true,
          })
          if (result?.ok && result.path) lastDesktopFileRef.current = String(result.path)
          accumulated.push(`[Desktop image download]: ${JSON.stringify(result)}`)
          const msg: ChatMessage = {
            role: 'assistant',
            content: isVerifiedDownloadResult(result)
              ? formatDownloadResult(result, String(parsed.query || parsed.search || parsed.filename || 'image'))
              : `Image download failed verification: ${result?.error || 'file was not written and verified'}`,
          }
          setMessages(prev => [...prev, msg])
          saveToHistory([...history, msg])
          setStatus('')
          return
        } catch (e) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: `Desktop image download failed: ${e instanceof Error ? e.message : 'Unknown error'}` })
        }
        setStatus('')
        continue
      }

      if (parsed.tool === 'desktopOpenFile') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Desktop file opening only works in the Alpha AI Desk desktop app. Let the user know.' })
          continue
        }
        setStatus('Opening file...')
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (window as any).electronAPI.files.openApproved((parsed.path || parsed.filePath) as string)
          accumulated.push(`[Desktop open file]: ${JSON.stringify(result)}`)
          const verifiedOpen = result?.ok && result.verified === true && result.opened === true
          const msg: ChatMessage = {
            role: 'assistant',
            content: verifiedOpen
              ? `Opened ${result.path}.`
              : `Could not verify file open: ${result?.error || 'Alpha AI can only open files it saved, downloaded, or the user selected in this desktop session.'}`,
          }
          setMessages(prev => [...prev, msg])
          saveToHistory([...history, msg])
          setStatus('')
          return
        } catch (e) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: `Desktop open file failed: ${e instanceof Error ? e.message : 'Unknown error'}` })
        }
        setStatus('')
        continue
      }

      if (parsed.tool === 'desktopKaptureSetup') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Kapture setup only works in the Alpha AI Desk desktop app. Let the user know.' })
          continue
        }
        setStatus('Opening Kapture setup...')
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (window as any).electronAPI.kapture.openSetup()
          accumulated.push(`[Kapture setup]: ${JSON.stringify(result)}`)
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: `Kapture setup result:\n${JSON.stringify(result, null, 2)}\n\nTell the user exactly what opened and what still has to be connected. Do not claim Kapture tabs are connected unless desktopMcpStatus or a Kapture tool result proves it.` })
        } catch (e) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: `Kapture setup failed: ${e instanceof Error ? e.message : 'Unknown error'}` })
        }
        setStatus('')
        continue
      }

      if (parsed.tool === 'desktopNotify') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Desktop notifications only work in the desktop app, not the browser. Let the user know.' })
          continue
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const notifResult = await (window as any).electronAPI.notify(
          (parsed.title as string) || 'Alpha AI Desk',
          (parsed.body  as string) || ''
        )
        accumulated.push(`[Desktop Notification sent: "${parsed.title}" - "${parsed.body}"]`)
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: `Desktop notification ${notifResult.ok ? 'sent successfully' : 'failed: ' + notifResult.error}. Continue.` })
        continue
      }

      if (parsed.tool === 'desktopBrowse') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Desktop browser automation only works in the desktop app. Let the user know.' })
          continue
        }
        setStatus('Desktop browser...')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dea = (window as any).electronAPI
        let dBrowseResult = ''
        let dScreenBase64 = ''
        try {
          if (parsed.type === 'search' || (!parsed.url && parsed.query)) {
            const res = await dea.browser.search((parsed.query || parsed.task) as string)
            dBrowseResult = res.text || res.error || 'No results'
          } else if (parsed.url) {
            const res = await dea.browser.scrape(parsed.url as string, (parsed.task as string) || '')
            dBrowseResult = res.text || res.error || 'No content'
            dScreenBase64 = res.base64 || ''
          } else {
            dBrowseResult = 'No URL or query provided'
          }
        } catch (e2) { dBrowseResult = e2 instanceof Error ? e2.message : 'Error' }
        if (dScreenBase64) {
          setMessages(prev => [...prev, { role: 'browser' as const, content: '', browserSteps: [{ action: 'Desktop browser result', screenshotUrl: `data:image/png;base64,${dScreenBase64}`, url: (parsed.url as string) || '', title: '' }] }])
        }
        accumulated.push(`[Desktop Browse: "${parsed.url || parsed.query}"]\n${dBrowseResult}`)
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: `Desktop browse result:\n${dBrowseResult}\n\nPresent this to the user clearly.` })
        setStatus('')
        continue
      }

      if (parsed.tool === 'desktopPrint') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Desktop print only works in the desktop app. Let the user know.' })
          continue
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const printResult = await (window as any).electronAPI.print.page()
        const printMsg: ChatMessage = { role: 'assistant', content: printResult.ok ? 'Print dialog opened.' : `Print failed: ${printResult.error}` }
        setMessages(prev => [...prev, printMsg])
        saveToHistory([...history, printMsg])
        return
      }

      if (parsed.tool === 'desktopPDF') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Desktop PDF export only works in the desktop app. Let the user know.' })
          continue
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfResult = await (window as any).electronAPI.print.pdf((parsed.filename as string) || 'alpha-ai-desk.pdf')
        if (pdfResult?.ok && pdfResult.path) lastDesktopFileRef.current = String(pdfResult.path)
        const pdfMsg: ChatMessage = { role: 'assistant', content: pdfResult.ok ? `PDF saved to: ${pdfResult.path}` : `PDF save failed: ${pdfResult.error}` }
        setMessages(prev => [...prev, pdfMsg])
        saveToHistory([...history, pdfMsg])
        return
      }

      if (parsed.tool === 'desktopSave') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Desktop file save only works in the desktop app. Let the user know.' })
          continue
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const saveResult = await (window as any).electronAPI.files.save(
          (parsed.content as string) || '',
          (parsed.filename as string) || 'document.txt',
          undefined
        )
        if (saveResult?.ok && saveResult.path) lastDesktopFileRef.current = String(saveResult.path)
        const saveMsg: ChatMessage = { role: 'assistant', content: saveResult.ok ? `Saved to: ${saveResult.path}` : saveResult.cancelled ? 'Save cancelled.' : `Save failed: ${saveResult.error}` }
        setMessages(prev => [...prev, saveMsg])
        saveToHistory([...history, saveMsg])
        return
      }

      if (parsed.tool === 'desktopScreenshot') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Desktop screenshot only works in the desktop app. Let the user know.' })
          continue
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ssResult = await (window as any).electronAPI.system.screenshot()
        if (ssResult.ok && ssResult.base64) {
          const ssMsg: ChatMessage = { role: 'assistant', content: 'Screenshot taken:', imageUrl: `data:image/png;base64,${ssResult.base64}` }
          setMessages(prev => [...prev, ssMsg])
          saveToHistory([...history, ssMsg])
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: `Screenshot failed: ${ssResult.error}` }])
        }
        return
      }

      if (parsed.tool === 'desktopPowerShell') {
        accumulated.push('[PowerShell]: Disabled for security. The desktop app no longer exposes shell execution.')
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: 'PowerShell execution is disabled for security. Tell the user that Alpha AI Desk can provide non-identifying system info, screenshots, printing, PDF, and dialog-gated file save/open actions, but it cannot run shell commands or inspect files directly.' })
        setStatus('')
        continue
      }

      if (parsed.tool === 'desktopSystemInfo') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'System info only works in the desktop app. Let the user know.' })
          continue
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const si = await (window as any).electronAPI.system.info()
        const siText = `Platform: ${si.platform} ${si.release} | CPU: ${si.cpus} cores | RAM: ${Math.round(si.memory?.free/1024/1024/1024)}GB free / ${Math.round(si.memory?.total/1024/1024/1024)}GB total`
        accumulated.push(`[SystemInfo]: ${siText}`)
        agentMessages.push({ role: 'assistant', content: raw })
        agentMessages.push({ role: 'user', content: `System info: ${siText}` })
        continue
      }

      if (parsed.tool === 'desktopMcpStatus') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Desktop MCP only works in the Alpha AI Desk desktop app. Let the user know.' })
          continue
        }
        setStatus('Discovering MCP tools...')
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const desktopApi = (window as any).electronAPI
          const mcpResult = await desktopApi.mcp.tools()
          const serverIds = Array.isArray(mcpResult?.servers)
            ? mcpResult.servers.filter((item: { ok?: boolean; id?: string }) => item.ok && item.id).map((item: { id: string }) => item.id)
            : []
          const extras = await Promise.all(serverIds.map(async (id: string) => {
            const [resources, prompts] = await Promise.all([
              desktopApi.mcp.resources(id).catch((e: Error) => ({ ok: false, error: e.message, resources: [] })),
              desktopApi.mcp.prompts(id).catch((e: Error) => ({ ok: false, error: e.message, prompts: [] })),
            ])
            return { id, resources, prompts }
          }))
          const mcpText = JSON.stringify({ tools: mcpResult, extras }, null, 2).slice(0, 14000)
          accumulated.push(`[Desktop MCP status]: ${mcpText}`)
          addToolEvent({ agent: loopAgent, skill: loopSkill, tool: 'desktopMcpStatus', status: 'ok', detail: `${serverIds.length} MCP server${serverIds.length === 1 ? '' : 's'} available` })
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({
            role: 'user',
            content: `Desktop MCP discovery result:\n${mcpText}\n\nUse exact server ids and tool names from this result. Resources and prompts are MCP skills/context where available. If the user asked what is available, summarize it clearly. If you need to act, choose the next MCP tool call.`,
          })
        } catch (e) {
          const errText = e instanceof Error ? e.message : 'Unknown MCP error'
          addToolEvent({ agent: loopAgent, skill: loopSkill, tool: 'desktopMcpStatus', status: 'error', detail: errText })
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: `Desktop MCP discovery failed: ${errText}` })
        }
        setStatus('')
        continue
      }

      if (parsed.tool === 'desktopMcpTool') {
        if (!isElectronEnv) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Desktop MCP tools only work in the Alpha AI Desk desktop app. Let the user know.' })
          continue
        }
        const server = (parsed.server as string) || ''
        const name = (parsed.name || parsed.toolName) as string
        const args = (parsed.arguments || parsed.args || {}) as Record<string, unknown>
        if (!server || !name) {
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: 'Desktop MCP call is missing server or name. Discover tools and try again.' })
          continue
        }
        setStatus(`MCP: ${server}.${name}...`)
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mcpCallResult = await (window as any).electronAPI.mcp.callTool(server, name, args, parsed.approved === true)
          const mcpCallText = JSON.stringify(mcpCallResult, null, 2).slice(0, 14000)
          accumulated.push(`[Desktop MCP ${server}.${name}]: ${mcpCallText}`)
          addToolEvent({ agent: loopAgent, skill: loopSkill, tool: `${server}.${name}`, status: mcpCallResult?.ok ? 'ok' : 'error', detail: mcpCallResult?.ok ? 'MCP tool returned ok:true' : (mcpCallResult?.error || 'MCP tool returned ok:false') })
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({
            role: 'user',
            content: `Desktop MCP tool result for ${server}.${name}:\n${mcpCallText}\n\nContinue with the next step if needed, or summarize the result for the user.`,
          })
        } catch (e) {
          const errText = e instanceof Error ? e.message : 'Unknown MCP tool error'
          addToolEvent({ agent: loopAgent, skill: loopSkill, tool: `${server}.${name}`, status: 'error', detail: errText })
          agentMessages.push({ role: 'assistant', content: raw })
          agentMessages.push({ role: 'user', content: `Desktop MCP tool failed for ${server}.${name}: ${errText}` })
        }
        setStatus('')
        continue
      }
      // -- END DESKTOP TOOLS --------------------------------------------------

// Unknown - treat as final response
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
        <span>AI Call Summary</span>
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
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({
          to: pendingSms.to,
          body: pendingSms.body,
          channel: pendingSms.channel || 'sms',
          subject: pendingSms.subject || undefined,
          customerId: pendingSms.customerId || undefined,
          customerName: pendingSms.customerName || undefined,
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

  // Feature 4: Save document from proposal card (uses create-estimate which handles all types)
  const saveProposal = async (parsed: Record<string, unknown>) => {
    const normalized = normalizeDocumentDraft(parsed)
    try {
      const res = await fetch('/api/create-estimate', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({
          customer: normalized.customer,
          customer_email: normalized.customer_email,
          customer_phone: normalized.customer_phone,
          vehicle: normalized.vehicle,
          parts: normalized.parts,
          labors: normalized.labors,
          notes: normalized.notes,
          type: normalized.type || 'Estimate',
          apply_tax: normalized.apply_tax,
          tax_rate: normalized.tax_rate,
        })
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      const docType = (normalized.type as string) || 'Estimate'
      const docNum = data.doc_number || ''
      const email = normalized.customer_email as string || ''
      const phone = normalized.customer_phone as string || ''
      showToast(`${docType} ${docNum} saved!`)
      // Offer to send via email/SMS
      if (email || phone) {
        const sendOptions: string[] = []
        if (email) sendOptions.push('email')
        if (phone) sendOptions.push('SMS')
        const sendHtml = `<div class="proposal-card" style="margin-top:8px">
          <div class="font-bold text-sm mb-2">${docType} ${docNum} saved! Send to ${normalized.customer || 'customer'}?</div>
          <div class="flex gap-2">
            ${email ? `<button onclick="window.__sendSavedDoc && window.__sendSavedDoc('${data.estimate?.id || ''}','email','${email.replace(/'/g, "\\'")}')" class="btn btn-primary btn-sm">Email to ${email}</button>` : ''}
            ${phone ? `<button onclick="window.__sendSavedDoc && window.__sendSavedDoc('${data.estimate?.id || ''}','sms','${phone.replace(/'/g, "\\'")}')" class="btn btn-secondary btn-sm">SMS to ${phone}</button>` : ''}
            <button onclick="this.closest('.proposal-card').style.display='none'" class="btn btn-sm" style="opacity:0.6">Skip</button>
          </div>
        </div>`
        setMessages(prev => [...prev, { role: 'assistant', content: '', html: sendHtml }])
      }
    } catch { showToast('Failed to save document') }
  }

  const escapeHtml = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  const safeUrl = (value: string): string => {
    try {
      const url = new URL(value, window.location.origin)
      if (!['http:', 'https:'].includes(url.protocol)) return '#'
      return escapeHtml(url.href)
    } catch {
      return '#'
    }
  }

  const encodeProposalPayload = (value: unknown): string => {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    let binary = ''
    bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  const decodeProposalPayload = (encodedData: string): Record<string, unknown> => {
    const base64 = encodedData.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  }

  // Render a small safe markdown subset for chat messages.
  const renderMarkdown = (text: string): string => {
    const escaped = escapeHtml(text)
    return escaped
      // YouTube embeds: [YouTube](embed_url) or bare embed URLs
      .replace(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([\w-]{11})/g, (_m, id) => `<div style="margin:8px 0;border-radius:12px;overflow:hidden;max-width:480px"><iframe width="100%" height="270" src="https://www.youtube.com/embed/${id}" frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen style="border-radius:12px"></iframe></div>`)
            // Images: ![alt](url)
      .replace(/!\[([^\]]*)]\(([^)]+)\)/g, (_m, alt, url) => `<img src="${safeUrl(url)}" alt="${escapeHtml(alt)}" class="rounded-lg max-w-full sm:max-w-[300px] max-h-[300px] object-cover my-1 inline-block" />`)
      // Links: [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer" class="text-blue underline hover:text-blue/80">${escapeHtml(label)}</a>`)
      // Bold: **text**
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // Newlines
      .replace(/\n/g, '<br />')
  }

  const renderProposal = (parsed: Record<string, unknown>, userText = ''): string => {
    const normalized = normalizeDocumentDraft(parsed, { userText })
    const parts = (normalized.parts as Record<string,unknown>[]) || []
    const labors = (normalized.labors as Record<string,unknown>[]) || []
    const partsTotal = parts.reduce((s,p) => s + partLineTotal(p), 0)
    const laborTotal = labors.reduce((s,l) => s + laborLineTotal(l), 0)
    const taxRate = normalized.tax_rate !== undefined ? Number(normalized.tax_rate) : 8.25
    const applyTax = normalized.apply_tax !== undefined ? normalized.apply_tax !== false : true
    const tax = applyTax ? partsTotal * (taxRate / 100) : 0
    const total = partsTotal + laborTotal + tax
    const fmt = (n: number) => '$' + n.toFixed(2)
    const docType = (normalized.type as string) || 'Estimate'
    const encodedData = encodeProposalPayload(normalized)
    return `<div class="proposal-card" id="proposal-${encodedData.slice(0, 8)}">
      <div class="font-bold text-base mb-2">Proposed ${escapeHtml(docType)} - ${escapeHtml(String(normalized.customer || ''))}</div>
      ${parts.length ? `<table class="w-full text-xs mb-3"><thead><tr class="text-text-muted"><th class="text-left pb-1">Part</th><th class="text-right pb-1">Qty</th><th class="text-right pb-1">Price</th><th class="text-right pb-1">Total</th></tr></thead><tbody>${parts.map(p=>`<tr><td>${escapeHtml(String(p.name || p.description || 'Part'))}</td><td class="text-right">${escapeHtml(String(p.qty||1))}</td><td class="text-right">${fmt(Number(p.unitPrice)||0)}</td><td class="text-right">${fmt(partLineTotal(p))}</td></tr>`).join('')}</tbody></table>` : ''}
      ${labors.length ? `<table class="w-full text-xs mb-3"><thead><tr class="text-text-muted"><th class="text-left pb-1">Labor</th><th class="text-right pb-1">Hrs</th><th class="text-right pb-1">Total</th></tr></thead><tbody>${labors.map(l=>`<tr><td>${escapeHtml(String(l.operation || l.description || 'Labor'))}</td><td class="text-right">${getLaborFlatAmount(l) !== null ? 'Flat' : escapeHtml(String(l.hours || 0))}</td><td class="text-right">${fmt(laborLineTotal(l))}</td></tr>`).join('')}</tbody></table>` : ''}
      <div class="border-t border-border pt-2 space-y-1 text-xs">
        <div class="flex justify-between"><span>Parts</span><span>${fmt(partsTotal)}</span></div>
        <div class="flex justify-between"><span>Labor</span><span>${fmt(laborTotal)}</span></div>
        <div class="flex justify-between"><span>Tax${applyTax ? ` (${taxRate}%)` : ''}</span><span>${fmt(tax)}</span></div>
        <div class="flex justify-between font-bold text-base mt-1 pt-1 border-t border-border"><span>Total</span><span class="text-green">${fmt(total)}</span></div>
      </div>
      <div class="flex gap-2 mt-3">
        <button onclick="window.__saveProposal && window.__saveProposal('${encodedData}')" class="btn btn-success btn-sm">Save ${docType}</button>
        <button onclick="window.__editProposal && window.__editProposal('${encodedData}')" class="btn btn-secondary btn-sm">Edit</button>
        <button onclick="window.__deleteProposal && window.__deleteProposal(this)" class="btn btn-sm" style="background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.3)">Delete</button>
      </div>
    </div>`
  }

  // Global handlers for proposal card buttons
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    // Save: persist document to DB
    w.__saveProposal = (encodedData: string) => {
      try {
        const parsed = normalizeDocumentDraft(decodeProposalPayload(encodedData))
        saveProposal(parsed)
      } catch { showToast('Failed to parse document data') }
    }
    // Legacy alias
    w.__saveEstimate = w.__saveProposal
    // Edit: prompt user to tell AI what to change
    w.__editProposal = (encodedData: string) => {
      try {
        const parsed = normalizeDocumentDraft(decodeProposalPayload(encodedData))
        const docType = parsed.type || 'Estimate'
        const editPrompt = prompt(`What would you like to change on this ${docType}?`)
        if (editPrompt) {
          sendRef.current?.(`Edit the ${docType} for ${parsed.customer || 'the customer'}: ${editPrompt}`)
        }
      } catch { showToast('Failed to parse document data') }
    }
    // Delete: dismiss the proposal card
    w.__deleteProposal = (btn: HTMLElement) => {
      const card = btn.closest('.proposal-card')
      if (card) {
        (card as HTMLElement).style.display = 'none'
        showToast('Proposal dismissed')
      }
    }
    // Send saved document via email or SMS
    w.__sendSavedDoc = async (docId: string, channel: string, to: string) => {
      try {
        const res = await fetch('/api/send-document', {
          method: 'POST', headers: await getAuthJsonHeaders(),
          body: JSON.stringify({ documentId: docId, channel, [channel === 'sms' ? 'phone' : 'email']: to })
        })
        if (!res.ok) throw new Error('Send failed')
        showToast(`${channel === 'email' ? 'Email' : 'SMS'} sent to ${to}`)
      } catch { showToast(`Failed to send ${channel}`) }
    }
    return () => {
      delete w.__saveProposal
      delete w.__saveEstimate
      delete w.__editProposal
      delete w.__deleteProposal
      delete w.__sendSavedDoc
    }
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

  const suggested = repairOnlyMode ? [
    "2005 Honda Civic P0420",
    "2018 Jeep Wrangler brake diagram",
    "2004 Honda Accord all four brakes procedure",
    "2016 Cadillac Escalade front lower control arm specs",
    "P0300 diagnostic checks for a 2012 Chevy Silverado",
    "Find wiring diagram for turn signal bulbs on a 2018 Wrangler",
  ] : [
    "What jobs are open right now?",
    "Build me an estimate for front brakes on a 2019 Toyota Camry",
    "Who hasn't been in for 90+ days?",
    "How much revenue this month?",
    "Create a new customer: John Smith, 555-123-4567",
    "Open a new job for the white 2020 Honda Civic - AC not blowing cold",
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
  const activeAgent = routeDecision ? AGENTS.find(agent => agent.id === routeDecision.agentId) : null
  const activeSkills = routeDecision ? routeDecision.skillIds.map(id => SKILLS.find(skill => skill.id === id)?.name || id) : []

  return (
    <div className="flex flex-col h-screen max-h-screen">
      <div className="p-3 sm:p-6 border-b border-border flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold">Alpha AI</h1>
          <p className="text-xs sm:text-sm text-text-muted mt-0.5 truncate">Full shop control - create, update, search, and message from here</p>
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
            Voice
          </button>
          {/* Talk to Alpha voice conversation mode toggle */}
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
            title={voiceActive ? 'Voice mode ON - tap to stop' : 'Start voice conversation'}
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
          <div className="relative ml-auto w-80 max-w-[85vw] bg-bg-card border-l border-border h-full overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">Chat History</h2>
                                <button onClick={() => { if (confirm('Delete ALL chat history?')) { setHistory([]); localStorage.removeItem('ai_history'); showToast('All history deleted') }}} className="btn btn-sm text-xs text-red-400 hover:bg-red-400/10 border border-red-400/30">Delete All</button>
              <button onClick={() => setShowHistory(false)} className="btn btn-secondary btn-sm">Close</button>
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
              <span className="mx-2 text-text-muted">-</span>
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

      {repairOnlyMode && (
        <div className="border-b border-green/20 bg-green/10 px-3 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green/25 bg-bg-card/75 p-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-green">Repair Only Mode</div>
              <p className="mt-1 text-sm text-text-secondary">
                This chat will stay on diagnostics, repair sources, safety checks, work notes, and estimate-ready repair details.
              </p>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setRepairOnlyMode(false)
                localStorage.removeItem('ai_repair_mode')
              }}
            >
              Exit Repair Mode
            </button>
          </div>
        </div>
      )}

      <div className="border-b border-border bg-bg-base/70 px-3 py-3 sm:px-6">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]">
          <div className="rounded-lg border border-border bg-bg-card/80 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{repairOnlyMode ? 'Repair Command Center' : 'Command Center'}</span>
              <span className={`rounded-md border px-2 py-1 text-[11px] font-bold ${isDesktop && features.desktopTools ? 'border-green/30 bg-green/10 text-green' : 'border-amber/30 bg-amber/10 text-amber'}`}>
                {isDesktop && features.desktopTools ? 'Desktop tools live' : 'Desktop tools unavailable'}
              </span>
              {routeDecision?.requiresConfirmation && (
                <span className="rounded-md border border-amber/30 bg-amber/10 px-2 py-1 text-[11px] font-bold text-amber">confirmation required</span>
              )}
              {routeDecision?.requiresToolResult && (
                <span className="rounded-md border border-blue/30 bg-blue/10 px-2 py-1 text-[11px] font-bold text-blue">tool result required</span>
              )}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div>
                <div className="text-[11px] font-bold uppercase text-text-muted">Current Agent</div>
                <div className="mt-1 truncate text-sm font-bold">{activeAgent?.name || 'Router Agent'}</div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase text-text-muted">Active Skill</div>
                <div className="mt-1 truncate text-sm font-bold">{activeSkills[0] || 'General routing'}</div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase text-text-muted">Intent</div>
                <div className="mt-1 truncate text-sm font-bold">{routeDecision ? `${routeDecision.intent} (${Math.round(routeDecision.confidence * 100)}%)` : 'Waiting'}</div>
              </div>
            </div>
            {routeDecision?.reasons?.length ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {routeDecision.reasons.map(reason => (
                  <span key={reason} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-text-secondary">{reason}</span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-bg-card/80 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">Tool Activity</div>
              <a href="/tools" className="text-xs font-bold text-blue hover:underline">Registry</a>
            </div>
            <div className="mt-2 max-h-28 space-y-2 overflow-y-auto pr-1">
              {toolTimeline.length === 0 ? (
                <div className="text-xs text-text-muted">No tool calls yet.</div>
              ) : toolTimeline.slice(0, 5).map((event, index) => (
                <div key={`${event.time}-${event.tool}-${index}`} className="flex gap-2 text-xs">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${event.status === 'ok' ? 'bg-green' : event.status === 'error' ? 'bg-red' : 'bg-amber animate-pulse'}`} />
                  <div className="min-w-0">
                    <div className="truncate font-bold">{event.tool} <span className="font-normal text-text-muted">{event.time}</span></div>
                    <div className="truncate text-text-secondary">{event.agent}{event.skill ? ` - ${event.skill}` : ''}: {event.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

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
            <div className={m.role === 'browser' ? 'text-sm w-full p-0 bg-transparent' : m.role === 'user' ? 'max-w-[90%] sm:max-w-[80%] rounded-xl px-4 py-3 text-sm bg-blue text-white' : m.repairResult ? 'w-full max-w-5xl rounded-xl px-3 py-3 text-sm bg-bg-card border border-border' : 'max-w-[90%] sm:max-w-[80%] rounded-xl px-4 py-3 text-sm bg-bg-card border border-border'}>
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
              {m.repairResult
                ? <div className="space-y-3">
                    {m.content && <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />}
                    <RepairResultCard result={m.repairResult} onAskNext={(text) => {
                      // Send the follow-up inline. The router auto-routes it to the
                      // manuals and carries the vehicle from context — no need to flip
                      // the whole chat into repair-only mode or leave text in the box.
                      setTimeout(() => sendRef.current?.(text), 0)
                    }} />
                  </div>
                : m.role === 'browser' && m.browserSteps
                  ? <BrowserPanel steps={m.browserSteps} />
                  : m.html
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
                      Jump Into Call
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
                      <button onClick={() => setShowJumpIn(false)} className="btn btn-secondary btn-sm text-xs">Cancel</button>
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
              <span>{attachedFile.type === 'image' ? 'IMG' : 'FILE'}</span>
              <span className="truncate max-w-[180px]">{attachedFile.name}</span>
              <button
                onClick={() => setAttachedFile(null)}
                className="ml-1 text-blue/60 hover:text-red-400 transition-colors"
                title="Remove file"
              >Remove</button>
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
            placeholder={repairOnlyMode ? 'Ask about this repair, diagnostic checks, source verification, or estimate notes...' : 'Ask anything - or tell me to create, update, message, search...'}
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
            title={features.search ? 'Web search ON - click to disable' : 'Web search OFF - click to enable'}
          >
            {features.search && <span className="w-1.5 h-1.5 rounded-full bg-blue flex-shrink-0" />}
            Search
          </button>

          {/* Social toggle */}
          <button
            onClick={() => toggleFeature('socialMedia')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border ${
              features.socialMedia
                ? 'bg-blue/20 border-blue/50 text-blue'
                : 'bg-bg-card border-border text-text-muted hover:border-blue/30 hover:text-text-secondary'
            }`}
            title={features.socialMedia ? 'Social media ON - click to disable' : 'Social media OFF - click to enable'}
          >
            {features.socialMedia && <span className="w-1.5 h-1.5 rounded-full bg-blue flex-shrink-0" />}
            Social
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
              Thinking
            </button>

          {/* Repair mode toggle */}
          <button
            onClick={toggleRepairMode}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border ${
              repairOnlyMode
                ? 'bg-green/20 border-green/50 text-green'
                : 'bg-bg-card border-border text-text-muted hover:border-green/30 hover:text-text-secondary'
            }`}
            title={repairOnlyMode ? 'Repair mode ON - source-backed repair answers only' : 'Repair mode OFF - click for repair-only chat'}
          >
            {repairOnlyMode && <span className="w-1.5 h-1.5 rounded-full bg-green flex-shrink-0" />}
            Repair
          </button>

          {/* Desktop Tools toggle - only in Electron */}
          {isDesktop && (
            <button
              onClick={() => toggleFeature('desktopTools')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                features.desktopTools
                  ? 'bg-orange-500/20 border-orange-500/50 text-orange-400'
                  : 'bg-bg-card border-border text-text-muted hover:border-orange-400/30 hover:text-text-secondary'
              }`}
              title={features.desktopTools ? 'Desktop tools ON — click to disable' : 'Desktop tools OFF — click to enable'}
            >
              {features.desktopTools && <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />}
              🖥️ Desktop
            </button>
          )}

          {/* Connectors button */}
          <button
            onClick={() => { setShowConnectorsPopup(true); loadConnectors() }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border bg-bg-card border-border text-text-muted hover:border-blue/30 hover:text-text-secondary"
            title="Open Connectors"
          >
            Connectors
          </button>

          {/* Files button */}
          <button
            onClick={() => attachInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border bg-bg-card border-border text-text-muted hover:border-blue/30 hover:text-text-secondary"
            title="Attach a file"
          >
            Files
          </button>
        </div>

        {listening && !voiceActive && <p className="text-xs mt-2 text-red-400 animate-pulse">Listening... speak now</p>}
        {voiceActive && voiceStatus === 'listening' && <p className="text-xs mt-2 text-red-400 animate-pulse">Voice mode active - speak now</p>}
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
              <div className="mx-5 mt-4 px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">{connectorToast}</div>
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
                            {isConnected ? 'Connected' : 'Not connected'}
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
                              {isLoading ? 'Disconnecting...' : 'Disconnect'}
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
                <span className="font-medium text-text-secondary">Tip:</span> Facebook and Instagram share one OAuth flow. Google Business and Calendar share one Google login.
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

