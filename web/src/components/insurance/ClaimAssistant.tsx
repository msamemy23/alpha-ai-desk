'use client'
import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { supabase } from '@/lib/supabase'
import { addOpenAIOAuthHeaders } from '@/lib/openai-oauth-client'
import { carOf, fmtForAi } from './types'
import type { ClaimMsg, Job } from './types'

async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) headers.Authorization = 'Bearer ' + data.session.access_token
  } catch { /* the request will say if it was not allowed */ }
  return addOpenAIOAuthHeaders(headers)
}

const greeting = (job: Job): ClaimMsg => ({
  role: 'assistant',
  content: `I'm ready to help with the insurance claim for ${job.customer_name || 'this customer'}'s ${carOf(job) || 'vehicle'}.\n\nClaim number: ${job.claim_number || 'Not entered'}\nInsurance: ${job.insurance_company || 'Not entered'}\nApproved: ${fmtForAi(job.approved_amount)}\n\nHow can I help? I can:\n- Draft supplement requests\n- Write adjuster emails\n- Explain coverage questions\n- Prepare documentation`,
})

/** Ask Alpha about one claim. The claim's details go along with every question. Give it `key={claim id}` so each claim starts a fresh conversation. */
export default function ClaimAssistant({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const [chat, setChat] = useState<ClaimMsg[]>(() => (job ? [greeting(job)] : []))
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const log = useRef<HTMLDivElement>(null)

  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight }, [chat, loading])

  const ask = async (text: string, base: ClaimMsg[]) => {
    if (!job) return
    const updated = [...base, { role: 'user' as const, content: text }]
    setChat(updated); setLoading(true)
    try {
      const jobContext = 'Insurance job context: Customer: ' + job.customer_name +
        ', Vehicle: ' + carOf(job) +
        ', Insurance: ' + (job.insurance_company || 'unknown') +
        ', Claim #: ' + (job.claim_number || 'N/A') +
        ', Adjuster: ' + (job.adjuster || job.adjuster_name || 'N/A') +
        ', Adjuster Phone: ' + (job.adjuster_phone || 'N/A') +
        ', Approved: ' + fmtForAi(job.approved_amount) +
        ', Deductible: ' + fmtForAi(job.deductible) +
        ', Supplement status: ' + (job.supplement_status || 'None') +
        ', Status: ' + (job.status || 'N/A') +
        ', Notes: ' + (job.inspection_notes || 'none')
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ message: jobContext + '\n\nUser request: ' + text, history: base.slice(-10), sessionId: 'insurance-' + job.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'AI request failed')
      setChat([...updated, { role: 'assistant', content: data.reply || 'Alpha could not write a reply. Try asking again.' }])
    } catch (error) {
      const why = error instanceof Error && error.message ? error.message : 'Alpha could not be reached. Check your AI settings and try again.'
      setChat([...updated, { role: 'assistant', content: why, failed: true }])
    } finally { setLoading(false) }
  }

  const send = () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    void ask(text, chat)
  }
  const lastFailed = chat.length >= 2 && chat[chat.length - 1].failed
  const retry = () => {
    const user = chat[chat.length - 2]
    if (!user || user.role !== 'user') return
    void ask(user.content, chat.slice(0, -2))
  }

  return (
    <Sheet open={!!job} onClose={onClose} title="Ask Alpha about this claim" wide>
      {job && (
        <div className="flex flex-col gap-3">
          <p className="-mt-2 text-text-secondary">{job.customer_name || 'Customer'} · {job.insurance_company || 'Insurance not entered'}{job.claim_number ? ` · claim ${job.claim_number}` : ''}</p>
          <div ref={log} className="h-[min(55dvh,28rem)] space-y-3 overflow-y-auto rounded-md border border-border bg-bg-base p-3" role="log" aria-live="polite" aria-label="Conversation">
            {chat.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 ${m.role === 'user' ? 'bg-blue text-[rgb(var(--c-on-blue))]' : m.failed ? 'flex items-start gap-2 border border-red/50 bg-red/[0.08] text-text-primary' : 'border border-border bg-bg-card text-text-primary'}`}>
                  {m.failed && <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" />}
                  <span>{m.failed ? `Alpha did not answer. ${m.content}` : m.content}</span>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-lg border border-border bg-bg-card px-3.5 py-2.5 text-text-secondary">Alpha is thinking…</div>
              </div>
            )}
          </div>
          {lastFailed && !loading && <button type="button" className="btn btn-secondary self-start" onClick={retry}><Icon name="refresh" className="h-5 w-5" />Ask again</button>}
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); send() }}>
            <label htmlFor="claim-input" className="sr-only">Ask about this claim</label>
            <input id="claim-input" className="form-input flex-1" placeholder="Ask about this claim" autoComplete="off" value={input} onChange={e => setInput(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()}><Icon name="send" className="h-5 w-5" />Send</button>
          </form>
        </div>
      )}
    </Sheet>
  )
}
