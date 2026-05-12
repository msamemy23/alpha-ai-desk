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

