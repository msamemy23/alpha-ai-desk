'use client'
import Link from 'next/link'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { describeResult } from '@/lib/automation-text'
import { copyFor } from './copy'
import { ago, cadence, Fact, OnOff, plural, Status } from './parts'
import type { Lamp, SystemAutomation } from './types'

interface Props {
  auto: SystemAutomation
  busy: boolean
  running: boolean
  onToggle: (next: boolean) => void
  onRun: () => void
  onView: () => void
  onSettings: () => void
}

export default function SystemCard({ auto, busy, running, onToggle, onRun, onView, onSettings }: Props) {
  const c = copyFor(auto.id, auto.name)
  const s = auto.state
  const unavailable = c.kind === 'unavailable'
  const result = describeResult(auto.id, s.last_result, s.last_status)
  const lamp: Lamp = s.last_status === 'ok' ? (result?.tone === 'warn' ? 'amber' : 'green') : s.last_status === 'error' ? 'red' : 'off'
  const status = s.last_status === 'never'
    ? 'Has not run yet'
    : `${s.last_status === 'ok' ? 'Last run worked' : 'Last run failed'}, ${ago(s.last_run)}`
  const noCity = auto.id === 'lead_discovery' && !String(s.config.city || '').trim()

  return (
    <article className="card h-full">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-bg-hover text-text-secondary">
          <Icon name={c.icon} className="h-5 w-5" />
        </span>
        <h3 className="min-w-0 flex-1 font-bold leading-tight">{c.name}</h3>
        <OnOff enabled={s.enabled} name={`${c.name} on or paused`} onChange={onToggle} disabled={busy || running || (unavailable && !s.enabled)} />
      </div>
      <p className="mt-2 text-[0.9375rem] text-text-secondary">{c.does}</p>

      <div className="mt-3 space-y-1 text-[0.9375rem]">
        {!unavailable && <Fact icon="user">{c.who}</Fact>}
        {!unavailable && <Fact icon="clock">{cadence(auto.schedule)}</Fact>}
        {!unavailable && (
          <>
            <Status lamp={lamp}>{status}</Status>
            {result && s.last_status !== 'never' && <p className="pl-5 text-text-secondary">{result.text}{s.run_count > 0 ? ` ${plural(s.run_count, 'run', 'runs')} so far.` : ''}</p>}
          </>
        )}
      </div>

      {auto.requires && auto.requires.length > 0 && (
        <Notice kind="warn" className="mt-3">Needs an account connected first. <Link href="/connectors" className="font-bold text-blue underline underline-offset-2">Open connected apps</Link></Notice>
      )}
      {noCity && (
        <Notice kind="warn" className="mt-3">No city is set, so this searches Houston. Open Settings to pick your city.</Notice>
      )}
      {s.last_status === 'error' && result?.tone === 'error' && (
        <Notice kind="error" className="mt-3"><span className="font-bold">What went wrong: </span>{result.text}</Notice>
      )}
      {unavailable && s.enabled && (
        <Notice kind="warn" className="mt-3">This is switched on but cannot do anything yet. Switch it off.</Notice>
      )}

      {!unavailable && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={onRun} disabled={running || busy} aria-label={`Run now: ${c.name}`}>
            <Icon name="play" className="h-4 w-4" />
            {running ? 'Running…' : 'Run now'}
          </button>
          {c.contacts && (
            <button type="button" className="btn btn-ghost" onClick={onView} aria-label={`What it sends: ${c.name}`}>
              <Icon name="eye" className="h-5 w-5" />
              What it sends
            </button>
          )}
          {c.fields.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={onSettings} aria-label={`Settings: ${c.name}`}>
              <Icon name="settings" className="h-5 w-5" />
              Settings
            </button>
          )}
        </div>
      )}
    </article>
  )
}
