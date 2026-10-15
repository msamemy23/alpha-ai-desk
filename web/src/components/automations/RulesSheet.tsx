'use client'
import { useId, useRef, useState } from 'react'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { Switch } from '@/components/ScreenParts'
import { hourLabel, quietWords } from './model'
import type { Rules } from './model'

interface Props {
  rules: Rules
  onClose: () => void
  /** Saves the rules. Returns an empty string when it worked, or the reason it did not. */
  onSave: (rules: Partial<Rules>) => Promise<string>
}

const STARTS = [15, 16, 17, 18, 19, 20, 21]
const ENDS = [8, 9, 10, 11, 12]

/** The rules every automation follows: quiet hours, how often one customer can be texted, and who is told when something fails. */
export default function RulesSheet({ rules, onClose, onSave }: Props) {
  const base = useId()
  const [v, setV] = useState<Rules>(rules)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const dirty = (Object.keys(rules) as Array<keyof Rules>).some(k => rules[k] !== v[k])
  const set = <K extends keyof Rules>(k: K, val: Rules[K]) => { setV(p => ({ ...p, [k]: val })); setError('') }
  const num = (k: 'marketing_cap_days' | 'marketing_monthly_max' | 'service_daily_max') => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Math.floor(Number(e.target.value)) || 0)

  const submit = async () => {
    if (busy.current || !dirty) return
    busy.current = true; setSaving(true)
    const changes: Partial<Rules> = {}
    for (const k of Object.keys(rules) as Array<keyof Rules>) if (rules[k] !== v[k]) (changes as Record<string, unknown>)[k] = v[k]
    const reason = await onSave(changes)
    busy.current = false; setSaving(false)
    if (reason) setError(reason); else onClose()
  }

  return (
    <Sheet open onClose={() => { if (!saving) onClose() }} title="Rules for every automation" dirty={dirty}>
      <form onSubmit={e => { e.preventDefault(); void submit() }} className="space-y-5 text-[0.9375rem]" noValidate>
        <section aria-labelledby={`${base}-quiet`}>
          <h3 id={`${base}-quiet`} className="font-bold">Quiet hours</h3>
          <p className="mt-0.5 text-text-secondary">Texts to customers are never sent before 8 AM or after 9 PM where they live. You can make that window shorter, not longer. Texts held back go out when quiet hours end.</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${base}-start`} className="form-label">Quiet from</label>
              <select id={`${base}-start`} className="form-select" value={v.quiet_start_hour} onChange={e => set('quiet_start_hour', Number(e.target.value))}>
                {STARTS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${base}-end`} className="form-label">Until</label>
              <select id={`${base}-end`} className="form-select" value={v.quiet_end_hour} onChange={e => set('quiet_end_hour', Number(e.target.value))}>
                {ENDS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-border px-3">
            <span className="py-2 font-bold">No texts on Sundays</span>
            <Switch checked={v.skip_sundays} onChange={val => set('skip_sundays', val)} label="No texts on Sundays" />
          </div>
          <p className="form-hint !text-text-secondary">{quietWords(v)}.</p>
        </section>

        <section aria-labelledby={`${base}-limits`}>
          <h3 id={`${base}-limits`} className="font-bold">How often one customer is texted</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={`${base}-cap`} className="form-label">Days between marketing texts</label>
              <input id={`${base}-cap`} className="form-input" type="number" inputMode="numeric" min={1} max={90} value={v.marketing_cap_days || ''} onChange={num('marketing_cap_days')} />
            </div>
            <div>
              <label htmlFor={`${base}-month`} className="form-label">Marketing texts per month</label>
              <input id={`${base}-month`} className="form-input" type="number" inputMode="numeric" min={1} max={15} value={v.marketing_monthly_max || ''} onChange={num('marketing_monthly_max')} />
            </div>
            <div>
              <label htmlFor={`${base}-day`} className="form-label">Service texts per day</label>
              <input id={`${base}-day`} className="form-input" type="number" inputMode="numeric" min={1} max={10} value={v.service_daily_max || ''} onChange={num('service_daily_max')} />
            </div>
          </div>
          <p className="form-hint !text-text-secondary">Marketing is anything that asks for a visit, a review or a sale. Service texts are about the customer’s own car, like a reminder or &quot;your car is ready&quot;. These limits count every automation together.</p>
        </section>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3">
          <span className="py-2"><span className="block font-bold">Email me when a message fails</span><span className="block text-text-secondary">One email a day per automation, to your shop email address. Failures also show at the top of this page.</span></span>
          <Switch checked={v.alert_on_failure} onChange={val => set('alert_on_failure', val)} label="Email me when a message fails" />
        </div>

        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !dirty} aria-busy={saving}>{saving ? 'Saving…' : 'Save rules'}</button>
        </div>
      </form>
    </Sheet>
  )
}
