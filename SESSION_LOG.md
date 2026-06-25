# AgentX / Alpha AI Desk — Session Log

---

## Session: April 13, 2026

### What we talked about
- Aaron reported: "Agent error: ENOTDIR, not a directory"
- Full product audit requested: fix ENOTDIR, context overflow, checkpoint/restore,
  feature parity with OpenClaw, codebase cleanup, 30+ test scenarios, packaging

---

### What was found (code audit)

**Project structure:**
- `C:\Users\aaron\alpha-ai-desk\web` — Next.js web app (deployed to Vercel)
- `C:\Users\aaron\alpha-desk-desktop` — Electron wrapper (wraps Vercel URL)
- `C:\Users\aaron\alpha-ai-desk-mobile` — React Native Android app
- APP_URL = https://alpha-ai-desk.vercel.app

**Bug 1 — ENOTDIR root cause (CRITICAL):**
In `alpha-desk-desktop/main.js`, the `file-list` IPC handler calls
`fs.readdirSync(dir)` with no validation that `dir` is actually a directory.
If the agent passes a file path (e.g. a settings file, any non-directory path),
Node throws: `ENOTDIR: not a directory, scandir '<path>'`.
The Electron preload exposes this as `electronAPI.files.list(dir)`.
The AI then sees this error in its tool result and reports "Agent error: ENOTDIR".

**Bug 2 — Context overflow:**
In `web/src/app/(app)/ai/page.tsx`, the `agentLoop` builds `agentMessages`
from the full conversation history with NO trimming. Each tool step adds 2 more
messages. After a long conversation this array blows up the model context window.
No hard limit on messages sent to the API.

**Bug 3 — Double-plus bug in systemWithContext:**
Line ~1030 in page.tsx:
  `(accumulated.length ? ... : '') + + \`\n\nCRITICAL...\``
The `+ +` is a JavaScript double-plus — the unary `+` converts the template
string to `NaN`, so the system prompt contains the literal text "NaN" inserted
between the accumulated steps and the critical instructions. This corrupts
every multi-step AI response.

**Bug 4 — Backtick-n bug in desktop tools separator:**
Line ~1032: `'`n`n'` instead of `'\n\n'` — desktop tools prompt is not properly
separated from the main system prompt in Electron mode.

**Bug 5 — No outer try/catch in agentLoop:**
The entire `agentLoop` function has no outer try/catch. Any unhandled exception
(network error, JSON parse error, IPC error) causes an uncaught promise rejection.
The `send` function also has no try/catch around `agentLoop`. This means:
  - Loading spinner never clears on error
  - User sees a blank/frozen UI instead of an error message

**Bug 6 — automationControl tool missing handler:**
The system prompt defines the `automationControl` tool for toggling automations,
but the `agentLoop` has NO handler for `parsed.tool === 'automationControl'`.
It falls through to the "Unknown — treat as final response" branch,
which just displays the raw JSON object as if it were the AI's text response.

**Bug 7 — Two Next.js config files:**
Both `next.config.js` and `next.config.mjs` exist in the web directory.
Next.js prioritizes `.mjs`, which is nearly empty (just a deploy-trigger comment).
This means the proper config (ignoreBuildErrors, ignoreDuringBuilds) is silently ignored.

---

### What was changed this session

1. Created this SESSION_LOG.md
2. Fixed ENOTDIR in main.js — added fs.statSync() check before readdirSync
3. Fixed double-plus bug in page.tsx systemWithContext
4. Fixed backtick-n bug in desktop tools prompt separator
5. Added outer try/catch to agentLoop with proper error display
6. Added context trimming — agentMessages trimmed to last 30 before each API call
7. Added automationControl handler in agentLoop
8. Fixed next.config.mjs to match next.config.js properly
9. Added checkpoint creation script

---

### What still needs work

- [ ] 30+ test scenarios (in progress)
- [ ] OpenClaw feature comparison
- [ ] Full codebase cleanup (duplicate files, dead code in root dir)
- [ ] Packaging for Windows (NSIS installer) and Mac (DMG)
- [ ] Final live Electron desktop launch test
- [ ] Add chat history persistence to Supabase (currently localStorage only)
- [ ] Voice mode improvements
- [ ] Rate limiting on AI API calls

---

### What worked

