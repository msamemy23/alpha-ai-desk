'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { EmptyBlock, ErrorCard, Pill, RowsSkeleton } from '@/components/ListKit'
import Icon from '@/components/Icon'
import { Switch } from '@/components/ScreenParts'
import { describeMode } from '../../lib/browser/policy'
import type { ApiResult } from './api'
import { addBookmark, addRule, removeBookmark, removeRule, saveSettings } from './api'
import { addressText } from './address'
import { setupText } from './failure'
import {
  NAMED_CATEGORIES_NOTE, checkQuickSite, checkRuleInput, groupDefaultBlocked, quickSites, savedPages, sortRules,
} from './settings'
import type { BookmarkRow, SettingsPayload } from './settings'
import type { SettingsApi } from './useBrowserSettings'
import { useMounted } from './useMounted'

type Status = { kind: 'success' | 'error' | 'info'; text: string } | null

interface Runner {
  busy: string
  run: (key: string, work: () => Promise<ApiResult<unknown>>, okText: string, after?: () => void) => Promise<boolean>
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0" aria-label={title}>
      <div>
        <h3 className="section-title">{title}</h3>
        {hint && <p className="mt-0.5 text-[0.9375rem] text-text-secondary">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function ToggleRow({
  title, hint, checked, disabled, onChange,
}: { title: string; hint: string; checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-bold">{title}</p>
        <p className="text-[0.875rem] text-text-secondary">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="w-8 text-right text-[0.875rem] font-bold" aria-hidden="true">{checked ? 'On' : 'Off'}</span>
        <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
      </div>
    </div>
  )
}

/** A line in a list with a Remove button that asks once before it removes. */
function RemovableRow({
  title, sub, tag, canRemove, removeKey, busy, onRemove,
}: { title: string; sub?: string; tag?: string; canRemove: boolean; removeKey: string; busy: string; onRemove: () => void }) {
  const [asking, setAsking] = useState(false)
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words font-bold">{title} {tag && <Pill className="ml-1 align-middle">{tag}</Pill>}</p>
          {sub && <p className="break-all text-[0.875rem] text-text-secondary">{sub}</p>}
        </div>
        {canRemove && !asking && (
          <button type="button" className="btn btn-secondary btn-sm shrink-0" disabled={!!busy} onClick={() => setAsking(true)}>Remove</button>
        )}
      </div>
      {canRemove && asking && (
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={`Remove ${title}?`}>
          <span className="text-[0.9375rem] font-bold">Remove it?</span>
          <button type="button" className="btn btn-danger btn-sm" disabled={!!busy} onClick={() => { onRemove(); setAsking(false) }}>
            {busy === removeKey ? 'Removing…' : 'Yes, remove'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)}>Keep it</button>
        </div>
      )}
    </li>
  )
}

function RuleSection({
  kind, p, canManage, runner,
}: { kind: 'allow' | 'block'; p: SettingsPayload; canManage: boolean; runner: Runner }) {
  const [host, setHost] = useState('')
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState('')
  const rules = sortRules(p.rules, kind)
  const label = kind === 'allow' ? 'allow' : 'block'
  const off = p.missing.rules

  const add = async () => {
    const check = checkRuleInput(host, kind, p.rules)
    if (!check.ok) { setProblem(check.message); return }
    setProblem('')
    const moved = check.replaces ? ` It was moved from the ${check.replaces === 'allow' ? 'allow' : 'block'} list.` : ''
    await runner.run(`add-${kind}`, () => addRule(check.host, kind, note.trim().slice(0, 200)), `Added ${check.host} to the ${label} list.${moved}`, () => { setHost(''); setNote('') })
  }

  return (
    <Section
      title={kind === 'allow' ? 'Allow list' : 'Block list'}
      hint={kind === 'allow'
        ? 'Sites here can be opened even when Alpha blocks them by default. If your shop only opens listed sites, only these and your quick sites open.'
        : 'Sites here never open, for people or for Alpha.'}
    >
      {off && <Notice kind="info">{setupText('Saving site rules')} Sites are still checked against Alpha’s built-in block list.</Notice>}
      {rules.length === 0 ? (
        <EmptyBlock icon="shield" title={kind === 'allow' ? 'No sites on your allow list' : 'No sites on your block list'}>
          {canManage && !off ? `Add a site below to put it on the ${label} list.` : 'An owner or manager can add sites.'}
        </EmptyBlock>
      ) : (
        <ul className="ledger">
          {rules.map(r => (
            <RemovableRow
              key={r.id || r.host}
              title={r.host}
              sub={r.note || undefined}
              canRemove={canManage && !off && !!r.id}
              removeKey={`rm-${r.id}`}
              busy={runner.busy}
              onRemove={() => { void runner.run(`rm-${r.id}`, () => removeRule(r.id), `Removed ${r.host} from the ${label} list.`) }}
            />
          ))}
        </ul>
      )}
      {canManage && !off && (
        <form className="space-y-2" onSubmit={e => { e.preventDefault(); void add() }}>
          <div>
            <label className="form-label" htmlFor={`rule-${kind}-host`}>Site name</label>
            <input
              id={`rule-${kind}-host`}
              className="form-input"
              value={host}
              onChange={e => { setHost(e.target.value); if (problem) setProblem('') }}
              placeholder="example.com"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `rule-${kind}-problem` : undefined}
            />
            {problem && <p id={`rule-${kind}-problem`} className="form-error" role="alert">{problem}</p>}
          </div>
          <div>
            <label className="form-label" htmlFor={`rule-${kind}-note`}>Note (optional)</label>
            <input id={`rule-${kind}-note`} className="form-input" value={note} maxLength={200} onChange={e => setNote(e.target.value)} placeholder="Why this site is on the list" />
          </div>
          <button type="submit" className="btn btn-secondary w-full sm:w-auto" disabled={!!runner.busy}>
            {runner.busy === `add-${kind}` ? 'Adding…' : `Add to ${label} list`}
          </button>
        </form>
      )}
    </Section>
  )
}

