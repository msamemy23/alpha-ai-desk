'use client'
import { useId, useRef, useState } from 'react'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'
import { smsParts } from '@/lib/growth-text'
import { blastTemplate, hasOptOutLine, OPT_OUT_LINE, wholeNumber } from '@/lib/automation-text'
import { copyFor } from './copy'
import type { Field } from './copy'
import { plural } from './parts'
import type { ShopFacts, SystemAutomation } from './types'

interface Props {
  auto: SystemAutomation
  shop: ShopFacts
  city: { search: string; label: string } | null
  onClose: () => void
  /** Returns an empty string when it saved, or the reason it did not. */
  onSave: (config: Record<string, unknown>) => Promise<string>
}

const startValue = (f: Field, config: Record<string, unknown>, city: Props['city']): string => {
  const saved = config[f.key] ?? (f.fallbackKey ? config[f.fallbackKey] : undefined)
  if (f.key === 'city') return String(saved || city?.search || '')
  if (f.key === 'message_template') return blastTemplate(saved)
  if (f.type === 'select') return f.options?.some(o => o.value === saved) ? String(saved) : String(f.default)
  return saved === undefined || saved === null || saved === '' ? String(f.default) : String(saved)
}

/** The settings that really change what an automation does. Each box is checked before it is saved. */
export default function ConfigSheet({ auto, shop, city, onClose, onSave }: Props) {
  const c = copyFor(auto.id, auto.name)
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(c.fields.map(f => [f.key, startValue(f, auto.state.config, city)])))
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const base = useId()

  const set = (key: string, v: string) => { setVals(p => ({ ...p, [key]: v })); setError('') }

  const problems: Record<string, string> = {}
  for (const f of c.fields) {
    const v = vals[f.key] ?? ''
    if (f.type === 'int' && wholeNumber(v, f.min ?? 0, f.max ?? 100000) === null) problems[f.key] = `Enter a whole number from ${f.min} to ${f.max}.`
    if (f.key === 'city' && !v.trim()) problems[f.key] = 'Enter the city to search, for example Katy TX.'
    if (f.key === 'message_template') {
      if (!v.trim()) problems[f.key] = 'Write the text.'
      else if (v.trim().length > 1600) problems[f.key] = 'The text is too long. Keep it under 1,600 characters.'
      else if (!hasOptOutLine(v)) problems[f.key] = 'Add the opt-out line so people can say no.'
    }
  }
  const hasProblems = Object.keys(problems).length > 0

  const save = async () => {
    setTried(true)
    if (hasProblems || busy.current) return
    busy.current = true
    setSaving(true)
    const config: Record<string, unknown> = {}
    for (const f of c.fields) {
      const v = vals[f.key].trim()
      if (f.type === 'int') {
        const n = wholeNumber(v, f.min ?? 0, f.max ?? 100000) as number
        config[f.key] = n
        if (f.fallbackKey) config[f.fallbackKey] = n
      } else config[f.key] = v
    }
    const reason = await onSave(config)
    busy.current = false
    setSaving(false)
    if (reason) setError(reason)
    else onClose()
  }

  const tpl = vals.message_template
  const parts = tpl !== undefined ? smsParts(tpl.replace(/\{name\}/gi, 'Sam')) : null

  return (
    <Sheet open onClose={() => { if (!saving) onClose() }} title={`${c.name} settings`}>
      <form onSubmit={e => { e.preventDefault(); void save() }} className="space-y-4" noValidate>
        {c.fields.map(f => {
          const id = `${base}-${f.key}`
          const err = tried ? problems[f.key] : ''
          const hint = `${id}-hint`
          return (
            <div key={f.key}>
              <label htmlFor={id} className="form-label">{f.label}</label>
              {f.type === 'select' ? (
                <select id={id} className="form-select" value={vals[f.key]} onChange={e => set(f.key, e.target.value)} aria-describedby={hint}>
                  {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea id={id} className="form-textarea" rows={5} value={vals[f.key]} onChange={e => set(f.key, e.target.value)} aria-invalid={!!err} aria-describedby={err ? `${id}-err` : hint} />
              ) : (
                <input
                  id={id} className="form-input" value={vals[f.key]} onChange={e => set(f.key, e.target.value)}
                  type="text" inputMode={f.type === 'int' ? 'numeric' : undefined} autoComplete="off"
                  aria-invalid={!!err} aria-describedby={err ? `${id}-err` : hint}
                />
              )}
              {err && <p id={`${id}-err`} className="form-error">{err}</p>}
              <p id={hint} className="form-hint">{f.hint}</p>
              {f.key === 'city' && !city && <p className="form-hint">Your shop’s city is not in your profile yet. Type it here, or add it in the setup guide.</p>}
              {f.key === 'message_template' && (
                <>
                  <p className="form-hint">{parts ? `${parts.chars} characters, ${plural(parts.parts, 'text message', 'text messages')} each.` : ''}</p>
                  {!hasOptOutLine(vals[f.key]) && (
                    <Notice kind="warn" className="mt-2">
                      <p>This text has no opt-out line. Promotional texts need “{OPT_OUT_LINE}” so people can say no.</p>
                      <button type="button" className="btn btn-secondary mt-2" onClick={() => set(f.key, `${vals[f.key].trim()} ${OPT_OUT_LINE}`.trim())}>Add the opt-out line</button>
                    </Notice>
                  )}
                  <div className="mt-3">
                    <p className="form-label">What a customer sees</p>
                    <div className="rounded-lg bg-bg-hover px-3 py-2.5"><p className="whitespace-pre-wrap break-words text-[0.9375rem]">{vals[f.key].replace(/\{name\}/gi, 'Sam') || ' '}</p></div>
                    <p className="form-hint">Shown for a customer named Sam.{shop.name ? '' : ' Your shop name is not set, so add it to the text yourself.'}</p>
                  </div>
                </>
              )}
            </div>
          )
        })}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      </form>
    </Sheet>
  )
}