- Electron app starts correctly via `npm start` in alpha-desk-desktop
- Preload IPC bridge is solid — all handlers present
- Web app deploys fine to Vercel
- Supabase DB connection working
- Web search (Tavily) working
- Parts lookup working
- File attachment (image + PDF) working

### What failed

- file-list IPC called with non-directory path → ENOTDIR (FIXED)
- Context overflow on long conversations (FIXED — trimming added)
- systemWithContext double-plus = "NaN" in prompt (FIXED)
- automationControl tool calls produce raw JSON in chat (FIXED — handler added)

---

*Log maintained per Rule 1: Log first, act second.*

---
## 2026-05-12 - Fix: sign page & sign emails showed $0.00

**Symptom:** When sending an estimate/invoice/receipt for customer signature, the email and the public /sign/[token] page both showed Total: .00 with no line items, instead of the actual parts/labor breakdown.

**Root cause:** Shape mismatch.
- The shop editor (DocumentsPage.tsx) stores docs as parts[] (with unitPrice, qty) and labors[] (with hours, ate). Totals are computed on the fly by calcTotals() in lib/supabase.ts � NO persisted 	otal column.
- The customer-facing sign flow (api/sign/route.ts + sign/[token]/page.tsx) read doc.line_items[] and doc.total � both absent ? $0.00 and zero rows.

**Fix:** Added 
ormalizeDocForSigning() helper in api/sign/route.ts that builds line_items[] from parts + labors and computes 	otal using the same formula as calcTotals(). Applied at all three injection points: GET /api/sign (sign page load), POST action='send' (sign-request email), POST action='complete' (confirmation email).

Also added a line-item table + subtotal/tax breakdown to the sign-request email so the customer sees the full estimate in their inbox before clicking through.

**Files changed:** web/src/app/api/sign/route.ts only.
**TypeScript check:** 0 errors in sign/route.ts (pre-existing errors in other files untouched).
**Risk:** Low � no schema change, no editor change, no /api/send-document change. Mirrors existing calcTotals() math exactly.

**Test plan:**
1. Open any estimate with real parts/labor on alpha-ai-desk.vercel.app
2. Click "Send for Signature" to a known email (e.g. msamemy23@gmail.com)
3. Verify email body shows correct line items, subtotal, tax, and total � NOT $0.00
4. Click "Review and Sign" ? verify the public page shows the same line items + total
5. Sign ? verify confirmation email shows the correct total

---
## 2026-06-13 - Security hardening pass (audit-driven)

Driven by a deep read-only audit of web + desktop + data layer. Fixed the
highest-severity, lowest-blast-radius items first. NO deploy was done; the
auth change needs a preview-login test before promoting to prod.

### Desktop (alpha-desk-desktop) - closes website-to-laptop RCE
- main.js / preload.js rewritten. REMOVED: system-powershell, raw file
  read/write/list (these let the remote page run shell + touch any path on disk).
- Kept dialog-gated save/open (user picks the path) so document export still works.
- Navigation pinned to the app origin + Google/Supabase (exact hostname match,
  not includes()); non-allowed URLs open in the real browser.
- OAuth popups no longer get the preload bridge. DevTools dev-only.
  system-info no longer leaks username/hostname/homedir. Added single-instance
  lock, did-fail-load retry screen, scoped permission handler.
- Added .gitignore (node_modules, dist, *.exe, logs).

### Secrets removed from source (ROTATE THESE - they are compromised)
- Tavily key: ai-search/route.ts, parts-lookup/route.ts -> env only.
- Supabase service-role key + Facebook app secret: auth/facebook/callback -> env only.
- Google client secret (was array-joined to dodge scanners): lib/connectors.ts -> env only.

### Auth - real sessions instead of the forgeable alpha_authed cookie
- Added @supabase/ssr. lib/supabase.ts now uses createBrowserClient (session in
  cookies, server-readable). middleware.ts validates the real Supabase session.