function QuickSection({
  p, canManage, runner,
}: { p: SettingsPayload; canManage: boolean; runner: Runner }) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [problem, setProblem] = useState('')
  const quick = quickSites(p)
  const saved = savedPages(p)
  const off = p.missing.bookmarks

  const add = async () => {
    const check = checkQuickSite(name, address)
    if (!check.ok) { setProblem(check.message); return }
    setProblem('')
    await runner.run('add-quick', () => addBookmark({ title: check.title, url: check.url, kind: 'quick' }), `Added ${check.title} to your quick sites.`, () => { setName(''); setAddress('') })
  }

  const rowOf = (b: BookmarkRow) => (
    <RemovableRow
      key={b.id || b.url}
      title={b.title}
      sub={addressText(b.url)}
      tag={b.builtin ? 'Built in' : undefined}
      canRemove={canManage && !off && !b.builtin && !!b.id}
      removeKey={`rm-${b.id}`}
      busy={runner.busy}
      onRemove={() => { void runner.run(`rm-${b.id}`, () => removeBookmark(b.id), `Removed ${b.title}.`) }}
    />
  )

  return (
    <>
      <Section title="Quick sites" hint="These show on the start page of every new tab. Built-in sites cannot be removed.">
        {off && <Notice kind="info">{setupText('Saving your own quick sites')} The built-in sites still work.</Notice>}
        {quick.length === 0
          ? <EmptyBlock icon="globe" title="No quick sites yet">{canManage && !off ? 'Add one below.' : 'An owner or manager can add them.'}</EmptyBlock>
          : <ul className="ledger">{quick.map(rowOf)}</ul>}
        {canManage && !off && (
          <form className="space-y-2" onSubmit={e => { e.preventDefault(); void add() }}>
            <div>
              <label className="form-label" htmlFor="quick-name">Name (optional)</label>
              <input id="quick-name" className="form-input" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Parts supplier" />
            </div>
            <div>
              <label className="form-label" htmlFor="quick-address">Web address</label>
              <input
                id="quick-address"
                className="form-input"
                value={address}
                onChange={e => { setAddress(e.target.value); if (problem) setProblem('') }}
                placeholder="example.com"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? 'quick-problem' : undefined}
              />
              {problem && <p id="quick-problem" className="form-error" role="alert">{problem}</p>}
            </div>
            <button type="submit" className="btn btn-secondary w-full sm:w-auto" disabled={!!runner.busy}>
              {runner.busy === 'add-quick' ? 'Adding…' : 'Add quick site'}
            </button>
          </form>
        )}
      </Section>
      {saved.length > 0 && (
        <Section title="Saved pages" hint="Pages you saved from the Browser.">
          <ul className="ledger">{saved.map(rowOf)}</ul>
        </Section>
      )}
    </>
  )
}

