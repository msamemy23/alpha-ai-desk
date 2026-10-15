'use client'
import { useCallback, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { ScreenToast, Segmented, Switch, useToast } from '@/components/ScreenParts'
import AutomationCard from '@/components/automations/AutomationCard'
import ConfirmSheet from '@/components/automations/ConfirmSheet'
import CustomCard from '@/components/automations/CustomCard'
import CustomSheet from '@/components/automations/CustomSheet'
import type { CustomInput } from '@/components/automations/CustomSheet'
import EditSheet from '@/components/automations/EditSheet'
import HistoryPanel from '@/components/automations/HistoryPanel'
import PlanSheet from '@/components/automations/PlanSheet'
import PreviewSheet from '@/components/automations/PreviewSheet'
import type { PreviewMode } from '@/components/automations/PreviewSheet'
import ResultsPanel from '@/components/automations/ResultsPanel'
import RulesSheet from '@/components/automations/RulesSheet'
import UpcomingPanel from '@/components/automations/UpcomingPanel'
import { call } from '@/components/automations/api'
import { CATEGORY_ICON, groupCards, plural, schedulerWords } from '@/components/automations/model'
import type { Card, Rules } from '@/components/automations/model'
import { useAutomationData, useHistory } from '@/components/automations/useAutomationData'
import type { CustomAutomation } from '@/components/automations/types'

const SYSTEM = '/api/system-automations'
const CUSTOM = '/api/automations'

type Tab = 'automations' | 'upcoming' | 'history' | 'results'
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'automations', label: 'Automations' },
  { key: 'upcoming', label: 'Coming up' },
  { key: 'history', label: 'History' },
  { key: 'results', label: 'Results' },
]

