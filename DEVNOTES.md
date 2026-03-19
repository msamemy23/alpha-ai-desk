# Alpha AI Desk — Dev Notes

## Rules (always follow these)
1. **Explain before acting** — describe the plan before writing any code
2. **Track all conversations** — keep context across sessions
3. **Test everything** — actually verify in the live browser before saying it works
4. **Talk before fixing if broken** — diagnose with the user before changing code
5. **Research and plan first** — don't be reactive, understand root cause first

---

## PhoneWidget — Browser WebRTC Softphone

### What it does
Lets the user make outbound phone calls directly from the browser using Telnyx WebRTC.
Triggered by typing "call XXXXXXXXXX" in the AI chat page (`/ai`).

### Architecture
```
ai/page.tsx
  → detects "call XXXXXXXXXX" regex
  → dispatches window CustomEvent('phone:call', { detail: { number, name } })

layout.tsx
  → <PhoneWidget /> always mounted in <main>

PhoneWidget.tsx (outer shell)
  → listens for 'phone:call' event
  → immediately shows popup with "Connecting..." state
  → fetches JWT token from /api/webrtc-token
  → mounts <TelnyxRTCProvider> with token
  → renders <PhoneWidgetInner> + <RemoteAudio>

PhoneWidgetInner
  → useCallbacks({ onReady }) → calls client.newCall()
  → useNotification() → watches call state (calling → active → ended)
  → Mute / End Call buttons

RemoteAudio
  → hidden <audio> element that receives the remote audio stream
```

### Key package
- `@telnyx/react-client@^1.0.2` — latest available (NOT ^2.0.0, that version doesn't exist)
- `@telnyx/webrtc@^2.10.0` — peer dependency

### Phone number format
Always normalize to E.164 before passing to Telnyx:
- 10 digits → `+1XXXXXXXXXX`
- 11 digits starting with 1 → `+1XXXXXXXXXX`
- Already has + → leave as-is
See `toE164()` function in PhoneWidget.tsx.

---

## Telnyx Account Config

### Outbound Voice Profile
**This is required for calls to actually ring.** Without it, Telnyx accepts the WebRTC connection but has no routing to send the call to the phone network.

- Profile name: **Default**
- Profile ID: `2668698936952227186`
- Whitelisted destinations: US, CA

Every credential connection created for WebRTC **must** have:
```json
"outbound": {
  "outbound_voice_profile_id": "2668698936952227186"
}
```

This is set in `/api/webrtc-token/route.ts` in `createCredentialConnection()`.
The route also patches existing connections via `ensureOutboundProfile()`.

### Phone Numbers on account
- `+17136636979` — Main Alpha Auto Center number (used as callerNumber/caller ID)
- `+12819368645` — Additional number on messaging profile

### Caller ID used for outbound calls
```
callerNumber: '+17136636979'
callerName: 'Alpha Auto Center'
```

---

## WebRTC Token API (`/api/webrtc-token`)

Flow:
1. Check Supabase `settings` table for saved `webrtc_credential_id`
2. If found → try generating token from existing credential
3. If that fails → check for saved `webrtc_conn_id`, create new credential on it
4. If that fails → full setup: create new connection + credential + token

Settings keys used in Supabase:
- `webrtc_conn_id` — Telnyx credential connection ID
- `webrtc_credential_id` — Telnyx telephony credential ID

---

## Bug History

### Bug 1: Page crashed 3-5 seconds into a call
**Root cause**: Old widget used CDN-loaded `window.TelnyxWebRTC` SDK. Raw event listeners outside React lifecycle caused unhandled exceptions that bubbled up and unmounted the entire React tree.

**Fix**: Rewrote with `@telnyx/react-client` (v4). All events handled inside React hooks with try/catch everywhere. Provider mounts per-call and unmounts cleanly.

### Bug 2: npm install failed on Vercel
**Root cause**: `package.json` had `@telnyx/react-client: "^2.0.0"` but the latest version is `1.0.2`.

**Fix**: Changed to `^1.0.2`.

### Bug 3: Popup didn't appear / appeared briefly then vanished
**Root cause**: Widget returned `null` until BOTH `visible` AND `token` were set. If token fetch was slow or failed, user saw nothing.

**Fix**: Split into two render states — show "Connecting..." shell immediately when `visible` is set, only mount TelnyxRTCProvider once token arrives. Error state shown if token fetch fails.

### Bug 4: Call "connected" but phone didn't ring, call ended in ~2 seconds
**Root cause**: Every `credential_connection` created by the webrtc-token API had `outbound_voice_profile_id: null`. Telnyx accepted the WebRTC SIP registration but had no routing profile to forward the call to the PSTN.

**Diagnosis**: Created temporary `/api/debug-telnyx` route that called Telnyx API to list all credential connections and outbound voice profiles. Confirmed all 34 connections had `outbound_voice_profile_id: null`.

**Fix**: Updated `createCredentialConnection()` to include `outbound.outbound_voice_profile_id: "2668698936952227186"`. Added `ensureOutboundProfile()` to PATCH existing connections when they're used.

---

## Git Workflow on This Machine
Direct `git` commands in PowerShell MCP time out. Use background jobs:
```powershell
$job = Start-Job {
  $env:GIT_AUTHOR_NAME = "msamemy23"
  $env:GIT_AUTHOR_EMAIL = "msamemy23@users.noreply.github.com"
  $env:GIT_COMMITTER_NAME = "msamemy23"
  $env:GIT_COMMITTER_EMAIL = "msamemy23@users.noreply.github.com"
  Set-Location "C:\Users\aaron\Desktop\stuff\alpha-ai-desk-repo"
  git add <files> 2>&1
  git commit -m "message" 2>&1
  git push origin main 2>&1
}
Start-Sleep -Seconds 30
Receive-Job $job; Stop-Job $job; Remove-Job $job
```

No `~/.gitconfig` exists on this machine — must set env vars inside the job block.

---

## Environment Variables (stored in Vercel)
- `TELNYX_API_KEY` — Telnyx API key for creating credentials and tokens
- `TELNYX_PHONE` — Main phone number (+17136636979)
- `TELNYX_CONN_ID` — Legacy connection ID (may be stale)
- `TELNYX_MESSAGING_PROFILE_ID` — For SMS
- `TELNYX_PHONE_NUMBER` — Duplicate of TELNYX_PHONE
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key
