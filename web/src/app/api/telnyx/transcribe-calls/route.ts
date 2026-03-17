import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'
export const maxDuration = 300
const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-r1'
const TELNYX_BASE = 'https://api.telnyx.com/v2'

async function getFreshWavUrl(rid: string, callSessionId?: string): Promise<string|null> {
  try {
    // Use recordings list API with call_session_id (individual endpoint returns 404)
    if (callSessionId) {
      const params = new URLSearchParams({'filter[call_session_id]': callSessionId, 'page[size]': '5'})
      const r = await fetch(`${TELNYX_BASE}/recordings?${params}`,{headers:{'Authorization':`Bearer ${TELNYX_API_KEY}`}})
      if (r.ok) {
        const d = await r.json()
        const rec = (d.data||[]).find((x:any) => x.id === rid) || d.data?.[0]
        const url = rec?.download_urls?.wav||rec?.download_urls?.mp3||null
        if (url) return url
      }
    }
    // Fallback: try individual endpoint
    const r2 = await fetch(`${TELNYX_BASE}/recordings/${rid}`,{headers:{'Authorization':`Bearer ${TELNYX_API_KEY}`}})
    if (r2.ok) {
      const d2 = await r2.json()
      return d2.data?.download_urls?.wav||d2.data?.download_urls?.mp3||null
    }
    return null
  } catch{return null}
}
async function transcribeViaOpenRouter(url: string): Promise<{text:string|null,error?:string}> {
  try {
    if (!OPENROUTER_API_KEY) return {text:null,error:'NO_OPENROUTER_KEY'}
        // Download audio from Telnyx S3 (try public first, then with auth)
    let ar = await fetch(url)
    if (!ar.ok) ar = await fetch(url, {headers: {'Authorization': `Bearer ${TELNYX_API_KEY}`}})
    if (!ar.ok) return {text:null, error:`AUDIO_FETCH_${ar.status}`}
    const buf = await ar.arrayBuffer()
    if (buf.byteLength < 500) return {text:null, error:'AUDIO_TOO_SMALL'}
    const b64 = Buffer.from(buf).toString('base64')
    // Use GPT-4o audio preview via OpenRouter for transcription
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://alpha-ai-desk.vercel.app', 'X-Title': 'Alpha AI Desk'},
      body: JSON.stringify({model: 'openai/gpt-4o-audio-preview', messages: [{role: 'user', content: [{type: 'input_audio', input_audio: {data: b64, format: 'wav'}}, {type: 'text', text: 'Transcribe this phone call audio word for word. Return ONLY the spoken text.'}]}], max_tokens: 2000})
    })
    if (!r.ok) {const err = await r.text(); return {text:null, error:`OPENROUTER_${r.status}: ${err.substring(0,150)}`}}
    const d = await r.json()
    const t = (d.choices?.[0]?.message?.content || '').trim()
    return {text: t.length > 5 ? t : null, error: t ? undefined : `EMPTY: ${JSON.stringify(d).substring(0,100)}`}
      } catch(x:any){return {text:null,error:x.message}}
}
async function scoreLeadFromTranscript(t: string): Promise<{lead_score:string;lead_reasoning:string;service_needed:string;caller_sentiment:string;key_quotes:string}> {
  const e = {lead_score:'unknown',lead_reasoning:'',service_needed:'',caller_sentiment:'',key_quotes:''}
  if (!OPENROUTER_API_KEY||!t||t.length<20) return {...e,lead_reasoning:'Transcript too short'}
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{'Authorization':`Bearer ${OPENROUTER_API_KEY}`,'Content-Type':'application/json','HTTP-Referer':'https://alpha-ai-desk.vercel.app','X-Title':'Alpha AI Desk'},body:JSON.stringify({model:AI_MODEL,messages:[{role:'system',content:'You are an AI for Alpha International Auto Center (Houston TX). Analyze call transcripts. Return JSON: lead_score(hot/warm/cold), lead_reasoning, service_needed, caller_sentiment(positive/neutral/frustrated/spam), key_quotes.'},{role:'user',content:`Analyze and return JSON:\n\n${t.substring(0,3000)}`}],temperature:0.1,max_tokens:600,response_format:{type:'json_object'}})})
    if (!r.ok) return {...e,lead_reasoning:`AI error: ${r.status}`}
    const d = await r.json()
    const c = (d.choices?.[0]?.message?.content||'{}').replace(/<think>[\s\S]*?<\/think>/g,'').trim()
    const p = JSON.parse(c||'{}')
    return {lead_score:p.lead_score||'unknown',lead_reasoning:p.lead_reasoning||'',service_needed:p.service_needed||'',caller_sentiment:p.caller_sentiment||'',key_quotes:p.key_quotes||''}
  } catch(x:any){return {...e,lead_reasoning:x.message}}
}

