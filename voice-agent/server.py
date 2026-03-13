"""
Alpha AI Voice Agent — Using Telnyx Call Control API
Flow:
  1. Dial → call.answered webhook
  2. Start transcription (Telnyx STT via call control)
  3. Receive call.transcription webhooks with speech text
  4. Feed to DeepSeek V3.2 → get AI response
  5. Use call.control speak command to play TTS back
  6. call.hangup → generate summary, make available via /api/call-summary
"""

import asyncio
import base64
import json
import logging
import os
import time
import aiohttp
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse
import uvicorn

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

TELNYX_API_KEY     = os.environ.get("TELNYX_API_KEY", "")
TELNYX_PHONE       = os.environ.get("TELNYX_PHONE", "+17136636979")
TELNYX_CONN_ID     = os.environ.get("TELNYX_CONN_ID", "2912878759822493204")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
AI_MODEL           = os.environ.get("AI_MODEL", "deepseek/deepseek-chat-v3-0324")
PUBLIC_URL         = os.environ.get("PUBLIC_URL", "")

TELNYX_BASE = "https://api.telnyx.com/v2"

# In-memory call state: call_control_id → state dict
active_calls: dict = {}

app = FastAPI(title="Alpha Voice Agent")


# ─── HEALTH ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"ok": True, "active_calls": len(active_calls), "public_url": PUBLIC_URL}


# ─── INITIATE AI VOICE CALL ────────────────────────────────────────────────────
@app.post("/api/ai-voice-call")
async def initiate_voice_call(request: Request):
    body = await request.json()
    to_number = body.get("to", "")
    task      = body.get("task", "Have a helpful conversation")
    caller_id = body.get("callerName", "Alpha International Auto Center")

    if not to_number:
        return JSONResponse({"ok": False, "error": "Missing to"}, status_code=400)

    digits = ''.join(c for c in to_number if c.isdigit())
    if len(digits) == 10:
        e164 = f"+1{digits}"
    elif digits.startswith("1") and len(digits) == 11:
        e164 = f"+{digits}"
    else:
        e164 = f"+{digits}"

    webhook_url = f"{PUBLIC_URL}/webhook/telnyx"
    log.info(f"Placing AI call to {e164}, task={task}, webhook={webhook_url}")

    payload = {
        "connection_id": TELNYX_CONN_ID,
        "to": e164,
        "from": TELNYX_PHONE,
        "from_display_name": "Alpha International Auto Center",
        "answering_machine_detection": "disabled",
        "webhook_url": webhook_url,
        "client_state": base64.b64encode(json.dumps({
            "task": task,
            "callerName": caller_id
        }).encode()).decode(),
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{TELNYX_BASE}/calls",
            json=payload,
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            }
        ) as resp:
            data = await resp.json()
            if not resp.ok:
                err = data.get("errors", [{}])[0].get("detail", json.dumps(data))
                log.error(f"Telnyx call failed: {err}")
                return JSONResponse({"ok": False, "error": err}, status_code=500)

            call_id = data["data"]["call_control_id"]
            active_calls[call_id] = {
                "call_id":     call_id,
                "to":          e164,
                "task":        task,
                "caller_name": caller_id,
                "conversation": [],
                "transcript":  [],
                "started_at":  time.time(),
                "status":      "dialing",
                "greeted":     False,
                "processing":  False,  # lock to prevent overlapping AI calls
            }
            log.info(f"Call initiated: {call_id[:30]}")
            return JSONResponse({"ok": True, "callId": call_id, "to": e164})


# ─── CALL SUMMARY ──────────────────────────────────────────────────────────────
@app.get("/api/call-summary/{call_id}")
async def get_call_summary(call_id: str):
    state = active_calls.get(call_id)
    if not state:
        # Search by prefix (Telnyx sometimes shortens IDs in webhooks)
        for cid, s in active_calls.items():
            if cid.startswith(call_id[:20]):
                state = s
                break
    if not state:
        return JSONResponse({"ok": False, "error": "Call not found"}, status_code=404)
    return JSONResponse({
        "ok":         True,
        "status":     state.get("status", "unknown"),
        "transcript": state.get("transcript", []),
        "summary":    state.get("summary", ""),
        "duration":   int(time.time() - state.get("started_at", time.time())),
    })


