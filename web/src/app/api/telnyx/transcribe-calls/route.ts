import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'
export const maxDuration = 300
const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-r1'
const TELNYX_BASE = 'https://api.telnyx.com/v2'
async function getFreshWavUrl(rid: string): Promise<string|null> {
  try {
    const r = await fetch(`${TELNYX_BASE}/recordings/${rid}`,{headers:{'Authorization':`Bearer ${TELNYX_API_KEY}`}})
    if (!r.ok) return null
    const d = await r.json()
    return d.data?.download_urls?.wav||d.data?.download_urls?.mp3||null
  } catch{return null}
}
async function transcribeViaOpenRouter(url: string): Promise<string|null> {
  try {
    if (!OPENROUTER_API_KEY) return null
    let ar = await fetch(url)
    if (!ar.ok) ar = await fetch(url,{headers:{'Authorization':`Bearer ${TELNYX_API_KEY}`}})
    if (!ar.ok) return null
    const buf = await ar.arrayBuffer()
    const b64 = Buffer.from(buf).toString('base64')
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{'Authorization':`Bearer ${OPENROUTER_API_KEY}`,'Content-Type':'application/json','HTTP-Referer':'https://alpha-ai-desk.vercel.app','X-Title':'Alpha AI Desk'},body:JSON.stringify({model:'openai/gpt-4o-mini-audio-preview',messages:[{role:'user',content:[{type:'input_audio',input_audio:{data:b64,format:'wav'}},{type:'text',text:'Transcribe this audio word for word. Return ONLY the text.'}]}],max_tokens:4000})})
    if (!r.ok) return null
    const d = await r.json()
    const t = d.choices?.[0]?.message?.content?.trim()
    return t&&t.length>5?t:null
  } catch{return null}
}
async function scoreLeadFromTranscript(t: string):
  Promise<{lead_score:string;lead_reasoning:string;service_needed:string;caller_sentiment:string;key_quotes:string}> {
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

        const freshUrl = rid ? await getFreshWavUrl(rid) : null
        const audioUrl = freshUrl||storedUrl

        if (audioUrl) {
          transcript = await transcribeViaOpenRouter(audioUrl)
        }

        if (!transcript&&rid) {
          const {text,error:te} = await getTelnyxTranscription(rid)
          if (text) transcript=text; else transcriptError=te
        }

        if (!transcript&&!audioUrl&&!rid) {
          await db.from('call_history').update({transcript:'[no_recording]'}).eq('id',call.id)
          results.push({id:call.id,status:'no_audio_source'}); continue
        }

        // KEY FIX: If Telnyx returns 404, the recording has expired - mark it permanently
        if (!transcript && transcriptError && (transcriptError.includes('404') || transcriptError.includes('TELNYX_404'))) {
          await db.from('call_history').update({transcript:'[recording_expired]',transcribed_at:new Date().toISOString()}).eq('id',call.id)
          expired++
          results.push({id:call.id,status:'recording_expired'}); continue
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
      const {data,error} = await db.from('call_history').update({transcript:null,transcribed_at:null}).eq('transcript','[transcription_failed]').select('id')
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