- login/page.tsx + auth/callback/page.tsx no longer set alpha_authed.
- New lib/api-auth.ts (getAuthedShop) + lib/admin-guard.ts (requireAdmin).
- Guarded routes (require session + scope to caller's shop): send-document,
  save-document, delete-call. Gated setup routes behind ADMIN_SECRET: migrate,
  seed-settings, seed-connectors.

### Schema
- supabase/schema.sql: flipped `disable row level security` -> `enable` so
  re-running it can never silently reopen the DB (policies live in migrations 002/003).

**Verification:** `tsc --noEmit` shows 0 errors in all changed files; `next build`
with env vars present completes clean (Middleware bundles, all pages collect).

**New env vars to set in Vercel:** ADMIN_SECRET (random string),
GOOGLE_CLIENT_SECRET, FACEBOOK_APP_SECRET, TAVILY_API_KEY, SUPABASE_SERVICE_ROLE_KEY
(if any were only living as the now-removed hardcoded fallbacks).

**MUST TEST before prod:** deploy to a Vercel preview, then log in with email AND
Google. The middleware now requires a real session cookie, so existing users get
ONE forced re-login after deploy. Confirm /dashboard loads and the AI chat works.

### Continuation (same day) - more fixes, all build-verified
- ai-action/route.ts: now requires getAuthedShop() (was unauthenticated full-DB
  access for anyone) and uses the authenticated shopId instead of
  `.limit(1).single()`; deleteRecord scoped by shop_id. NOTE: web agent sends the
  session cookie so it keeps working; confirm the MOBILE agent path doesn't call
  /api/ai-action without a session (it uses /api/ai-chat, so should be fine).
- send-document/route.ts: removed the divergent local calcTotal (taxed the wrong
  base) and now uses the canonical calcTotals().total — SMS total now matches the
  invoice/email/sign total.
- Telnyx webhook signature verification added (lib/telnyx-verify.ts) on the
  inbound SMS webhook (sms/route.ts). Env-gated: skips until TELNYX_PUBLIC_KEY is
  set (so it won't break live inbound), then rejects forged/replayed requests.

### Still open (next pass)
- Apply getAuthedShop to the remaining /api routes (with webhook/cron exemptions).
- Apply the Telnyx signature check to telnyx-voice-webhook and calls/webhook too.
- Move the AI agent loop server-side (OpenRouter key still reaches the browser).
- Per-shop connectors (drop connectors.service UNIQUE -> unique(shop_id,service);
  connectors.ts still reads/writes one global row).
- Encrypt OAuth tokens at rest.

**Set in Vercel when ready:** TELNYX_PUBLIC_KEY (from Telnyx portal) to turn on
webhook signature enforcement.

---
## 2026-06-13 - Phone SMS (off Telnyx) + document-editor features

### SMS now sends/receives through the shop's OWN phone (voice stays on Telnyx)
- OUTBOUND was already provider-agnostic in lib/sms.ts (SMS_PROVIDER = telnyx |
  textbee | httpsms | custom). No code change needed there.
- Built the missing INBOUND half: lib/sms-inbound.ts holds the shared handler
  (dedupe, customer lookup, store, rate-limit, AI auto-reply). /api/sms (Telnyx)
  now calls it; NEW /api/sms-inbound is the phone-gateway webhook — normalizes
  TextBee/httpSMS/custom payloads, optional SMS_INBOUND_SECRET gate.
- Added STOP/UNSUBSCRIBE/etc opt-out handling in the shared inbound handler:
  never auto-replies to an opt-out, best-effort sets customers.sms_opted_out.
- .env.local.example documents SMS_PROVIDER + TextBee/httpSMS/custom + SMS_INBOUND_SECRET.

To turn on phone SMS: install a gateway app (TextBee or httpSMS) on the Android
phone, set SMS_PROVIDER + that gateway's keys in Vercel, and point the gateway's
"received SMS" webhook at /api/sms-inbound?secret=... (matching SMS_INBOUND_SECRET).

### Document editor (from the shop-owner list)
- PER-PART warranty: each part row now has a Warranty box ("12mo / 12k mi") that
  prints next to that part on the invoice. (Stored in the parts jsonb — no migration.)
- PER-PART status: each part row has a Status dropdown (Ordered/Backordered/
  Received/Installed/Returned). Internal only — does NOT print. (jsonb, no migration.)
- INTERNAL "Shop Notes": a private notes box on the editor that never prints/emails/
  signs, separate from the customer-facing Notes. Needs migration 004.

### Migration to run: web/supabase/migrations/004_internal_notes_and_optout.sql
Adds documents.internal_notes and customers.sms_opted_out. Until it runs:
internal-notes only saves when typed (other saves unaffected), and STOP just skips
the auto-reply without persisting the flag.

**Verification:** next build passes clean (all routes compile, middleware bundles).
Phone SMS send/receive needs a real device + gateway app to test end to end.

---
## 2026-06-13 - Repair Workspace fixes

The Repair tab (page + repair-search/manual/estimate/procedures routes + lib/repair)
is a source-backed research workspace (LEMON/CHARM/NHTSA vPIC/Tavily). Fixed the
gaps that made it "not right yet":

- DB: added web/supabase/migrations/005_repair_workspace.sql creating
  repair_procedure_cards + repair_research_sessions (with RLS + indexes). Until run,
  procedure cards silently didn't save and research logging no-op'd. RUN THIS MIGRATION.
- Tavily: TAVILY_API_KEY added to web/.env.local (NOT source). Set it in Vercel too,
  or the web-search half of repair sources returns nothing. (Key was pasted in chat —
  consider rotating.)
- Source reliability: lib/repair/sources.ts extractManualLinks no longer HARD-drops
  every directory link that doesn't contain the model string — it prefers model
  matches but falls back to all links, so a naming mismatch never yields empty results.
  Also wrapped new URL() in try/catch.
- De-dup: page.tsx no longer keeps its own copy of the P0420/P0300/P0171 guides or a
  duplicate detectDtcCode — both now come from lib/repair/presentation (REPAIR_DTC_GUIDES,
  detectRepairDtc). Relabeled the ambiguous top "Build Estimate Draft" button to
  "Send to AI Chat" (it hands off to /ai; the Estimate tab is the real create path).

Note: the estimate is intentionally a locked-total split across labor lines (no invented
part prices); calcTotals already reads laborLineTotal's flat amount, so totals are correct.

**Verification:** next build passes clean. Procedure-card save + research logging need
migration 005 run; web-search sources need TAVILY_API_KEY in Vercel.

### 2026-06-13 update — migrations 004 + 005 RUN on production
Ran the combined 004+005 SQL in the Supabase SQL editor (project alpha desk / main
PRODUCTION) by driving the user's logged-in Comet browser via windows-mcp:
opened /sql/new, pasted the SQL from the clipboard, Ctrl+Enter → "Success. No rows
returned". So documents.internal_notes, customers.sms_opted_out, repair_procedure_cards,
repair_research_sessions, their indexes, RLS, and policies now exist in prod.
Still pending: TAVILY_API_KEY in Vercel (local .env.local already has it).
(Update: TAVILY_API_KEY already existed in Vercel for all environments — confirmed via the dashboard, nothing to add.)

---
## 2026-06-13 - AI chat now uses the Repair manuals (not the web) for car problems

Owner ask: when chatting with Alpha AI, any car code/symptom/diagram/spec question
should answer from the Repair sources (LEMON/CHARM manuals), NOT generic web search.
Only go online if explicitly asked. Ask for the vehicle if unknown. Diagrams as a card.

Root cause: lib/ai/router.ts only routed to repair when a repair word AND a vehicle/code
were in the SAME message. Bare codes, symptoms, and follow-ups ("show me the diagram")
fell through to the general LLM loop, which uses webSearch (Tavily).

Changes (all build-verified; routing covered by web/test/router-repair.test.ts, 17/17):
- lib/ai/router.ts: broadened the repair trigger — routes to repair on any DTC code,
  symptom (misfir*/stall/overheat/shake/grind/leak/no-start/…), or repair-reference word
  (diagram/wiring/torque/spec/fuse/relay/firing order/procedure/recall/tsb…), WITHOUT
  needing the vehicle in the same message. Added a PRICING guard so price/quote/buy
  questions still go to the parts path.
- ai/page.tsx runRepairLookup: (1) ALWAYS asks for the vehicle when it's not in the
  message or the conversation context (never guesses, never falls back to web);
  (2) default is manual-only (repair card); (3) when the user explicitly says to go
  online (ONLINE_INTENT regex), it keeps the manual as the primary source, pulls
  /api/ai-search, and synthesizes one combined best answer via /api/ai-completions.
- SYSTEM_PROMPT rule 0: repair/diagnostic/diagram/spec/code = manual sources only,
  never webSearch unless the user explicitly asks to go online (backstop for the LLM loop).
- Diagrams continue to surface as the existing repair card ("Open diagram").

Note: this needs a deploy to reach production (changes are local).

