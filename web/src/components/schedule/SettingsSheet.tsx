'use client'
import { useMemo, useState } from 'react'
import Notice from '@/components/Notice'
import { FilterChips } from '@/components/ListKit'
import { cleanCapacity } from '@/lib/schedule-capacity'
import type { CapacitySettings } from '@/lib/schedule-capacity'
import { cleanOnline } from '@/lib/booking'
import type { OnlineSettings } from '@/lib/booking'
import { CapacityTab, FeedTab, HoursTab, OnlineTab, ServicesTab } from './SettingsParts'
import type { SavePatch, ScheduleSettingsState } from './useScheduleSettings'

type Tab = 'hours' | 'capacity' | 'services' | 'online' | 'feed'

/**
 * Everything about how the shop books: hours, how much fits, service times, the public booking page and the calendar link.
 * Edits are held until Save, so a half-finished change never reaches customers.
 */
export default function SettingsSheet({ settings, save, onSaved, onClose }: {
  settings: ScheduleSettingsState
  save: (patch: SavePatch) => Promise<{ ok: boolean; error?: string; needsUpdate?: boolean }>
  onSaved: (message: string) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('hours')
  const [cap, setCap] = useState<CapacitySettings>(settings.capacity)
  const [online, setOnline] = useState<OnlineSettings>(settings.online)
  const [busy, setBusy] = useState(false)
  const [feedBusy, setFeedBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const dirty = useMemo(() => JSON.stringify(cap) !== JSON.stringify(settings.capacity) || JSON.stringify(online) !== JSON.stringify(settings.online), [cap, online, settings.capacity, settings.online])
  const blank = cap.services.some(s => !s.label.trim())

  const submit = async () => {
    setProblem('')
    setBusy(true)
    const cleaned = cleanCapacity(cap)
    const r = await save({ capacity: cleaned, online: cleanOnline(online) })
    setBusy(false)
    if (!r.ok) { setProblem(r.error || 'That did not save. Try again.'); return }
    onSaved(online.enabled ? 'Settings saved. Your booking page is on.' : 'Settings saved.')
  }

  const feed = async (a: 'on' | 'off' | 'reset') => {
    setProblem(''); setFeedBusy(true)
    const r = await save({ ical: a })
    setFeedBusy(false)
    if (!r.ok) setProblem(r.error || 'That did not save. Try again.')
  }

  return (
    <div>
      {!settings.migrated && <Notice kind="warn" className="mb-3">These settings need a database update before they can be saved. You can look around, and the shop works as it did before.</Notice>}
      {!settings.canChange && <Notice kind="info" className="mb-3">Only owners, admins and managers can change these settings.</Notice>}
      <div className="mb-4">
        <FilterChips scroll label="Settings section" value={tab} onChange={setTab} options={[
          { key: 'hours', label: 'Hours' }, { key: 'capacity', label: 'Capacity' }, { key: 'services', label: 'Services' },
          { key: 'online', label: 'Online booking' }, { key: 'feed', label: 'Calendar link' },
        ]} />
      </div>

      <fieldset disabled={!settings.canChange || !settings.migrated} className="min-w-0 border-0 p-0">
        {tab === 'hours' && <HoursTab cap={cap} setCap={setCap} />}
        {tab === 'capacity' && <CapacityTab cap={cap} setCap={setCap} />}
        {tab === 'services' && <ServicesTab cap={cap} setCap={setCap} />}
        {tab === 'online' && <OnlineTab cap={cap} online={online} setOnline={setOnline} origin={origin} canTurnOn={settings.migrated && settings.canChange} />}
      </fieldset>
      {tab === 'feed' && <FeedTab icalOn={settings.icalOn} token={settings.icalToken} origin={origin} canChange={settings.canChange && settings.migrated} busy={feedBusy} onChange={a => void feed(a)} />}

      {blank && tab === 'services' && <p className="mt-2 text-[0.875rem] text-text-secondary">A service with no name is left out when you save.</p>}
      {problem && <p role="alert" className="form-error">{problem}</p>}
      {tab !== 'feed' && (
        <div className="sticky bottom-0 -mx-4 mt-5 grid grid-cols-2 gap-2 border-t border-border bg-bg-card px-4 py-3 sm:-mx-6 sm:px-6">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{dirty ? 'Discard' : 'Close'}</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !dirty || !settings.canChange || !settings.migrated}>{busy ? 'Saving…' : 'Save settings'}</button>
        </div>
      )}
    </div>
  )
}
