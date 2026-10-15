'use client'
import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard } from '@/components/ListKit'
import { ScreenToast, useToast } from '@/components/ScreenParts'
import { blastTemplate, describeResult, OPT_OUT_LINE } from '@/lib/automation-text'
import ActivityLog from '@/components/automations/ActivityLog'
import AutoSheet from '@/components/automations/AutoSheet'
import type { Outcome } from '@/components/automations/AutoSheet'
import ConfigSheet from '@/components/automations/ConfigSheet'
import ConfirmSheet from '@/components/automations/ConfirmSheet'
import CustomCard from '@/components/automations/CustomCard'
import CustomSheet from '@/components/automations/CustomSheet'
import type { CustomInput } from '@/components/automations/CustomSheet'
import PlanSheet from '@/components/automations/PlanSheet'
import SystemCard from '@/components/automations/SystemCard'
import { call, childReason } from '@/components/automations/api'
import { CATEGORIES, copyFor } from '@/components/automations/copy'
import { useActivity } from '@/components/automations/useActivity'
import { useAutomations } from '@/components/automations/useAutomations'
import type { CustomAutomation, SystemAutomation } from '@/components/automations/types'

const SYSTEM = '/api/system-automations'
const CUSTOM = '/api/automations'

/** A bare 10-digit phone number reads as (713) 555-0143. Names and emails are left alone. */
const prettyWho = (v: string) => (/^\d{10}$/.test(v) ? `(${v.slice(0, 3)}) ${v.slice(3, 6)}-${v.slice(6)}` : v)

