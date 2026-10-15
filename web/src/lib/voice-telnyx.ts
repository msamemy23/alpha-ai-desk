/**
 * Sends the call commands that the receptionist's call handler asked for to Telnyx, with the shop's own API key.
 * Speech uses a natural voice first and a basic one if that fails. Nothing here decides anything.
 */
import type { Command } from '@/lib/voice/call-pipeline'

const BASE = 'https://api.telnyx.com/v2'
const VOICE = 'Telnyx.Natural.abbie'
const VOICE_FALLBACK = 'female'

async function post(path: string, body: Record<string, unknown>, apiKey: string): Promise<boolean> {
  if (!apiKey) return false
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error('[telnyx] command failed:', path.replace(/\/calls\/[^/]+/, '/calls/…'), res.status)
    return res.ok
  } catch (e) {
    console.error('[telnyx] command error:', e instanceof Error ? e.message : e)
    return false
  }
}

export interface RunResult { speakFailed: boolean }

export async function runCommands(commands: Command[], callId: string, apiKey: string): Promise<RunResult> {
  let speakFailed = false
  let batch: Promise<boolean>[] = []
  const flush = async () => { if (batch.length) { await Promise.all(batch); batch = [] } }
  for (const c of commands) {
    const id = ('callId' in c && c.callId) || callId
    const base = `/calls/${encodeURIComponent(id)}/actions`
    switch (c.type) {
      case 'answer': await flush(); await post(`${base}/answer`, {}, apiKey); break
      case 'transcription_start':
        batch.push(post(`${base}/transcription_start`, { language: 'en', transcription_engine: 'B', transcription_tracks: 'both', interim_results: false }, apiKey))
        break
      case 'record_start':
        batch.push(post(`${base}/record_start`, {
          format: 'mp3', channels: 'dual',
          ...(c.beep ? { play_beep: true } : {}),
          ...(c.maxLength ? { max_length: c.maxLength } : {}),
          ...(c.timeoutSecs ? { timeout_secs: c.timeoutSecs } : {}),
        }, apiKey))
        break
      case 'speak': {
        await flush()
        const ok = (await post(`${base}/speak`, { payload: c.text, payload_type: 'text', voice: VOICE }, apiKey))
          || (await post(`${base}/speak`, { payload: c.text, payload_type: 'text', voice: VOICE_FALLBACK }, apiKey))
        if (!ok) speakFailed = true
        break
      }
      case 'transfer':
        await flush()
        await post(`${base}/transfer`, {
          to: c.to, timeout_secs: c.timeoutSecs, command_id: c.commandId,
          client_state: Buffer.from(c.clientState).toString('base64'),
        }, apiKey)
        break
      case 'playback_stop': await flush(); await post(`${base}/playback_stop`, { stop: 'all' }, apiKey); break
      case 'hangup': await flush(); await post(`${base}/hangup`, {}, apiKey); break
    }
  }
  await flush()
  return { speakFailed }
}
