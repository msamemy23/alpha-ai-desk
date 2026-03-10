# Alpha AI Desk — Setup Guide
## 3 steps to go live

---

## Step 1: Run Database Schema (2 min)

1. Go to: https://supabase.com/dashboard/project/fztnsqrhjesqcnsszqdb/editor
2. Click "New query"
3. Open supabase/schema.sql from this zip → copy all → paste → click Run
4. Should say: "Success. No rows returned" ✅

Then get your service_role key:
- Supabase dashboard → Settings → API → copy the service_role secret key
- Paste it into VERCEL_ENV_VARS.txt where indicated

---

## Step 2: Deploy to Vercel (5 min)

1. Create a GitHub account at github.com (if you don't have one)
2. Create a new repo named: alpha-ai-desk-web
3. Upload everything inside the web/ folder to that repo
   (do NOT upload .env.local — .gitignore already blocks it)
4. Go to vercel.com → Sign up with GitHub → New Project → import your repo
5. Open VERCEL_ENV_VARS.txt → paste each variable into Vercel's env section
6. Click Deploy

Your dashboard goes live at: https://alpha-ai-desk-web.vercel.app ✅

After deploying — delete VERCEL_ENV_VARS.txt from your computer.

---

## Step 3: Free AI (2 min)

1. Go to openrouter.ai → sign up → API Keys → create key (free)
2. In your web app → Settings → AI → paste the key → Save ✅

---

## Add SMS Later (after buying Telnyx number)

1. telnyx.com → Numbers → Buy Numbers → search 713 area code
2. Messaging → Messaging Profiles → create one
3. Auth → API Keys → copy your key
4. In Vercel → your project → Settings → Environment Variables:
   - Update TELNYX_PHONE_NUMBER with your new number
5. On your Telnyx number: set webhook URL to:
   https://alpha-ai-desk-web.vercel.app/api/sms
6. Vercel → Deployments → Redeploy

---

## Security Notes

- .env.local is blocked from GitHub by .gitignore
- VERCEL_ENV_VARS.txt — delete after you set up Vercel
- Credentials live only in: your .env.local (local dev) and Vercel dashboard (production)
- Source code contains zero credentials