export default function AutomationsPage() {
  const d = useAutomationData()
  const { toast, notify, dismiss } = useToast()
  const [tab, setTab] = useState<Tab>('automations')
  const [filter, setFilter] = useState({ automation: '', status: '' })
  const history = useHistory(tab === 'history', filter)
  const { loadOverview, loadCustom, loadResults, setCustom, city } = d
  const { reload: reloadHistory } = history

  const [runningId, setRunningId] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const inFlight = useRef<Set<string>>(new Set())
  const [preview, setPreview] = useState<null | { id: string; mode: PreviewMode }>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [showRules, setShowRules] = useState(false)
  const [masterAsk, setMasterAsk] = useState(false)
  const [customSheet, setCustomSheet] = useState<null | { item: CustomAutomation | null }>(null)
  const [deleting, setDeleting] = useState<CustomAutomation | null>(null)
  const [plan, setPlan] = useState<null | { title: string; text: string; cut: boolean }>(null)

  const overview = d.overview.value
  const cards = overview?.cards || []
  const rules = overview?.rules
  const timezone = overview?.shop.timezone || 'America/Chicago'

  const mark = (id: string, on: boolean) => {
    if (on) inFlight.current.add(id); else inFlight.current.delete(id)
    setBusyIds(new Set(inFlight.current))
  }
  const refreshAll = useCallback(() => { void loadOverview(); void loadResults(); if (tab === 'history') void reloadHistory() }, [loadOverview, loadResults, reloadHistory, tab])

  // ── Built-in automations ────────────────────────────────────────────

  const configure = useCallback(async (id: string, config: Record<string, unknown>): Promise<string> => {
    const r = await call(SYSTEM, { action: 'configure', id, config })
    if (!r.ok) return r.error
    await loadOverview()
    return ''
  }, [loadOverview])

  /** Lead search without a city would search the wrong place, so the shop's own city is saved first. */
  const ensureCity = useCallback(async (card: Card): Promise<string> => {
    if (card.id !== 'lead_discovery') return ''
    const have = card.fields.find(f => f.key === 'city')?.value
    if (typeof have === 'string' && have.trim()) return ''
    if (!city) return 'Add your shop’s city in the setup guide first, so Alpha knows where to search.'
    return configure(card.id, { city: city.search })
  }, [city, configure])

  const setEnabled = useCallback(async (card: Card, next: boolean): Promise<{ error: string; cancelled: number }> => {
    if (inFlight.current.has(card.id)) return { error: 'This is still being saved. Wait a moment.', cancelled: 0 }
    mark(card.id, true)
    try {
      if (next) { const noCity = await ensureCity(card); if (noCity) return { error: noCity, cancelled: 0 } }
      const r = await call(SYSTEM, { action: 'toggle', id: card.id, enabled: next })
      if (!r.ok) { void loadOverview(); return { error: r.error, cancelled: 0 } }
      await loadOverview()
      return { error: '', cancelled: Number(r.data.cancelled) || 0 }
    } finally { mark(card.id, false) }
  }, [ensureCity, loadOverview])

  const toggle = async (card: Card, next: boolean) => {
    if (next && card.kind === 'engine') { setPreview({ id: card.id, mode: 'enable' }); return }
    const out = await setEnabled(card, next)
    if (out.error) notify(`${card.name} was not changed. ${out.error}`, 'error')
    else if (next) notify(`${card.name} is on.`, 'success')
    else notify(out.cancelled > 0 ? `${card.name} is paused. ${plural(out.cancelled, 'waiting message')} cancelled.` : `${card.name} is paused.`, 'success')
  }

  const runCard = useCallback(async (card: Card): Promise<{ ok: boolean; message: string }> => {
    if (runningId) return { ok: false, message: 'Another automation is running. Wait for it to finish.' }
    setRunningId(card.id)
    try {
      const noCity = await ensureCity(card)
      if (noCity) return { ok: false, message: noCity }
      const r = await call(SYSTEM, { action: 'run_now', id: card.id })
      refreshAll()
      const message = typeof r.data.message === 'string' && r.data.message ? r.data.message : r.ok ? 'Finished.' : ''
      return r.ok ? { ok: true, message: `${card.name}: ${message}` } : { ok: false, message: r.error || message || 'It did not run. Try again.' }
    } finally { setRunningId(null) }
  }, [ensureCity, refreshAll, runningId])

  const runClick = async (card: Card) => {
    if (card.kind === 'engine') { setPreview({ id: card.id, mode: 'run' }); return }
    const out = await runCard(card)
    notify(out.ok ? out.message : `${card.name} did not run. ${out.message}`, out.ok ? 'success' : 'error')
  }

  const saveSettings = (card: Card) => async (config: Record<string, unknown>): Promise<string> => {
    const r = await call(SYSTEM, { action: 'configure', id: card.id, config })
    if (!r.ok) return r.error
    const cancelled = Number(r.data.cancelled) || 0
    notify(cancelled > 0 ? `Settings saved. ${plural(cancelled, 'waiting message')} will be rebuilt with the new wording.` : 'Settings saved.', 'success')
    await loadOverview()
    return ''
  }

  const saveRules = async (changes: Partial<Rules>): Promise<string> => {
    const r = await call(SYSTEM, { action: 'set_rules', rules: changes })
    if (!r.ok) return r.error
    notify('Rules saved.', 'success')
    await loadOverview()
    return ''
  }

  const switchMaster = async (on: boolean): Promise<string> => {
    const r = await call(SYSTEM, { action: on ? 'resume_all' : 'pause_all' })
    if (!r.ok) return r.error
    const cancelled = Number(r.data.cancelled) || 0
    notify(on ? 'All automations are on again. Each one keeps its own on or paused setting.' : cancelled > 0 ? `All automations are off. ${plural(cancelled, 'waiting message')} cancelled.` : 'All automations are off.', 'success')
    await loadOverview()
    return ''
  }

  // ── Your own automations ────────────────────────────────────────────

  const submitCustom = (item: CustomAutomation | null) => async (input: CustomInput): Promise<string> => {
    const body = item
      ? { action: 'update', id: item.id, name: input.name, description: input.description, schedule: input.schedule, task_prompt: input.prompt }
      : { action: 'create', name: input.name, description: input.description, schedule: input.schedule, task_prompt: input.prompt }
    const r = await call(CUSTOM, body)
    if (!r.ok) return r.error
    notify(item ? `${input.name} was saved.` : `${input.name} was added.`, 'success')
    void loadCustom()
    return ''
  }

  const toggleCustom = async (item: CustomAutomation, next: boolean) => {
    if (inFlight.current.has(item.id)) return
    mark(item.id, true)
    setCustom(prev => ({ ...prev, value: prev.value.map(x => x.id === item.id ? { ...x, enabled: next } : x) }))
    const r = await call(CUSTOM, { action: 'toggle', id: item.id, enabled: next })
    mark(item.id, false)
    if (!r.ok) {
      setCustom(prev => ({ ...prev, value: prev.value.map(x => x.id === item.id ? { ...x, enabled: !next } : x) }))
      notify(`${item.name} was not changed. ${r.error}`, 'error')
      void loadCustom()
    } else notify(next ? `${item.name} is on.` : `${item.name} is paused.`, 'success')
  }

  const runCustom = async (item: CustomAutomation) => {
    if (runningId) return
    setRunningId(item.id)
    const r = await call(CUSTOM, { action: 'run_now', id: item.id })
    setRunningId(null)
    void loadCustom()
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
    void loadCustom()
    return ''
  }

  // ── Page ────────────────────────────────────────────────────────────

  const loading = d.overview.state === 'loading' && !overview
  const failed = d.overview.state === 'error' && !overview
  const custom = d.custom.value
  const totalOn = cards.filter(c => c.state.enabled).length + custom.filter(x => x.enabled).length
  const previewCard = preview ? cards.find(c => c.id === preview.id) : undefined
  const editCard = editing ? cards.find(c => c.id === editing) : undefined
  const sched = overview ? schedulerWords(overview.scheduler) : null
  const attention = (overview?.attention || []).filter(a => a.kind !== 'stopped')

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Automations</h1>
          <p className="page-subtitle">Texts and emails Alpha sends for you. You see them first, and you can stop them any time.</p>
        </div>
        <div className="toolbar sm:justify-end">
          {rules && (
            <div className="flex items-center gap-1 rounded-md border border-border bg-bg-card pl-3">
              <span className="flex items-center gap-2 font-bold"><span className={`lamp ${rules.master_enabled ? (totalOn > 0 ? 'lamp-green' : 'lamp-off') : 'lamp-red'}`} aria-hidden="true" />{rules.master_enabled ? 'All on' : 'All off'}</span>
              <Switch checked={rules.master_enabled} label="All automations on or off" onChange={next => { if (next) void switchMaster(true).then(e => e && notify(e, 'error')); else setMasterAsk(true) }} />
            </div>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => setShowRules(true)} disabled={!rules}>
            <Icon name="settings" className="h-5 w-5" />
            Rules
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setCustomSheet({ item: null })}>
            <Icon name="plus" className="h-5 w-5" />
            New automation
          </button>
        </div>
      </header>

      {loading ? (
        <div className="space-y-8" aria-busy="true" role="status" aria-label="Loading automations">
          {[0, 1].map(s => (
            <div key={s}>
              <div className="skeleton mb-3 h-6 w-48" />
              <div className="grid gap-3 lg:grid-cols-2">{[0, 1].map(i => <div key={i} className="skeleton h-56" />)}</div>
            </div>
          ))}
        </div>
      ) : failed ? (
        <ErrorCard title="Automations did not load" message={`${d.overview.error} Try again.`} onRetry={d.reload} className="max-w-xl" />
      ) : overview && rules ? (
        <>
          <Segmented label="Choose what to look at" idPrefix="auto" options={TABS} value={tab} onChange={setTab} columns="grid-cols-2 sm:grid-cols-4" />
          <div className="mt-5 space-y-2">
            {overview.needsDatabaseUpdate && <Notice kind="info">Message history, limits and results need a database update that has not been applied yet. Automations keep working, but they cannot show who was messaged or enforce per-customer limits until it is applied. Ask your developer.</Notice>}
            {!rules.master_enabled && <Notice kind="warn"><span className="font-bold">All automations are off.</span> Nothing is being sent and nothing is waiting. Switch them back on at the top of this page.</Notice>}
            {tab === 'automations' && attention.slice(0, 4).map(a => (
              <Notice key={a.id} kind={a.kind === 'failed' ? 'error' : 'warn'}>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words">{a.text}</span>
                  {a.kind === 'failed' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setFilter({ automation: a.automation_id || '', status: 'failed' }); setTab('history') }}>See which</button>}
                </span>
              </Notice>
            ))}
            {d.overview.state === 'error' && <Notice kind="error">The latest numbers could not be loaded. {d.overview.error}</Notice>}
            {tab === 'automations' && sched && (
              <p className="flex items-start gap-2 text-[0.9375rem] text-text-secondary">
                <span className={`lamp lamp-${sched.lamp} mt-[0.4rem]`} aria-hidden="true" />
                <span>{sched.text}</span>
              </p>
            )}
          </div>


          <div id="auto-panel" role="tabpanel" aria-labelledby={`auto-tab-${tab}`} className="mt-6">
            {tab === 'automations' && (
              <div className="space-y-10">
                {groupCards(cards).map(g => (
                  <section key={g.id} aria-labelledby={`cat-${g.id}`}>
                    <div className="mb-3 flex items-center gap-2">
                      <Icon name={CATEGORY_ICON[g.id] || 'bolt'} className="h-5 w-5 shrink-0 text-text-secondary" />
                      <h2 id={`cat-${g.id}`} className="section-title">{g.label}</h2>
                      <span className="ml-auto text-[0.9375rem] text-text-secondary">{g.cards.filter(c => c.state.enabled).length} of {g.cards.length} on</span>
                    </div>
                    <ul className="grid gap-3 lg:grid-cols-2">
                      {g.cards.map(card => (
                        <li key={card.id}>
                          <AutomationCard
                            card={card} rules={rules} timezone={timezone} busy={busyIds.has(card.id)} running={runningId === card.id}
                            onToggle={next => void toggle(card, next)}
                            onPreview={() => setPreview({ id: card.id, mode: 'view' })}
                            onEdit={() => setEditing(card.id)}
                            onRun={() => void runClick(card)}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}

                <section aria-labelledby="cat-custom">
                  <div className="mb-1 flex items-center gap-2">
                    <Icon name="pen" className="h-5 w-5 shrink-0 text-text-secondary" />
                    <h2 id="cat-custom" className="section-title">Your own automations</h2>
                    {d.custom.state !== 'error' && custom.length > 0 && <span className="ml-auto text-[0.9375rem] text-text-secondary">{custom.filter(x => x.enabled).length} of {custom.length} on</span>}
                  </div>
                  <p className="mb-3 text-[0.9375rem] text-text-secondary">Alpha writes what you ask for and saves it here for you to read. These never send a text or post on their own.</p>
                  {d.custom.state === 'error' && <ErrorCard title="Your own automations did not load" message={d.custom.error} onRetry={() => void loadCustom()} className="mb-3 max-w-xl" />}
                  {d.custom.state === 'loading' ? <div className="skeleton h-40" /> : d.custom.state !== 'error' && custom.length === 0 ? (
                    <EmptyBlock icon="pen" title="You have not added any automations yet" action={<button type="button" className="btn btn-primary" onClick={() => setCustomSheet({ item: null })}><Icon name="plus" className="h-5 w-5" />New automation</button>}>
                      Ask Alpha to write something on a schedule, for example a good-morning post for Facebook at 8am.
                    </EmptyBlock>
                  ) : (
                    <ul className="grid gap-3 lg:grid-cols-2">
                      {custom.map(item => (
                        <li key={item.id}>
                          <CustomCard
                            item={item} busy={busyIds.has(item.id)} running={runningId === item.id}
                            onToggle={next => void toggleCustom(item, next)} onRun={() => void runCustom(item)}
                            onRead={() => setPlan({ title: `${item.name}: what Alpha wrote`, text: item.last_result || '', cut: (item.last_result || '').length >= 495 })}
                            onEdit={() => setCustomSheet({ item })} onDelete={() => setDeleting(item)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}

            {tab === 'upcoming' && (
              <UpcomingPanel state={d.results.state} error={d.results.error} upcoming={d.results.value.upcoming} cards={cards} timezone={timezone} onRetry={() => void loadResults()} />
            )}
            {tab === 'history' && <HistoryPanel cards={cards} timezone={timezone} filter={filter} onFilter={setFilter} history={history} />}
            {tab === 'results' && (
              <ResultsPanel state={d.results.state} error={d.results.error} results={d.results.value.results} cards={cards} days={d.days} onDays={d.changeDays} onRetry={() => void loadResults()} />
            )}
          </div>
        </>
      ) : null}

      {preview && previewCard && rules && (
        <PreviewSheet
          key={`${previewCard.id}-${preview.mode}`}
          card={previewCard} mode={preview.mode} rules={rules} timezone={timezone}
          canTest={overview?.shop.sms_ready === true}
          onClose={() => setPreview(null)}
          onEnable={async () => {
            const out = await setEnabled(previewCard, true)
            if (out.error) return out.error
            notify(`${previewCard.name} is on.`, 'success')
            return ''
          }}
          onRun={() => runCard(previewCard)}
          onNote={notify}
          onEdit={() => { setPreview(null); setEditing(previewCard.id) }}
        />
      )}
      {editCard && <EditSheet key={editCard.id} card={editCard} onClose={() => setEditing(null)} onSave={saveSettings(editCard)} />}
      {showRules && rules && <RulesSheet rules={rules} onClose={() => setShowRules(false)} onSave={saveRules} />}
      {masterAsk && (
        <ConfirmSheet title="Switch off all automations?" confirmLabel="Switch all off" busyLabel="Switching off…" danger onClose={() => setMasterAsk(false)} onConfirm={() => switchMaster(false)}>
          <p>Nothing will be sent, and every message still waiting to go out is cancelled. Each automation remembers whether it was on, so switching all back on restores them.</p>
          <p className="text-text-secondary">Messages already sent cannot be taken back.</p>
        </ConfirmSheet>
      )}
      {customSheet && <CustomSheet key={customSheet.item?.id || 'new'} item={customSheet.item} onClose={() => setCustomSheet(null)} onSubmit={submitCustom(customSheet.item)} />}
      {deleting && (
        <ConfirmSheet title={`Delete ${deleting.name}?`} confirmLabel="Delete" busyLabel="Deleting…" danger onClose={() => setDeleting(null)} onConfirm={deleteCustom}>
          <p>It stops running, and the plans it wrote are gone. This cannot be undone.</p>
        </ConfirmSheet>
      )}
      {plan && <PlanSheet title={plan.title} text={plan.text} cut={plan.cut} onClose={() => setPlan(null)} />}

      <ScreenToast toast={toast} onClose={dismiss} />
    </div>
  )
}
