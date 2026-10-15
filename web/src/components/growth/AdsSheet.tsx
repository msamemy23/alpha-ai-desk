'use client'
import { useRef, useState } from 'react'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'
import Icon from '@/components/Icon'
import { getShopId, supabase } from '@/lib/supabase'
import { errText } from './helpers'

interface Props {
  platform: 'google' | 'facebook'
  /** The shop's own city, when its profile has one. */
  cityLabel: string | null
  onClose: () => void
  onSaved: (message: string) => void
}

/** Plans an ad and saves it as a draft. Saving starts nothing and spends nothing. */
export default function AdsSheet({ platform: first, cityLabel, onClose, onSaved }: Props) {
  const [platform, setPlatform] = useState(first)
  const [name, setName] = useState('')
  const [budget, setBudget] = useState('20')
  const [keywords, setKeywords] = useState(`oil change${cityLabel ? ' ' + cityLabel : ''}, auto repair near me`)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const amount = Number(budget)
  const budgetErr = !(amount >= 5) ? 'Enter at least $5 a day.' : ''
  const nameErr = !name.trim() ? 'Give the campaign a name.' : ''

  const save = async () => {
    setTried(true)
    if (nameErr || budgetErr || busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Refresh, or sign out and back in.')
      const { error: e } = await supabase.from('growth_campaigns').insert({ shop_id: shopId, name: name.trim(), platform, objective: 'leads', budget_per_day: amount, keywords, status: 'draft', spend: 0 })
      if (e) throw new Error(e.message)
      onSaved('Campaign draft saved. Nothing was started.')
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
        <Notice kind="info">This saves a draft. It does not start any ads or spend money.</Notice>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button>
        </div>
      </form>
    </Sheet>
  )
}