function SettingsBody({ settings, canManage }: { settings: SettingsApi; canManage: boolean }) {
  const mounted = useMounted()
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState<Status>(null)
  const p = settings.payload

  const runner: Runner = {
    busy,
    run: async (key, work, okText, after) => {
      if (busy) return false
      setBusy(key)
      setStatus(null)
      try {
        const r = await work()
        if (!mounted.current) return false
        if (r.ok) {
          setStatus({ kind: 'success', text: okText })
          after?.()
          settings.reload()
          return true
        }
        if (!r.aborted) setStatus({ kind: 'error', text: r.failure.message })
        return false
      } catch {
        if (mounted.current) setStatus({ kind: 'error', text: 'That did not work. Try again in a moment.' })
        return false
      } finally {
        if (mounted.current) setBusy('')
      }
    },
  }

  if (!p) {
    return settings.status === 'error'
      ? <ErrorCard title="Settings could not be loaded" message={settings.error || 'That did not work. Try again in a moment.'} onRetry={settings.reload} />
      : <RowsSkeleton rows={4} label="Loading settings" />
  }

  const change = (patch: { mode?: 'open' | 'allowlist'; aiEnabled?: boolean; readerImages?: boolean }, okText: string) => {
    void runner.run('settings', () => saveSettings(patch), okText, () => settings.patch(patch))
  }
  const lockedSettings = !canManage || p.missing.settings || !!busy
  const groups = groupDefaultBlocked(p.defaultBlocked)

  return (
    <div className="space-y-5">
      {settings.status === 'error' && (
        <Notice kind="warn">
          <p>The latest settings could not be loaded. This may be out of date.</p>
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={settings.reload}>Try again</button>
        </Notice>
      )}
      {!canManage && <Notice kind="info">Only an owner, admin or manager can change these settings. You can see how they are set.</Notice>}
      {status && <Notice kind={status.kind}>{status.text}</Notice>}

      <Section title="Alpha in the Browser">
        {p.missing.settings && <Notice kind="info">{setupText('Saving these settings')} Until then the standard settings apply.</Notice>}
        <ToggleRow
          title="Let Alpha look things up"
          hint="When this is off, Alpha cannot open pages or take steps. Reading, searching and Live view still work for you."
          checked={p.settings.aiEnabled}
          disabled={lockedSettings}
          onChange={next => change({ aiEnabled: next }, next ? 'Alpha can look things up in the Browser.' : 'Alpha is switched off in the Browser.')}
        />
      </Section>

      <Section title="Which sites can be opened">
        {canManage && !p.missing.settings ? (
          <div role="radiogroup" aria-label="Which sites can be opened" className="grid gap-2 sm:grid-cols-2">
            {(['open', 'allowlist'] as const).map(key => {
              const on = p.settings.mode === key
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!!busy}
                  onClick={() => { if (!on) change({ mode: key }, key === 'open' ? 'Any public site can be opened, except blocked ones.' : 'Only sites on your allow list and quick sites can be opened.') }}
                  className={`flex min-h-[44px] items-center gap-2 rounded-md border px-3 py-2 text-left text-[0.9375rem] font-bold disabled:opacity-60 ${on ? 'border-blue bg-blue/10 text-blue' : 'border-[rgb(var(--c-line))] bg-bg-card text-text-primary hover:bg-bg-hover'}`}
                >
                  {on && <Icon name="check" className="h-4 w-4 shrink-0" strokeWidth={2.4} />}
                  {describeMode(key)}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-[0.9375rem]"><span className="font-bold">Now:</span> {describeMode(p.settings.mode)}</p>
        )}
        <ToggleRow
          title="Show pictures in Reader view"
          hint="Pictures load through Alpha, never straight from the website."
          checked={p.settings.readerImages}
          disabled={lockedSettings}
          onChange={next => change({ readerImages: next }, next ? 'Pictures show in Reader view.' : 'Pictures are hidden in Reader view.')}
        />
      </Section>

      <RuleSection kind="allow" p={p} canManage={canManage} runner={runner} />
      <RuleSection kind="block" p={p} canManage={canManage} runner={runner} />

      <Section title="Sites Alpha blocks by default" hint="You cannot change this list. A site on your allow list can still be opened. Alpha never types passwords or card numbers on any site.">
        {groups.length === 0 ? (
          <p className="text-[0.9375rem] text-text-secondary">The built-in list could not be shown. It still applies.</p>
        ) : (
          <details>
            <summary className="flex min-h-[44px] cursor-pointer items-center font-bold text-blue">Show the list ({p.defaultBlocked.length} sites)</summary>
            <div className="mt-2 space-y-3">
              {groups.map(g => (
                <div key={g.why}>
                  <p className="font-bold">{g.why}</p>
                  <p className="break-words text-[0.9375rem] text-text-secondary">{g.hosts.join(', ')}</p>
                </div>
              ))}
              <p className="text-[0.9375rem] text-text-secondary">{NAMED_CATEGORIES_NOTE}</p>
            </div>
          </details>
        )}
      </Section>

      <QuickSection p={p} canManage={canManage} runner={runner} />
    </div>
  )
}

/** The shop's browser settings: Alpha on or off, which sites open, the allow and block lists and the quick sites. */
export default function SettingsSheet({
  open, onClose, settings, canManage,
}: { open: boolean; onClose: () => void; settings: SettingsApi; canManage: boolean }) {
  return (
    <Sheet open={open} onClose={onClose} title="Browser settings" wide>
      <SettingsBody settings={settings} canManage={canManage} />
    </Sheet>
  )
}