# ─── TELNYX WEBHOOK ────────────────────────────────────────────────────────────
@app.post("/webhook/telnyx")
async def telnyx_webhook(request: Request):
    body = await request.json()
    event_type = body.get("data", {}).get("event_type", "")
    payload    = body.get("data", {}).get("payload", {})
    call_id    = payload.get("call_control_id", "")

    log.info(f"Webhook: {event_type} | call={call_id[:30] if call_id else 'n/a'}")

    # ── Call Answered ─────────────────────────────────────────────────────────
    if event_type == "call.answered":
        state = _find_call(call_id)
        if state:
            state["status"] = "active"
            # Decode task from client_state
            cs = payload.get("client_state", "")
            if cs:
                try:
                    decoded = json.loads(base64.b64decode(cs).decode())
                    state["task"] = decoded.get("task", state["task"])
                except Exception:
                    pass
            # Start transcription
            asyncio.create_task(_start_transcription(call_id))
            # Send greeting after 1 second
            asyncio.create_task(_send_greeting(call_id, state))

    # ── Transcription Received ────────────────────────────────────────────────
    elif event_type == "call.transcription":
        state = _find_call(call_id)
        if state:
            td      = payload.get("transcription_data", {})
            text    = td.get("transcript", "").strip()
            is_final = td.get("is_final", False)

            if text and is_final and not state.get("processing"):
                log.info(f"Human said: '{text}'")
                state["transcript"].append({"speaker": "customer", "text": text})
                asyncio.create_task(_process_speech(call_id, state, text))

    # ── Call Hangup ───────────────────────────────────────────────────────────
    elif event_type == "call.hangup":
        state = _find_call(call_id)
        if state:
            state["status"] = "ended"
            log.info(f"Call ended: {call_id[:30]}, {len(state.get('transcript', []))} exchanges")
            if state.get("transcript"):
                asyncio.create_task(_generate_summary(state))

    # ── Speak Ended (AI finished talking) ─────────────────────────────────────
    elif event_type == "call.speak.ended":
        state = _find_call(call_id)
        if state:
            state["processing"] = False
            log.info(f"AI finished speaking, ready for next input")

    return PlainTextResponse("OK")


# ─── HELPERS ───────────────────────────────────────────────────────────────────

def _find_call(call_id: str) -> dict | None:
    """Find call state by ID or prefix."""
    if call_id in active_calls:
        return active_calls[call_id]
    for cid, s in active_calls.items():
        if cid.startswith(call_id[:20]) or call_id.startswith(cid[:20]):
            return s
    return None


async def _start_transcription(call_id: str):
    """Enable real-time transcription on the call via Call Control API."""
    await asyncio.sleep(0.3)
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{TELNYX_BASE}/calls/{call_id}/actions/transcription_start",
            json={
                "language": "en",
                "transcription_engine": "B",   # Telnyx native (Whisper-based), cheaper
                "transcription_tracks": "inbound",  # transcribe caller audio
            },
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            }
        ) as resp:
            if resp.ok:
                log.info(f"Transcription started for {call_id[:30]}")
            else:
                body = await resp.text()
                log.warning(f"Transcription start failed: {resp.status} {body[:200]}")


async def _send_greeting(call_id: str, state: dict):
    """Generate and speak AI greeting."""
    await asyncio.sleep(1.2)
    if state.get("greeted"):
        return
    state["greeted"]    = True
    state["processing"] = True

    task = state.get("task", "")
    prompt = f"""You just called someone on behalf of Alpha International Auto Center (auto repair shop, Houston TX).
Your task: {task}

Generate a SHORT, natural opening greeting (1-2 sentences max).
Sound like a real helpful person. Be warm and professional.
Examples:
- "Hi there! This is calling from Alpha International Auto Center in Houston. How are you today?"
- "Hello, thanks for answering. This is Alpha Auto Center — I was hoping you could help me out."

Just the greeting text only, nothing else."""

    greeting = await _get_ai_text(prompt, max_tokens=80)
    if not greeting:
        greeting = "Hi there, this is calling from Alpha International Auto Center. How are you today?"

    log.info(f"Greeting: {greeting}")
    state["transcript"].append({"speaker": "ai", "text": greeting})
    state["conversation"].append({"role": "assistant", "content": greeting})
    await _speak(call_id, greeting)


