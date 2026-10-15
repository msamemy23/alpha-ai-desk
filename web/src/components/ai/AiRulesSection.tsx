'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { ErrorCard } from '@/components/ListKit'
import { apiJson } from '@/lib/ai/client-api'
import { ACTIONS, PERMISSION_LABELS, PERMISSION_ORDER, type PermissionClass } from '@/lib/ai/action-risk'
import { ALLOWED_MODES, RULE_LIMITS, TONES, defaultRules, normalizeRules, type AiRules, type RuleMode } from '@/lib/ai/shop-rules'

type Load = 'loading' | 'ready' | 'error'
type Save = 'idle' | 'saving' | 'saved' | 'error'
type Usage = { state: 'loading' } | { state: 'ready'; month: string; total: number; headline: string; breakdown: string } | { state: 'error'; message: string } | { state: 'hidden' }

const MODE_LABEL: Record<RuleMode, string> = { auto: 'Allowed', ask: 'Ask me first', never: 'Off' }

// Only actions with their own exact name can be switched off one by one.
const SWITCHABLE = Object.values(ACTIONS).filter(info => (info.permission === 'save' || info.permission === 'send') && !['scheduleTask', 'automationControl', 'webAutomation', 'desktop', 'connector.post', 'call', 'aiVoiceCall'].includes(info.id))
const AREAS = [...new Set(SWITCHABLE.map(info => info.area))]

