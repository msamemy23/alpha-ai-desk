# Alpha AI Desk — Local Install Guide

## Requirements
- Node.js 18+ → download at https://nodejs.org (choose LTS version)

---

## Run Locally (Windows)

1. Double-click **START_WINDOWS.bat**
2. Wait for it to install (first time only takes ~1 min)
3. Open your browser to: http://localhost:3000 ✅

---

## Run Locally (Mac / Linux)

1. Open Terminal in this folder
2. Run: `./start_mac_linux.sh`
3. Open your browser to: http://localhost:3000 ✅

---

## Your Keys (already pre-loaded in web/.env.local)

| Variable | Purpose |
|---|---|
| TELNYX_API_KEY | SMS/calling via Telnyx |
| TELNYX_PHONE_NUMBER | Your shop number (+17136636979) |
| TELNYX_MESSAGING_PROFILE_ID | Telnyx messaging profile |
| SUPABASE_URL + KEYS | Database (Supabase) |
| RESEND_API_KEY | Email sending |
| FROM_EMAIL | service@alphainternationalauto.com |
| OPENROUTER_API_KEY | AI features |

All keys are pre-filled in `web/.env.local`. Do NOT share this file.

---

## Database Setup (one-time, if starting fresh)

1. Go to: https://supabase.com/dashboard/project/fztnsqrhjesqcnsszqdb/editor
2. Click "New query"
3. Open `supabase/schema.sql` → copy all → paste → Run
4. Should say: "Success. No rows returned" ✅

---

## Security Notes

- Never upload `web/.env.local` to GitHub (it's blocked by .gitignore)
- Your live production site is already running at: https://alpha-ai-desk.vercel.app