async def _process_speech(call_id: str, state: dict, user_text: str):
    """Feed user speech to DeepSeek, get response, speak it back."""
    state["processing"] = True
    try:
        ai_text = await _get_ai_response(user_text, state)
        if ai_text:
            log.info(f"AI response: {ai_text}")
            state["transcript"].append({"speaker": "ai", "text": ai_text})
            state["conversation"].append({"role": "assistant", "content": ai_text})
            await _speak(call_id, ai_text)
        else:
            state["processing"] = False
    except Exception as e:
        log.error(f"Process speech error: {e}", exc_info=True)
        state["processing"] = False


async def _speak(call_id: str, text: str):
    """Use Telnyx Call Control speak to play TTS on the call."""
    # Clean text for TTS
    clean = text.replace('"', "'").strip()
    if not clean:
        return

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{TELNYX_BASE}/calls/{call_id}/actions/speak",
            json={
                "payload":       clean,
                "voice":         "female",
                "language":      "en-US",
                "payload_type":  "text",
                "service_level": "premium",
            },
            headers={
                "Authorization": f"Bearer {TELNYX_API_KEY}",
                "Content-Type": "application/json",
            }
        ) as resp:
            if resp.ok:
                log.info(f"Speak command sent: '{clean[:60]}...'")
            else:
                body = await resp.text()
                log.warning(f"Speak failed: {resp.status} {body[:200]}")


async def _get_ai_response(user_text: str, state: dict) -> str:
    """Generate AI response using DeepSeek V3.2 via OpenRouter."""
    task    = state.get("task", "Have a helpful conversation")
    history = state.get("conversation", [])

    system = f"""You are a phone AI agent calling on behalf of Alpha International Auto Center (auto repair shop, Houston TX, 10710 S Main St, phone 713-663-6979).

YOUR TASK: {task}

RULES:
- You are on a LIVE PHONE CALL. Speak naturally and conversationally.
- Keep responses SHORT — 1-3 sentences max unless more info is required.
- Sound like a real, professional human assistant. Warm and helpful.
- If you hear a phone menu ("Press 1 for..., Press 2 for..."), tell the caller which option you'd choose.
- If the task involves ordering parts, get the details right: part name, year/make/model, quantity, confirm price.
- If asked to hold, say "Of course, I'll hold."
- When the task is complete, say "Thank you so much, have a great day!" 
- Never reveal you are an AI unless directly and explicitly asked.
"""

    messages = [{"role": "system", "content": system}]
    for msg in history[-8:]:
        messages.append(msg)
    messages.append({"role": "user", "content": user_text})

    return await _get_ai_text(None, messages=messages, max_tokens=150)


async def _get_ai_text(prompt: str | None, messages: list = None, max_tokens: int = 200) -> str:
    """Call OpenRouter / DeepSeek and return response text."""
    if messages is None:
        messages = [{"role": "user", "content": prompt}]
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://openrouter.ai/api/v1/chat/completions",
                json={"model": AI_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7},
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "Content-Type": "application/json"},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()
                return data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    except Exception as e:
        log.error(f"AI error: {e}")
        return ""


async def _generate_summary(state: dict):
    """Generate a summary of the call after hangup."""
    lines = "\n".join(
        f"{'AI' if t['speaker']=='ai' else 'Person'}: {t['text']}"
        for t in state.get("transcript", [])
    )
    task = state.get("task", "")
    prompt = f"""Summarize this phone call in bullet points.

Task: {task}

Transcript:
{lines}

Write:
• Who was called / what for
• What was discussed
• What was accomplished or agreed
• Any next steps or important details

Keep it brief and professional."""

    summary = await _get_ai_text(prompt, max_tokens=400)
    state["summary"] = summary or f"Call completed with {len(state.get('transcript',[]))} exchanges."
    log.info(f"Summary generated for call {state.get('call_id','?')[:20]}")


# ─── MAIN ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    log.info(f"Alpha Voice Agent starting on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
