'use client'
import { useRef, useState } from 'react'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'
import Icon from '@/components/Icon'
import { getShopId, supabase } from '@/lib/supabase'
import { errText } from './helpers'
import { copyFlags, draftAd } from './post-draft'

interface Props {
  platform: 'google' | 'facebook'
  shopName?: string
  /** The shop's own city, when its profile has one. */
  cityLabel: string | null
  onClose: () => void
  onSaved: (message: string) => void
}

/** Plans an ad and saves it as a draft. Saving starts nothing and spends nothing. */
export default function AdsSheet({ platform: first, shopName = '', cityLabel, onClose, onSaved }: Props) {
  const [platform, setPlatform] = useState(first)
  const [name, setName] = useState('')
  const [budget, setBudget] = useState('20')
  const [keywords, setKeywords] = useState(`oil change${cityLabel ? ' ' + cityLabel : ''}, auto repair near me`)
  const [headline, setHeadline] = useState('')
  const [adText, setAdText] = useState('')
  const [topic, setTopic] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [draftNote, setDraftNote] = useState('')
  const [aiWritten, setAiWritten] = useState(false)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const amount = Number(budget)
  const budgetErr = !(amount >= 5) ? 'Enter at least $5 a day.' : ''
  const nameErr = !name.trim() ? 'Give the campaign a name.' : ''
  const g = platform === 'google'
  const headMax = g ? 30 : 40
  const textMax = g ? 90 : 250
  const copyErr = !headline.trim() ? 'Write a headline for the ad.' : !adText.trim() ? 'Write the ad text.' : [...headline].length > headMax ? `Keep the headline to ${headMax} characters.` : [...adText].length > textMax ? `Keep the ad text to ${textMax} characters.` : ''
  const flags = aiWritten ? copyFlags(`${headline}\n${adText}`, [topic, name, shopName, cityLabel || '']) : []

  const writeIt = async () => {
    if (drafting || !topic.trim()) return
    setDrafting(true); setDraftNote('')
    const r = await draftAd({ shopName, city: cityLabel || '', platform, topic: topic.trim() })
    setDrafting(false)
    if (!r.ok) { setDraftNote(r.error); return }
    setHeadline(r.headline); setAdText(r.text); setAiWritten(true)
  }

  const save = async () => {
    setTried(true)
    if (nameErr || budgetErr || copyErr || busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Refresh, or sign out and back in.')
      const row = { shop_id: shopId, name: name.trim(), platform, objective: 'leads', budget_per_day: amount, keywords, status: 'draft', spend: 0 }
      const ad_copy = { headline: headline.trim(), primary_text: adText.trim(), description: adText.trim().slice(0, 90), source: aiWritten ? 'ai_edited_by_owner' : 'owner', approved_by_owner: true }
      let { error: e } = await supabase.from('growth_campaigns').insert({ ...row, ad_copy })
      let copySaved = true
      // A database that has not been updated yet has no place for the wording. Save the plan anyway and say so.
      if (e && (e.code === '42703' || e.code === 'PGRST204' || /ad_copy|schema cache/i.test(e.message || ''))) {
        copySaved = false
        e = (await supabase.from('growth_campaigns').insert(row)).error
      }
      if (e) throw new Error(e.message)
      onSaved(copySaved ? 'Campaign draft saved. Nothing was started.' : 'Campaign saved without the ad wording, which needs a database update. Nothing was started.')
    } catch (e) {
      setError(`The campaign was not saved. ${errText(e, 'Check your connection and try again.')}`)
    } finally { busy.current = false; setSaving(false) }
  }

  return (
    <Sheet open onClose={onClose} title={`New ${platform === 'google' ? 'Google' : 'Facebook'} ads campaign`}>
      <form onSubmit={e => { e.preventDefault(); void save() }} className="space-y-4" noValidate>
        <div role="group" aria-label="Where the ads run" className="grid grid-cols-2 gap-2">
          {(['google', 'facebook'] as const).map(p => (
            <button key={p} type="button" aria-pressed={platform === p} onClick={() => setPlatform(p)} className={`btn ${platform === p ? 'border-blue bg-blue/10 text-blue' : 'btn-secondary'}`}>
              {platform === p && <Icon name="check" className="h-4 w-4" strokeWidth={2.4} />}
              {p === 'google' ? 'Google ads' : 'Facebook ads'}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="ads-name" className="form-label">Campaign name</label>
          <input id="ads-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Spring brake special" aria-invalid={tried && !!nameErr} />
          {tried && nameErr && <p className="form-error">{nameErr}</p>}
        </div>
        <div>
          <label htmlFor="ads-budget" className="form-label">Daily budget in dollars</label>
          <input id="ads-budget" className="form-input" type="number" inputMode="decimal" min="5" value={budget} onChange={e => setBudget(e.target.value)} aria-invalid={tried && !!budgetErr} />
          {tried && budgetErr && <p className="form-error">{budgetErr}</p>}
        </div>
        <div>
          <label htmlFor="ads-keywords" className="form-label">Words people search for</label>
          <input id="ads-keywords" className="form-input" value={keywords} onChange={e => setKeywords(e.target.value)} aria-describedby="ads-kw-hint" />
          <p id="ads-kw-hint" className="form-hint">Separate them with commas.</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <label htmlFor="ads-topic" className="form-label">Want a first draft? Say what to advertise</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="ads-topic" className="form-input" value={topic} maxLength={300} onChange={e => setTopic(e.target.value)} placeholder="For example: brake inspections" />
            <button type="button" className="btn btn-secondary shrink-0" onClick={() => void writeIt()} disabled={drafting || !topic.trim()} aria-busy={drafting}>
              <Icon name="pen" className="h-5 w-5" />{drafting ? 'Writing…' : 'Write it for me'}
            </button>
          </div>
          <p className="form-hint">Alpha only uses what you type here. It will not make up prices, offers or promises.</p>
          {draftNote && <p className="form-error">{draftNote}</p>}
        </div>
        <div>
          <label htmlFor="ads-headline" className="form-label">Headline</label>
          <input id="ads-headline" className="form-input" value={headline} onChange={e => setHeadline(e.target.value)} aria-invalid={tried && !!copyErr} aria-describedby="ads-headline-hint" />
          <p id="ads-headline-hint" className="form-hint"><span className="num">{[...headline].length}</span> of {headMax} characters.</p>
        </div>
        <div>
          <label htmlFor="ads-text" className="form-label">Ad text</label>
          <textarea id="ads-text" className="form-textarea" rows={3} value={adText} onChange={e => setAdText(e.target.value)} aria-invalid={tried && !!copyErr} aria-describedby="ads-text-hint" />
          <p id="ads-text-hint" className="form-hint"><span className="num">{[...adText].length}</span> of {textMax} characters.</p>
          {tried && copyErr && <p className="form-error">{copyErr}</p>}
          {flags.map(f => <Notice key={f} kind="warn" className="mt-2">{f}</Notice>)}
        </div>
        {(headline.trim() || adText.trim()) && (
          <div className="rounded-lg border border-border bg-bg-base p-3" aria-label="Preview of the ad">
            <p className="mb-2 flex items-center gap-2 text-[0.8125rem] font-bold text-text-secondary"><Icon name="eye" className="h-4 w-4" />Preview of the ad</p>
            <div className="rounded-md border border-border bg-bg-card p-3">
              {g ? <p className="text-[0.8125rem] text-text-secondary"><span className="tag tag-gray mr-2">Ad</span>Your website</p> : <p className="text-[0.8125rem] font-bold">{shopName || 'Your shop'} <span className="font-normal text-text-secondary">· Sponsored</span></p>}
              {!g && <p className="mt-2 whitespace-pre-wrap break-words text-[0.9375rem]">{adText}</p>}
              <p className="mt-1 break-words text-[1.0625rem] font-bold text-blue">{headline || 'Your headline'}</p>
              {g && <p className="mt-1 whitespace-pre-wrap break-words text-[0.9375rem]">{adText}</p>}
            </div>
          </div>
        )}
        <Notice kind="info">
          <p className="font-bold">Saving does not start any ads or spend money.</p>
          <p>Starting ads needs your {g ? 'Google Ads' : 'Facebook Ads'} account connected and a payment method on it. That step is still missing, so read the preview, save the draft, and start it in your ad account.</p>
        </Notice>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button>
        </div>
      </form>
    </Sheet>
  )
}