async function getTelnyxTranscription(rid: string): Promise<{text:string|null;error?:string}> {
  try {
    const r = await fetch(`${TELNYX_BASE}/recordings/${rid}/transcriptions`,{headers:{'Authorization':`Bearer ${TELNYX_API_KEY}`}})
    if (!r.ok) return {text:null,error:`TELNYX_${r.status}`}
    const d = await r.json()
    const tr = d.data?.[0]
    if (!tr) return {text:null,error:'NO_TRANSCRIPTION'}
    if (tr.status!=='completed') return {text:null,error:`STATUS_${tr.status}`}
    return {text:tr.transcription_text||null}
  } catch(x:any){return {text:null,error:x.message}}
}

async function requestTelnyxTranscription(rid: string): Promise<boolean> {
  try {
    const r = await fetch(`${TELNYX_BASE}/recordings/${rid}/transcriptions`,{method:'POST',headers:{'Authorization':`Bearer ${TELNYX_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({language_code:'en-US'})})
    return r.ok||r.status===409
  } catch{return false}
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')||'batch'
    const limit = parseInt(url.searchParams.get('limit')||'10')
    const db = getServiceClient()

    if (action==='debug') {
      const {data:calls} = await db.from('call_history').select('id,call_id,raw_data').is('transcript',null).not('raw_data','is',null).limit(1)
      if (!calls?.length) return NextResponse.json({error:'No calls'})
      const rd = calls[0].raw_data as any
      return NextResponse.json({id:calls[0].id,has_rid:!!rd?.recording_id,rid:rd?.recording_id,has_wav:!!rd?.download_urls?.wav,has_openrouter:!!OPENROUTER_API_KEY,model:AI_MODEL,keys:rd?Object.keys(rd):[]})
    }

    if (action==='score') {
      const {data:calls} = await db.from('call_history').select('id,transcript').not('transcript','is',null).neq('transcript','[transcription_failed]').neq('transcript','[no_recording]').neq('transcript','[recording_expired]').is('lead_score',null).limit(limit)
      if (!calls?.length) return NextResponse.json({success:true,scored:0})
      let scored=0
      for (const c of calls) {
        if (!c.transcript) continue
        const s = await scoreLeadFromTranscript(c.transcript)
        await db.from('call_history').update({lead_score:s.lead_score,lead_reasoning:s.lead_reasoning,service_needed:s.service_needed,caller_sentiment:s.caller_sentiment,key_quotes:s.key_quotes}).eq('id',c.id)
        scored++
      }
      return NextResponse.json({success:true,scored})
    }

    if (action==='batch') {
      const {data:calls,error} = await db.from('call_history').select('id,call_id,raw_data,transcript').is('transcript',null).not('raw_data','is',null).order('start_time',{ascending:false}).limit(limit)
      if (error||!calls?.length) return NextResponse.json({success:true,processed:0,remaining:0,error:error?.message})
      let transcribed=0,scored=0,expired=0
      const results:any[]=[]      
      for (const call of calls) {
        const rd = call.raw_data as any
        const rid = rd?.recording_id
        const storedUrl = rd?.download_urls?.wav||rd?.download_urls?.mp3
        let transcript:string|null=null
        let transcriptError:string|undefined

        // Step 1: Try to get a fresh URL from Telnyx API
                const freshUrl = rid ? await getFreshWavUrl(rid, rd?.call_session_id) : null
        
        // Step 2: Use freshUrl if available, otherwise fall back to storedUrl
        const audioUrl = freshUrl || storedUrl

                // Step 3: Try OpenRouter transcription with whatever URL we have
        if (audioUrl) {
          const tr = await transcribeViaOpenRouter(audioUrl)
          transcript = tr.text
          transcriptError = tr.error
        }
        // Step 4: If OpenRouter failed but we have storedUrl and didn't try it yet, try storedUrl directly
        if (!transcript && storedUrl && freshUrl && storedUrl !== freshUrl) {
          const tr2 = await transcribeViaOpenRouter(storedUrl); transcript = tr2.text; transcriptError = tr2.error
        }

        // Step 5: Try Telnyx native transcription as last resort
        if (!transcript && rid) {
          const {text,error:te} = await getTelnyxTranscription(rid)
          if (text) transcript=text; else transcriptError=te
        }

        // No recording ID and no stored URL = truly no audio
        if (!transcript && !audioUrl && !rid) {
          await db.from('call_history').update({transcript:'[no_recording]'}).eq('id',call.id)
          results.push({id:call.id,status:'no_audio_source'}); continue
        }

        // Only mark as expired if BOTH fresh URL and stored URL are unavailable
        if (!transcript && !freshUrl && !storedUrl) {
          await db.from('call_history').update({transcript:'[recording_expired]',transcribed_at:new Date().toISOString()}).eq('id',call.id)
          expired++
          results.push({id:call.id,status:'recording_expired'}); continue
        }

        // We had a URL but transcription failed - mark as failed, not expired
        if (!transcript && audioUrl) {
          await db.from('call_history').update({transcript:'[transcription_failed]',transcribed_at:new Date().toISOString()}).eq('id',call.id)
          results.push({id:call.id,status:'transcription_failed',error:transcriptError,had_url:true}); continue
        }

        if (!transcript) {
          if (rid) await requestTelnyxTranscription(rid)
          results.push({id:call.id,status:'transcription_pending',error:transcriptError}); continue
        }

        const s = await scoreLeadFromTranscript(transcript)
        await db.from('call_history').update({transcript,lead_score:s.lead_score,lead_reasoning:s.lead_reasoning,service_needed:s.service_needed,caller_sentiment:s.caller_sentiment,key_quotes:s.key_quotes,transcribed_at:new Date().toISOString()}).eq('id',call.id)
        transcribed++;scored++
        results.push({id:call.id,lead_score:s.lead_score,service:s.service_needed})
      }
      const {count} = await db.from('call_history').select('id',{count:'exact',head:true}).is('transcript',null).not('raw_data','is',null)
      return NextResponse.json({success:true,processed:calls.length,transcribed,scored,expired,remaining:count||0,results})
    }

    if (action==='retry-failed') {
      const {data,error} = await db.from('call_history').update({transcript:null,transcribed_at:null}).in('transcript',['[transcription_failed]','[recording_expired]']).select('id')
      return NextResponse.json({success:!error,reset:data?.length||0})
    }

    if (action==='stats') {
      const {count:total} = await db.from('call_history').select('id',{count:'exact',head:true})
      const {count:withTranscript} = await db.from('call_history').select('id',{count:'exact',head:true}).not('transcript','is',null).neq('transcript','[transcription_failed]').neq('transcript','[no_recording]').neq('transcript','[recording_expired]')
      const {count:withScore} = await db.from('call_history').select('id',{count:'exact',head:true}).not('lead_score','is',null).neq('lead_score','unknown')
      const {count:hot} = await db.from('call_history').select('id',{count:'exact',head:true}).eq('lead_score','hot')
      const {count:warm} = await db.from('call_history').select('id',{count:'exact',head:true}).eq('lead_score','warm')
      const {count:cold} = await db.from('call_history').select('id',{count:'exact',head:true}).eq('lead_score','cold')
      const {count:pending} = await db.from('call_history').select('id',{count:'exact',head:true}).is('transcript',null).not('raw_data','is',null)
      const {count:failed} = await db.from('call_history').select('id',{count:'exact',head:true}).eq('transcript','[transcription_failed]')
      const {count:expiredCount} = await db.from('call_history').select('id',{count:'exact',head:true}).eq('transcript','[recording_expired]')
      return NextResponse.json({total,withTranscript,withScore,hot,warm,cold,pending,failed,expired:expiredCount})
    }

    return NextResponse.json({error:'Use: batch, score, debug, retry-failed, stats'},{status:400})
  } catch(e:any) {
    return NextResponse.json({error:e.message},{status:500})
  }
}
export async function GET(req: NextRequest) {
  return POST(req)
}
