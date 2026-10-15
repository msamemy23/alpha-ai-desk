'use client'
import { useId, useRef, useState } from 'react'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'
import { scheduleWords } from '@/lib/automation-text'
import type { CustomAutomation } from './types'

export interface CustomInput { name: string; description: string; schedule: string; prompt: string }

// Each of these only needs Alpha to write something. A plan of your own cannot look at your customers or jobs.
const PRESETS = [
  { label: 'Morning post', schedule: '8:00am', prompt: 'Write a short, friendly good-morning post for Facebook saying our shop is open and ready, with our shop name and phone number.' },
  { label: 'Weekly special idea', schedule: 'mon 9:00am', prompt: 'Suggest one simple weekly special for an independent auto repair shop. Give the wording for a text message and for a Facebook post.' },
  { label: 'Review thank-you', schedule: 'fri 5:00pm', prompt: 'Write a short thank-you reply we can send to a customer who just left a five-star Google review.' },
  { label: 'Seasonal car care', schedule: 'mon 8:00am', prompt: 'Write a short text we can send customers about seasonal car care that fits this time of year, such as battery, tire or brake checks.' },
]

interface Props {
  /** Set to edit one that exists. */
  item?: CustomAutomation | null
  onClose: () => void
  /** Returns an empty string when it saved, or the reason it did not. */
  onSubmit: (input: CustomInput) => Promise<string>
}

export default function CustomSheet({ item, onClose, onSubmit }: Props) {
  const editing = !!item
  const [name, setName] = useState(item?.name || '')
  const [schedule, setSchedule] = useState(item?.schedule || '')
  const [prompt, setPrompt] = useState(item?.task_prompt || '')
  const [desc, setDesc] = useState(item?.description || '')
  const [saving, setSaving] = useState(false)
  const [tried, setTried] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const base = useId()

  const words = schedule.trim() ? scheduleWords(schedule) : null
  const nameErr = !name.trim() ? 'Give it a name.' : ''
  const scheduleErr = !schedule.trim() ? 'Say when it should run.' : !words ? 'Use a time like 8:00am, or a day and time like mon 9:00am.' : ''
  const promptErr = !prompt.trim() ? 'Describe what Alpha should write.' : ''

  const submit = async () => {
    setTried(true)
    if (nameErr || scheduleErr || promptErr || busy.current) return
    busy.current = true
    setSaving(true)
    const reason = await onSubmit({ name: name.trim(), description: desc.trim(), schedule: schedule.trim(), prompt: prompt.trim() })
    busy.current = false
    setSaving(false)
    if (reason) setError(reason)
    else onClose()
  }

  return (
    <Sheet open onClose={() => { if (!saving) onClose() }} title={editing ? 'Edit automation' : 'New automation'}>
      <form onSubmit={e => { e.preventDefault(); void submit() }} className="space-y-4" noValidate>
        <Notice kind="info">
          Alpha writes what you ask for and saves it on this page for you to read. It cannot look at your customers or jobs, and it never sends a text or posts by itself.
        </Notice>

        {!editing && (
          <div>
            <p className="form-label">Start from an idea</p>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map(p => (
                <button key={p.label} type="button" onClick={() => { setName(p.label); setSchedule(p.schedule); setPrompt(p.prompt); setError('') }} className="btn btn-secondary justify-start !px-3 text-left">{p.label}</button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label htmlFor={`${base}-name`} className="form-label">Name</label>
          <input id={`${base}-name`} className="form-input" placeholder="Morning Facebook post" value={name} maxLength={160} onChange={e => { setName(e.target.value); setError('') }} aria-invalid={tried && !!nameErr} aria-describedby={tried && nameErr ? `${base}-name-err` : undefined} />
          {tried && nameErr && <p id={`${base}-name-err`} className="form-error">{nameErr}</p>}
        </div>
        <div>
          <label htmlFor={`${base}-when`} className="form-label">When</label>
          <input id={`${base}-when`} className="form-input" placeholder="8:00am or mon 9:00am" value={schedule} maxLength={100} onChange={e => { setSchedule(e.target.value); setError('') }} aria-invalid={tried && !!scheduleErr} aria-describedby={`${base}-when-hint`} autoCapitalize="none" />
          {tried && scheduleErr && <p className="form-error">{scheduleErr}</p>}
          <p id={`${base}-when-hint`} className="form-hint">{words ? `${words}. Alpha checks once a day, so it may run a little later than the time you pick.` : 'Examples: 8:00am for every day, or mon 9:00am for once a week.'}</p>
        </div>
        <div>
          <label htmlFor={`${base}-prompt`} className="form-label">What should Alpha write?</label>
          <textarea id={`${base}-prompt`} className="form-textarea" rows={4} maxLength={4000} placeholder="Write a short good-morning post for Facebook saying we are open today, with our shop name and phone number" value={prompt} onChange={e => { setPrompt(e.target.value); setError('') }} aria-invalid={tried && !!promptErr} aria-describedby={`${base}-prompt-hint`} />
          {tried && promptErr && <p className="form-error">{promptErr}</p>}
          <p id={`${base}-prompt-hint`} className="form-hint">Ask for wording, ideas or a draft. Alpha does not know your numbers, so do not ask it for stats.</p>
        </div>
        <div>
          <label htmlFor={`${base}-note`} className="form-label">Note to yourself (optional)</label>
          <input id={`${base}-note`} className="form-input" value={desc} maxLength={1000} onChange={e => setDesc(e.target.value)} />
        </div>

        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add automation'}</button>
        </div>
      </form>
    </Sheet>
  )
}