function Panel({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return (
    <section className="panel p-4 sm:p-5" aria-labelledby={id ? `${id}-title` : undefined}>
      <h3 id={id ? `${id}-title` : undefined} className="section-title">{title}</h3>
      {description && <p className="mt-1 text-[0.9375rem] text-text-secondary">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function Toggle({ label, hint, on, onToggle, disabled }: { label: string; hint?: string; on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} disabled={disabled} className="ledger-row w-full text-left disabled:opacity-60">
      <span className="ledger-main">
        <span className="ledger-title block !whitespace-normal">{label}</span>
        {hint && <span className="ledger-sub block !whitespace-normal">{hint}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className={`w-8 text-right text-[0.875rem] font-bold ${on ? 'text-red' : 'text-text-secondary'}`}>{on ? 'Off' : 'On'}</span>
        <span aria-hidden="true" className={`relative inline-block h-7 w-12 rounded-full border ${on ? 'border-red bg-red' : 'border-blue bg-blue'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[rgb(var(--c-on-blue))] ${on ? 'left-0.5' : 'left-[1.5rem]'}`} />
        </span>
      </span>
    </button>
  )
}

/** A short list the owner adds to and removes from: banned phrases, never-do rules, shop facts. */
function ListEditor({ id, label, hint, placeholder, items, max, length, onChange, disabled, multiline = false }: {
  id: string; label: string; hint: string; placeholder: string; items: string[]; max: number; length: number; onChange: (items: string[]) => void; disabled: boolean; multiline?: boolean
}) {
  const [text, setText] = useState('')
  const trimmed = text.replace(/\s+/g, ' ').trim()
  const full = items.length >= max
  const duplicate = items.some(item => item.toLowerCase() === trimmed.toLowerCase())
  const add = () => {
    if (!trimmed || full || duplicate) return
    onChange([...items, trimmed.slice(0, length)])
    setText('')
  }
  return (
    <div>
      <label htmlFor={`${id}-input`} className="form-label">{label}</label>
      <div className="flex items-start gap-2">
        {multiline
          ? <textarea id={`${id}-input`} className="form-textarea min-h-[44px] flex-1" rows={2} maxLength={length} value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} disabled={disabled || full} aria-describedby={`${id}-hint`}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add() } }} />
          : <input id={`${id}-input`} className="form-input flex-1" maxLength={length} value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} disabled={disabled || full} aria-describedby={`${id}-hint`}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />}
        <button type="button" className="btn btn-secondary shrink-0" onClick={add} disabled={disabled || !trimmed || full || duplicate}>Add</button>
      </div>
      <p id={`${id}-hint`} className="form-hint">{full ? `That is the most you can keep (${max}). Remove one to add another.` : duplicate ? 'That one is already on the list.' : hint}</p>
      {items.length > 0 && (
        <ul className="ledger mt-3" aria-label={label}>
          {items.map(item => (
            <li key={item} className="flex items-start gap-2 px-1 py-2.5">
              <span className="min-w-0 flex-1 break-words text-[0.9375rem]">{item}</span>
              <button type="button" className="btn-icon -my-1 shrink-0" onClick={() => onChange(items.filter(other => other !== item))} disabled={disabled} aria-label={`Remove: ${item}`} title="Remove">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function AiRulesSection() {
  const [load, setLoad] = useState<Load>('loading')
  const [loadError, setLoadError] = useState('')
  const [available, setAvailable] = useState(true)
  const [canEdit, setCanEdit] = useState(false)
  const [saved, setSaved] = useState<AiRules>(defaultRules())
  const [draft, setDraft] = useState<AiRules>(defaultRules())
  const [save, setSave] = useState<Save>('idle')
  const [saveError, setSaveError] = useState('')
  const [usage, setUsage] = useState<Usage>({ state: 'loading' })
  const [keySaved, setKeySaved] = useState<boolean | null>(null)
  const [keyPhase, setKeyPhase] = useState<'idle' | 'confirm' | 'working'>('idle')
  const [keyMessage, setKeyMessage] = useState('')
  const [keyError, setKeyError] = useState('')

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved])

  const loadRules = useCallback(async () => {
    setLoad('loading')
    const result = await apiJson<{ rules?: unknown; available?: boolean; canEdit?: boolean }>('/api/ai-rules')
    if (!result.ok) {
      setLoadError(result.data.error || 'The assistant rules could not be loaded.')
      setLoad('error')
      return
    }
    const rules = normalizeRules(result.data.rules)
    setSaved(rules)
    setDraft(rules)
    setAvailable(result.data.available !== false)
    setCanEdit(result.data.canEdit === true)
    setLoad('ready')
  }, [])

  const loadUsage = useCallback(async () => {
    setUsage({ state: 'loading' })
    const result = await apiJson<{ month?: string; total?: number; headline?: string; breakdown?: string }>('/api/ai-activity?view=summary')
    if (result.status === 403) { setUsage({ state: 'hidden' }); return }
    if (!result.ok) { setUsage({ state: 'error', message: result.data.error || 'This month’s count could not be loaded.' }); return }
    setUsage({ state: 'ready', month: String(result.data.month || ''), total: Number(result.data.total || 0), headline: String(result.data.headline || ''), breakdown: String(result.data.breakdown || '') })
  }, [])

  const loadKey = useCallback(async () => {
    const result = await apiJson<{ settings?: Record<string, unknown> | null }>('/api/settings')
    setKeySaved(result.ok ? result.data.settings?.ai_api_key_configured === true : null)
  }, [])

  useEffect(() => { void loadRules(); void loadUsage(); void loadKey() }, [loadRules, loadUsage, loadKey])

  // Warn before a refresh throws unsaved rules away.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const edit = (change: (rules: AiRules) => AiRules) => {
    setDraft(current => change(current))
    setSave(current => (current === 'saved' ? 'idle' : current))
  }

  const setMode = (cls: PermissionClass, mode: RuleMode) => edit(rules => ({ ...rules, permissions: { ...rules.permissions, [cls]: mode } }))
  const toggleOverride = (id: string) => edit(rules => {
    const overrides = { ...rules.actionOverrides }
    if (overrides[id]) delete overrides[id]
    else overrides[id] = 'never'
    return { ...rules, actionOverrides: overrides }
  })

  const submit = async () => {
    if (save === 'saving') return
    setSave('saving')
    setSaveError('')
    const result = await apiJson<{ rules?: unknown; available?: boolean }>('/api/ai-rules', { method: 'PUT', body: { rules: draft } })
    if (!result.ok) {
      setSave('error')
      if (result.data.available === false) setAvailable(false)
      setSaveError(`${result.data.error || 'The rules could not be saved.'} What you typed is still here.`)
      return
    }
    const rules = normalizeRules(result.data.rules)
    setSaved(rules)
    setDraft(rules)
    setSave('saved')
  }

  const removeKey = async () => {
    setKeyPhase('working')
    setKeyError('')
    const result = await apiJson<{ removed?: boolean; message?: string }>('/api/ai-key', { method: 'DELETE', headers: { 'x-ai-approval': 'confirm' } })
    if (!result.ok) {
      setKeyPhase('confirm')
      setKeyError(result.data.error || 'The key could not be removed. Nothing was changed.')
      return
    }
    setKeyPhase('idle')
    setKeySaved(false)
    setKeyMessage(result.data.message || 'The saved AI key was removed.')
  }

  if (load === 'loading') {
    return <div className="space-y-3" aria-busy="true" aria-label="Loading assistant rules" role="status">{[0, 1, 2, 3].map(n => <div key={n} className="skeleton h-28" />)}</div>
  }
  if (load === 'error') {
    return <ErrorCard title="The assistant rules did not load" message={`${loadError} Nothing was changed.`} onRetry={loadRules} className="max-w-xl" />
  }

  const locked = !canEdit
  const overridden = Object.keys(draft.actionOverrides).length

  return (
    <div className="space-y-4" data-testid="ai-rules">
      {!available && (
        <Notice kind="warn">
          <p className="font-bold">Rules need a database update before they can be saved.</p>
          <p>Until then the assistant uses its built-in rules: it asks you before it changes anything or contacts anyone. Nothing you type here is lost, but it will not be saved yet.</p>
        </Notice>
      )}
      {locked && <Notice kind="info">You can read these rules. Only the shop owner or an admin can change them.</Notice>}

      <Panel id="usage" title="This month" description="Everything the assistant did, counted from your activity history.">
        {usage.state === 'loading' && <div className="skeleton h-14" aria-busy="true" aria-label="Loading this month’s count" role="status" />}
        {usage.state === 'error' && <ErrorCard message={usage.message} onRetry={loadUsage} />}
        {usage.state === 'hidden' && <p className="text-[0.9375rem] text-text-secondary">Only owners and managers can see the monthly count.</p>}
        {usage.state === 'ready' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="num display text-[1.5rem] font-bold leading-tight" data-testid="ai-usage-total">{usage.headline}</p>
              <p className="text-[0.9375rem] text-text-secondary">{usage.month ? `${usage.month}: ` : ''}{usage.breakdown}</p>
            </div>
            <Link href="/activity" className="btn btn-secondary shrink-0">See what it did <Icon name="arrowRight" className="h-5 w-5" /></Link>
          </div>
        )}
      </Panel>

      <Panel id="tone" title="How it talks" description="The assistant uses this when it writes to your customers and to you.">
        <div role="radiogroup" aria-label="Tone" className="grid gap-2 sm:grid-cols-3">
          {TONES.map(tone => {
            const on = draft.tone === tone.id
            return (
              <button key={tone.id} type="button" role="radio" aria-checked={on} disabled={locked} onClick={() => edit(rules => ({ ...rules, tone: tone.id }))}
                className={`min-h-[44px] rounded-md border px-3 py-3 text-left disabled:opacity-60 ${on ? 'border-blue bg-blue/10' : 'border-line bg-bg-card'}`}>
                <span className="flex items-center gap-2 font-bold">{on && <Icon name="check" className="h-4 w-4 text-blue" strokeWidth={2.4} />}{tone.name}</span>
                <span className="mt-0.5 block text-[0.875rem] text-text-secondary">{tone.help}</span>
              </button>
            )
          })}
        </div>
        <div>
          <label htmlFor="rules-tone-notes" className="form-label">Anything else about how it should sound</label>
          <textarea id="rules-tone-notes" className="form-textarea" rows={2} maxLength={RULE_LIMITS.toneNotes} disabled={locked} value={draft.toneNotes}
            onChange={e => edit(rules => ({ ...rules, toneNotes: e.target.value }))} placeholder="For example: we say “ma’am” and “sir”, and we never use emoji." aria-describedby="rules-tone-count" />
          <p id="rules-tone-count" className="form-hint num">{draft.toneNotes.length} of {RULE_LIMITS.toneNotes}</p>
        </div>
      </Panel>

      <Panel id="permissions" title="What it may do" description="Changes and messages always wait for your OK. Here you can switch a whole kind of action off.">
        <ul className="ledger" aria-label="What the assistant may do">
          {PERMISSION_ORDER.map(cls => {
            const modes = ALLOWED_MODES[cls]
            const fixed = modes.length === 1
            return (
              <li key={cls} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 py-3">
                <span className="min-w-0 flex-1 basis-56">
                  <span className="block font-bold">{PERMISSION_LABELS[cls].name}</span>
                  <span className="block text-[0.875rem] leading-snug text-text-secondary">{PERMISSION_LABELS[cls].help}</span>
                </span>
                {fixed
                  ? <span className="tag tag-gray shrink-0">Never</span>
                  : <select aria-label={`${PERMISSION_LABELS[cls].name}: setting`} className="form-select w-auto min-w-[10rem] shrink-0" disabled={locked} value={draft.permissions[cls]} onChange={e => setMode(cls, e.target.value as RuleMode)}>
                      {modes.map(mode => <option key={mode} value={mode}>{MODE_LABEL[mode]}</option>)}
                    </select>}
              </li>
            )
          })}
        </ul>
      </Panel>

      <Panel id="actions" title="Switch off single actions" description="Turn off one thing and the assistant will not offer it, even when the kind of action above is allowed.">
        <details className="group" open={overridden > 0}>
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 font-bold [&::-webkit-details-marker]:hidden">
            <Icon name="chevronRight" className="h-4 w-4 transition-transform group-open:rotate-90" />
            {overridden ? `${overridden} switched off` : 'Nothing is switched off'}
            <span className="font-normal text-text-secondary">Show the list</span>
          </summary>
          <div className="mt-3 space-y-4">
            {AREAS.map(area => (
              <div key={area}>
                <h4 className="text-[0.8125rem] font-bold text-text-secondary">{area}</h4>
                <ul className="ledger mt-1">
                  {SWITCHABLE.filter(info => info.area === area).map(info => (
                    <li key={info.id}>
                      <Toggle label={info.title} hint={info.customerFacing ? 'Reaches a customer' : undefined} on={Boolean(draft.actionOverrides[info.id])} onToggle={() => toggleOverride(info.id)} disabled={locked} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </Panel>

      <Panel id="never-do" title="What it must never do" description="Your own rules, in your own words. The assistant is told to follow them.">
        <ListEditor id="rules-never-do" label="Add a rule" hint="For example: never offer a discount." placeholder="Never offer a discount" items={draft.neverDo} max={RULE_LIMITS.neverDo.count} length={RULE_LIMITS.neverDo.length}
          onChange={items => edit(rules => ({ ...rules, neverDo: items }))} disabled={locked} />
        <ListEditor id="rules-never-say" label="Words and phrases it must never use with a customer" hint="A message with one of these cannot be approved. Matching ignores capital letters." placeholder="guaranteed lowest price" items={draft.neverSay} max={RULE_LIMITS.neverSay.count} length={RULE_LIMITS.neverSay.length}
          onChange={items => edit(rules => ({ ...rules, neverSay: items }))} disabled={locked} />
      </Panel>

      <Panel id="facts" title="Facts it can state" description="Hours, warranty, payment methods, policies. If a fact is not here or in your records, the assistant says it does not know instead of guessing.">
        <ListEditor id="rules-facts" label="Add a fact" hint="One fact at a time, in a full sentence." placeholder="We are closed on Sundays." items={draft.facts} max={RULE_LIMITS.facts.count} length={RULE_LIMITS.facts.length}
          onChange={items => edit(rules => ({ ...rules, facts: items }))} disabled={locked} multiline />
      </Panel>

      {!locked && (
        <div className="flex flex-wrap items-center gap-3" data-testid="rules-save">
          <button type="button" className="btn btn-primary btn-lg" onClick={submit} disabled={save === 'saving' || !dirty || !available} aria-busy={save === 'saving'}>
            {save === 'saving' && <span aria-hidden="true" className="spinner inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" />}
            Save rules
          </button>
          <p aria-live="polite" className="min-w-0 flex-1 basis-48 text-[0.9375rem]">
            {save === 'error' ? <span role="alert" className="flex items-start gap-2"><span className="lamp lamp-red mt-1.5" aria-hidden="true" /><span><strong>Not saved.</strong> {saveError}</span></span>
              : save === 'saving' ? <span className="flex items-center gap-2"><span className="lamp lamp-blue" aria-hidden="true" />Saving…</span>
              : dirty ? <span className="flex items-center gap-2"><span className="lamp lamp-amber" aria-hidden="true" /><strong>Unsaved changes</strong></span>
              : save === 'saved' ? <span className="flex items-center gap-2"><span className="lamp lamp-green" aria-hidden="true" />Rules saved. The assistant follows them from its next message.</span>
              : <span className="flex items-center gap-2 text-text-secondary"><span className="lamp lamp-off" aria-hidden="true" />No changes to save</span>}
          </p>
        </div>
      )}

      <Panel id="key" title="Saved AI key" description="The key the assistant uses to think. It is never shown here, only whether one is saved.">
        {keySaved === null && <p className="text-[0.9375rem] text-text-secondary">Could not check whether a key is saved. <button type="button" className="min-h-[44px] font-bold text-blue underline underline-offset-4" onClick={loadKey}>Check again</button></p>}
        {keySaved === true && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 font-bold"><span className="lamp lamp-green" aria-hidden="true" />An AI key is saved for this shop</p>
            {keyPhase === 'idle' && (
              <div className="flex flex-wrap gap-3">
                {canEdit && <button type="button" className="btn btn-danger" onClick={() => { setKeyPhase('confirm'); setKeyMessage('') }}>Remove saved key</button>}
                <Link href="/settings#ai" className="btn btn-secondary">Replace it</Link>
              </div>
            )}
            {keyPhase !== 'idle' && (
              <div className="rounded-md border border-line p-3">
                <p className="font-bold">Remove the saved key?</p>
                <p className="mt-1 text-[0.9375rem] text-text-secondary">The assistant stops answering until you add a key again or connect your ChatGPT plan. Nothing else is deleted.</p>
                {keyError && <p role="alert" className="mt-2 rounded-md bg-red/[0.12] px-3 py-2 text-[0.9375rem]">{keyError}</p>}
                <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={() => { setKeyPhase('idle'); setKeyError('') }} disabled={keyPhase === 'working'}>Keep it</button>
                  <button type="button" className="btn btn-danger w-full sm:w-auto" onClick={removeKey} disabled={keyPhase === 'working'} aria-busy={keyPhase === 'working'}>{keyPhase === 'working' ? 'Removing…' : 'Yes, remove it'}</button>
                </div>
              </div>
            )}
          </div>
        )}
        {keySaved === false && <p className="flex items-center gap-2"><span className="lamp lamp-off" aria-hidden="true" />{keyMessage || 'No AI key is saved. That is fine if you use your ChatGPT plan.'}</p>}
      </Panel>
    </div>
  )
}
