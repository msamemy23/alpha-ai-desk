import { NextRequest, NextResponse } from 'next/server'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''

export async function POST(req: NextRequest) {
  try {
    const { recording_id } = await req.json()
    if (!recording_id) return NextResponse.json({ error: 'Missing recording_id' }, { status: 400 })

    // Step 1: Get a fresh recording URL from Telnyx
    const recRes = await fetch(`https://api.telnyx.com/v2/recordings/${recording_id}`, {
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
    })
    if (!recRes.ok) throw new Error('Failed to fetch recording details')
    const recData = await recRes.json()
    const recording = recData.data
    const audioUrl = recording.download_urls?.mp3 || recording.download_urls?.wav
    if (!audioUrl) throw new Error('No audio URL available')

    // Step 2: Download the audio
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) throw new Error('Failed to download audio')
    const audioBuffer = await audioRes.arrayBuffer()
    const isWav = !recording.download_urls?.mp3
    const mimeType = isWav ? 'audio/wav' : 'audio/mpeg'

    // Step 3: Transcribe using Telnyx speech-to-text API
    const formData = new FormData()
    const audioBlob = new Blob([audioBuffer], { type: mimeType })
    formData.append('file', audioBlob, isWav ? 'recording.wav' : 'recording.mp3')
    formData.append('model', 'distil-whisper/distil-large-v2')

    const transcribeRes = await fetch('https://api.telnyx.com/v2/ai/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
      body: formData,
    })

    let transcript = ''
    if (transcribeRes.ok) {
      const transcribeData = await transcribeRes.json()
      transcript = transcribeData.text || ''
    }

    // If Telnyx transcription failed, try a simple fallback
    if (!transcript) {
      transcript = '[Audio recording - transcription unavailable]'
    }

    // Step 4: Summarize the transcript using GPT-4o via OpenRouter
    const from = recording.from || 'Unknown'
    const to = recording.to || 'Unknown'
    const duration = Math.round((recording.duration_millis || 0) / 1000)

    const summaryRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://alpha-ai-desk.vercel.app',
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v3.2',
        messages: [
          {
            role: 'system',
            content: `You are summarizing a phone call to Alpha International Auto Center (an auto repair shop in Houston, TX). The call was handled by an AI receptionist. Summarize in 2-4 bullet points: what the caller wanted, what was discussed, and any action items or outcomes. Be concise and professional. If the transcript is unavailable or too short, say "Brief call - no meaningful conversation detected."`,
          },
          {
            role: 'user',
            content: `Call from ${from} to ${to}, duration: ${duration} seconds.\n\nTranscript:\n${transcript}`,
          },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    })

    const summaryData = await summaryRes.json()
    const summary = summaryData?.choices?.[0]?.message?.content?.trim() || 'Unable to generate summary.'

    return NextResponse.json({ summary, transcript })
  } catch (e: unknown) {
    console.error('[recording-summary] error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