export default function AutomationsPage() {
  const a = useAutomations()
  const log = useActivity()
  const { toast, notify, dismiss } = useToast()
  const { system, custom, loadAll, setSystem, setCustom, shop, city } = a
  const { reload: reloadLog } = log

  const [runningId, setRunningId] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const inFlight = useRef<Set<string>>(new Set())
  const [autoSheet, setAutoSheet] = useState<null | { id: string; mode: 'view' | 'run' | 'enable' }>(null)
  const [configFor, setConfigFor] = useState<string | null>(null)
  const [customSheet, setCustomSheet] = useState<null | { item: CustomAutomation | null }>(null)
  const [deleting, setDeleting] = useState<CustomAutomation | null>(null)
  const [plan, setPlan] = useState<null | { title: string; text: string; cut: boolean }>(null)

  const closeAuto = useCallback(() => setAutoSheet(null), [])
  const closeConfig = useCallback(() => setConfigFor(null), [])
  const closeCustom = useCallback(() => setCustomSheet(null), [])
  const closePlan = useCallback(() => setPlan(null), [])
  const closeDelete = useCallback(() => setDeleting(null), [])

  const mark = (id: string, on: boolean) => {
    if (on) inFlight.current.add(id); else inFlight.current.delete(id)
    setBusyIds(new Set(inFlight.current))
  }

  // ── Built-in automations ────────────────────────────────────────────

  const configure = useCallback(async (id: string, config: Record<string, unknown>): Promise<string> => {
    const r = await call(SYSTEM, { action: 'configure', id, config })
    if (!r.ok) return r.error
    await loadAll()
    return ''
  }, [loadAll])

  /** Lead search without a city searches Houston on the server, so the shop's own city is saved first. */
  const ensureCity = useCallback(async (auto: SystemAutomation): Promise<string> => {
    if (auto.id !== 'lead_discovery' || String(auto.state.config.city || '').trim()) return ''
    if (!city) return 'Add your shop’s city in the setup guide first, so Alpha knows where to search.'
    return configure(auto.id, { city: city.search })
  }, [city, configure])

  const setEnabled = useCallback(async (auto: SystemAutomation, next: boolean): Promise<string> => {
    if (inFlight.current.has(auto.id)) return 'This is still being saved. Wait a moment.'
    mark(auto.id, true)
    try {
      if (next) {
        const noCity = await ensureCity(auto)
        if (noCity) return noCity
      }
      setSystem(prev => prev.map(x => x.id === auto.id ? { ...x, state: { ...x.state, enabled: next } } : x))
      const r = await call(SYSTEM, { action: 'toggle', id: auto.id, enabled: next })
      if (!r.ok) {
        setSystem(prev => prev.map(x => x.id === auto.id ? { ...x, state: { ...x.state, enabled: !next } } : x))
        void loadAll()
        return r.error
      }
      const saved = r.data.state
      if (saved && typeof saved === 'object') setSystem(prev => prev.map(x => x.id === auto.id ? { ...x, state: { ...x.state, ...saved } } : x))
      return ''
    } finally {
      mark(auto.id, false)
    }
  }, [ensureCity, loadAll, setSystem])

  const toggleSystem = async (auto: SystemAutomation, next: boolean) => {
    const c = copyFor(auto.id, auto.name)
    // Turning on something that texts or emails people starts with what it will send and to whom.
    if (next && c.contacts) { setAutoSheet({ id: auto.id, mode: 'enable' }); return }
    const err = await setEnabled(auto, next)
    if (err) notify(`${c.name} was not changed. ${err}`, 'error')
    else notify(next ? `${c.name} is on.` : `${c.name} is paused.`, 'success')
  }

  const runSystem = useCallback(async (auto: SystemAutomation): Promise<Outcome> => {
    if (runningId) return { ok: false, error: 'Another automation is running. Wait for it to finish.' }
    setRunningId(auto.id)
    try {
      const noCity = await ensureCity(auto)
      if (noCity) return { ok: false, error: noCity }
      const r = await call(SYSTEM, { action: 'run_now', id: auto.id })
      const result = r.data.result
      const summary = describeResult(auto.id, result ? JSON.stringify(result) : null, r.ok ? 'ok' : 'error') || undefined
      const items: Record<string, unknown>[] = Array.isArray(result?.results) ? result.results : []
      const failures = items
        .filter(i => i.sent === false && !i.skipped && !i.dry_run)
        .map(i => ({ name: prettyWho(String(i.customer || i.name || i.email || i.phone || 'Customer')), reason: childReason(i.error) }))
      void loadAll()
      void reloadLog()
      return { ok: r.ok, error: r.ok ? undefined : (summary?.tone === 'error' ? summary.text : r.error), summary, failures }
    } finally {
      setRunningId(null)
    }
  }, [ensureCity, loadAll, reloadLog, runningId])

  const runDirect = async (auto: SystemAutomation) => {
    const c = copyFor(auto.id, auto.name)
    const out = await runSystem(auto)
    if (out.ok) notify(`${c.name}: ${out.summary?.text || 'finished.'}`, out.summary?.tone === 'warn' ? 'info' : 'success')
    else notify(`${c.name} did not run. ${out.error || 'Try again.'}`, 'error')
  }

  const runSystemClick = (auto: SystemAutomation) => {
    if (copyFor(auto.id, auto.name).contacts) setAutoSheet({ id: auto.id, mode: 'run' })
    else void runDirect(auto)
  }

  const saveConfig = (id: string) => async (config: Record<string, unknown>): Promise<string> => {
    const err = await configure(id, config)
    if (!err) notify('Settings saved.', 'success')
    return err
  }

  const addOptOut = (auto: SystemAutomation) => async (): Promise<boolean> => {
    const err = await configure(auto.id, { message_template: `${blastTemplate(auto.state.config.message_template)} ${OPT_OUT_LINE}` })
    if (err) { notify(`The opt-out line was not added. ${err}`, 'error'); return false }
    notify('The opt-out line was added.', 'success')
    return true
  }

  // ── Your own automations ────────────────────────────────────────────

  const submitCustom = (item: CustomAutomation | null) => async (input: CustomInput): Promise<string> => {
    const body = item
      ? { action: 'update', id: item.id, name: input.name, description: input.description, schedule: input.schedule, task_prompt: input.prompt }
      : { action: 'create', name: input.name, description: input.description, schedule: input.schedule, task_prompt: input.prompt }
    const r = await call(CUSTOM, body)
    if (!r.ok) return r.error
    notify(item ? `${input.name} was saved.` : `${input.name} was added.`, 'success')
    void loadAll()
    return ''
  }

  const toggleCustom = async (item: CustomAutomation, next: boolean) => {
    if (inFlight.current.has(item.id)) return
    mark(item.id, true)
    setCustom(prev => prev.map(x => x.id === item.id ? { ...x, enabled: next } : x))
    const r = await call(CUSTOM, { action: 'toggle', id: item.id, enabled: next })
    mark(item.id, false)
    if (!r.ok) {
      setCustom(prev => prev.map(x => x.id === item.id ? { ...x, enabled: !next } : x))
      notify(`${item.name} was not changed. ${r.error}`, 'error')
      void loadAll()
    } else notify(next ? `${item.name} is on.` : `${item.name} is paused.`, 'success')
  }

  const runCustom = async (item: CustomAutomation) => {
    if (runningId) return
    setRunningId(item.id)
    const r = await call(CUSTOM, { action: 'run_now', id: item.id })
    setRunningId(null)
    void loadAll()
    const proposal = r.data?.data?.proposal
    if (r.ok && typeof proposal === 'string' && proposal.trim()) setPlan({ title: `${item.name}: what Alpha wrote`, text: proposal, cut: false })
    else if (r.ok) notify(`${item.name} ran, but Alpha wrote nothing.`, 'info')
    else notify(`${item.name} did not run. ${r.error}`, 'error')
  }

  const deleteCustom = async (): Promise<string> => {
    if (!deleting) return ''
    const r = await call(CUSTOM, { action: 'delete', id: deleting.id })
    if (!r.ok) return r.error
    notify(`${deleting.name} was deleted.`, 'success')
    void loadAll()
    return ''
  }

  // ── Page ────────────────────────────────────────────────────────────

  const failedBoth = !!a.sysError && !!a.custError
  const anyFailed = !!a.sysError || !!a.custError
  const totalOn = system.filter(x => x.state.enabled).length + custom.filter(x => x.enabled).length
  const sheetAuto = autoSheet ? system.find(x => x.id === autoSheet.id) : undefined
  const configAuto = configFor ? system.find(x => x.id === configFor) : undefined

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Automations</h1>
          <p className="page-subtitle">Jobs Alpha does for you on a schedule, like review requests and reminders.</p>
        </div>
        <div className="toolbar sm:justify-end">
          {!a.loading && !anyFailed && (
            <p className="mr-2 flex items-center gap-2 font-bold">
              <span className={`lamp ${totalOn > 0 ? 'lamp-green' : 'lamp-off'}`} aria-hidden="true" />
              {totalOn > 0 ? `${totalOn} on` : 'All paused'}
            </p>
          )}
          <button type="button" className="btn btn-primary" onClick={() => setCustomSheet({ item: null })}>
            <Icon name="plus" className="h-5 w-5" />
            New automation
          </button>
        </div>
      </header>

      <div className="mb-6 max-w-2xl space-y-2 text-[0.9375rem] text-text-secondary">
        <p className="flex items-start gap-2">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>Alpha checks the schedule once a day. Each automation runs once in that check, not at the exact time. To run one right now, tap Run now.</span>
        </p>
        <p className="flex items-start gap-2">
          <Icon name="send" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            To tell a customer their car is ready, open the job in Work. You read the text before it goes.
            <Link href="/jobs" className="mt-1 flex min-h-11 items-center font-bold text-blue underline underline-offset-2">Go to Work</Link>
          </span>
        </p>
      </div>

      {a.loading ? (
        <div className="space-y-8" aria-busy="true" role="status" aria-label="Loading automations">
          {[0, 1].map(s => (
            <div key={s}>
              <div className="skeleton mb-3 h-6 w-48" />
              <div className="grid gap-3 lg:grid-cols-2">{[0, 1].map(i => <div key={i} className="skeleton h-44" />)}</div>
            </div>
          ))}
        </div>
      ) : failedBoth && system.length === 0 && custom.length === 0 ? (
        <ErrorCard title="Automations did not load" message={`${a.sysError} Try again.`} onRetry={a.reload} className="max-w-xl" />
      ) : (
        <div className="space-y-10">
          {a.sysError && <ErrorCard title="The built-in automations did not load" message={`${a.sysError}${custom.length ? ' Your own automations are below.' : ''}`} onRetry={a.reload} className="max-w-xl" />}
          {CATEGORIES.map(cat => {
            const items = system.filter(x => x.category === cat.id)
            if (items.length === 0) return null
            return (
              <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
                <div className="mb-3 flex items-center gap-2">
                  <Icon name={cat.icon} className="h-5 w-5 shrink-0 text-text-secondary" />
                  <h2 id={`cat-${cat.id}`} className="section-title">{cat.label}</h2>
                  <span className="ml-auto text-[0.9375rem] text-text-secondary">{items.filter(x => x.state.enabled).length} of {items.length} on</span>
                </div>
                <ul className="grid gap-3 lg:grid-cols-2">
                  {items.map(auto => (
                    <li key={auto.id}>
                      <SystemCard
                        auto={auto}
                        busy={busyIds.has(auto.id)}
                        running={runningId === auto.id}
                        onToggle={next => void toggleSystem(auto, next)}
                        onRun={() => runSystemClick(auto)}
                        onView={() => setAutoSheet({ id: auto.id, mode: 'view' })}
                        onSettings={() => setConfigFor(auto.id)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

          <section aria-labelledby="cat-custom">
            <div className="mb-1 flex items-center gap-2">
              <Icon name="pen" className="h-5 w-5 shrink-0 text-text-secondary" />
              <h2 id="cat-custom" className="section-title">Your own automations</h2>
              {!a.custError && custom.length > 0 && <span className="ml-auto text-[0.9375rem] text-text-secondary">{custom.filter(x => x.enabled).length} of {custom.length} on</span>}
            </div>
            <p className="mb-3 text-[0.9375rem] text-text-secondary">Alpha writes what you ask for and saves it here for you to read. These never send a text or post on their own.</p>
            {a.custError && <ErrorCard title="Your own automations did not load" message={a.custError} onRetry={a.reload} className="mb-3 max-w-xl" />}
            {!a.custError && custom.length === 0 ? (
              <EmptyBlock
                icon="pen"
                title="You have not added any automations yet"
                action={<button type="button" className="btn btn-primary" onClick={() => setCustomSheet({ item: null })}><Icon name="plus" className="h-5 w-5" />New automation</button>}
              >
                Ask Alpha to write something on a schedule, for example a good-morning post for Facebook at 8am.
              </EmptyBlock>
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {custom.map(item => (
                  <li key={item.id}>
                    <CustomCard
                      item={item}
                      busy={busyIds.has(item.id)}
                      running={runningId === item.id}
                      onToggle={next => void toggleCustom(item, next)}
                      onRun={() => void runCustom(item)}
                      onRead={() => setPlan({ title: `${item.name}: what Alpha wrote`, text: item.last_result || '', cut: (item.last_result || '').length >= 495 })}
                      onEdit={() => setCustomSheet({ item })}
                      onDelete={() => setDeleting(item)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ActivityLog items={log.items} state={log.state} missing={log.missing} onRetry={() => void log.reload()} />
        </div>
      )}

      {autoSheet && sheetAuto && (
        <AutoSheet
          key={`${sheetAuto.id}-${autoSheet.mode}`}
          auto={sheetAuto}
          mode={autoSheet.mode}
          shop={shop}
          onClose={closeAuto}
          onRetryShop={() => void a.loadShop()}
          onAddOptOut={sheetAuto.id === 'sms_blast' ? addOptOut(sheetAuto) : undefined}
          onConfirm={async () => {
            if (autoSheet.mode === 'enable') {
              const err = await setEnabled(sheetAuto, true)
              return err ? { ok: false, error: err } : { ok: true }
            }
            return runSystem(sheetAuto)
          }}
        />
      )}
      {configAuto && <ConfigSheet key={configAuto.id} auto={configAuto} shop={shop} city={city} onClose={closeConfig} onSave={saveConfig(configAuto.id)} />}
      {customSheet && <CustomSheet key={customSheet.item?.id || 'new'} item={customSheet.item} onClose={closeCustom} onSubmit={submitCustom(customSheet.item)} />}
      {deleting && (
        <ConfirmSheet title={`Delete ${deleting.name}?`} confirmLabel="Delete" busyLabel="Deleting…" danger onClose={closeDelete} onConfirm={deleteCustom}>
          <p>It stops running, and the plans it wrote are gone. This cannot be undone.</p>
        </ConfirmSheet>
      )}
      {plan && <PlanSheet title={plan.title} text={plan.text} cut={plan.cut} onClose={closePlan} />}

      <ScreenToast toast={toast} onClose={dismiss} />
    </div>
  )
}
