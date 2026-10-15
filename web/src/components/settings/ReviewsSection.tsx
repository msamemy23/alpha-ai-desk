'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { Group } from './fields'
import { ButtonSpinner, getAuthJsonHeaders } from './shared'

export default function ReviewsSection({ shopName }: { shopName: string }) {
  const [text, setText] = useState('')
  const [stars, setStars] = useState(5)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const draftResponse = async () => {
    if (!text.trim()) return
    setLoading(true); setDraft(''); setError(''); setCopied(false)
    try {
      const name = shopName || 'our shop'
      const tone = stars >= 4 ? 'grateful and warm' : stars >= 3 ? 'appreciative and constructive' : 'empathetic, apologetic, and professional'
      const prompt = 'You are responding to a ' + stars + '-star Google review for "' + name + '". The review says: "' + text.trim() + '"\n\nWrite a ' + tone + ' response from the business owner. Keep it 2-4 sentences, professional but personable. Do not use generic filler. Address specific points. Return ONLY the response text.'
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ message: prompt, history: [], sessionId: 'review-draft' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'The AI did not answer')
      if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('The AI sent back an empty reply')
      setDraft(data.reply)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Alpha could not reach the AI.')
    } finally { setLoading(false) }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* the text is selectable, so it can be copied by hand */ }
  }

  return (
    <div className="space-y-4">
      <Group title="Reply to a Google review" description="Paste a review and Alpha drafts a reply. Read it, change anything you like, then copy it into your Google Business reply. Nothing is posted for you.">
        <div>
          <span id="stars-label" className="form-label">Star rating the customer gave</span>
          <div role="group" aria-labelledby="stars-label" className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setStars(n)}
                aria-pressed={n === stars}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                className="btn-icon"
              >
                <Icon name="star" className={`h-7 w-7 ${n <= stars ? 'fill-current text-amber' : 'text-text-muted'}`} />
              </button>
            ))}
            <span className="num ml-2 text-[0.9375rem] text-text-secondary">{stars} of 5</span>
          </div>
        </div>
        <div>
          <label htmlFor="rev-text" className="form-label">What the customer wrote</label>
          <textarea id="rev-text" className="form-textarea" rows={5} value={text} onChange={e => setText(e.target.value)} placeholder="Paste the review here" />
        </div>
        <button type="button" className="btn btn-primary btn-lg w-full sm:w-auto" onClick={draftResponse} disabled={loading || !text.trim()} aria-busy={loading}>
          {loading ? <><ButtonSpinner /> Drafting reply…</> : 'Draft reply'}
        </button>

        {error && (
          <Notice kind="error">
            <p className="font-bold">The reply could not be drafted.</p>
            <p>{error}</p>
            <p className="mt-1">Your review text is still here. Check your AI settings, then choose Draft reply again.</p>
            <a href="#ai" className="btn btn-secondary mt-2 no-underline">Open AI settings</a>
          </Notice>
        )}
      </Group>

      {draft && (
        <section className="panel p-4 sm:p-5" aria-labelledby="draft-h">
          <h3 id="draft-h" className="section-title">Your draft reply</h3>
          <label htmlFor="rev-draft" className="sr-only">Draft reply. You can edit it before copying.</label>
          <textarea id="rev-draft" className="form-textarea mt-3" rows={6} value={draft} onChange={e => { setDraft(e.target.value); setCopied(false) }} />
          <p className="form-hint !text-text-secondary">You can change the wording before you copy it.</p>
          <button type="button" className="btn btn-secondary mt-3" onClick={copy}>
            <Icon name={copied ? 'check' : 'copy'} className="h-5 w-5" />
            {copied ? 'Copied' : 'Copy reply'}
          </button>
        </section>
      )}
    </div>
  )
}
