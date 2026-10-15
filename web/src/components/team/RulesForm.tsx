'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { dayLabel } from '@/lib/timeclock'
import {
  PRESETS, US_STATES, WEEKDAY_NAMES, describeRules, periodLabel, periodStartFor, presetForState, presetKeyOf, weekStartFor,
} from '@/lib/timerules'
import type { LocationMode, TimeRules } from '@/lib/timerules'
import { distanceWords } from '@/lib/geo'
import { readDeviceFix } from './geoClient'

const LOCATION_MODES: { value: LocationMode; label: string; help: string }[] = [
  { value: 'off', label: 'Do not check', help: 'People can clock in from anywhere.' },
  { value: 'record', label: 'Note it on the punch', help: 'Clock-ins always work. Each one shows if it was at the shop, away from it, or unknown.' },
  { value: 'require', label: 'Only at the shop', help: 'A clock-in from outside the shop area is refused. A device that will not share its location is refused too.' },
]

const hoursText = (m: number | null): string => (m === null ? '' : String(m / 60))
const toMinutes = (t: string): number | null => {
  const n = Number(t.replace(',', '.'))
  return t.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 60) : null
}

/** The shop's pay week, overtime lines, two-week option, clock-in location and tablet PIN rule. Only owners and admins save it. */
export default function RulesForm({ rules, canChange, busy, error, todayKey, onSave, onCancel, onDirty }: {
  rules: TimeRules
  canChange: boolean
  busy: boolean
  error: string
  todayKey: string
  onSave: (r: TimeRules) => void
  onCancel: () => void
  onDirty?: () => void
}) {
  const [state, setState] = useState(rules.state)
  const [weekStart, setWeekStart] = useState(rules.weekStart)
  const [periodDays, setPeriodDays] = useState<7 | 14>(rules.periodDays)
  const [anchor, setAnchor] = useState(rules.periodAnchor)
  const [weekly, setWeekly] = useState(hoursText(rules.weeklyOtMin))
  const [daily, setDaily] = useState(hoursText(rules.dailyOtMin))
  const [dbl, setDbl] = useState(hoursText(rules.dailyDoubleMin))
  const [mode, setMode] = useState<LocationMode>(rules.locationMode)
  const [lat, setLat] = useState(rules.geofence ? String(rules.geofence.lat) : '')
  const [lng, setLng] = useState(rules.geofence ? String(rules.geofence.lng) : '')
  const [radius, setRadius] = useState(String(rules.geofence ? rules.geofence.radiusM : 200))
  const [requirePin, setRequirePin] = useState(rules.requirePin)
  const [shown, setShown] = useState('')
  const [locating, setLocating] = useState(false)
  const [locNote, setLocNote] = useState('')

  const touch = () => { setShown(''); onDirty?.() }

  const weeklyMin = weekly.trim() === '' ? null : toMinutes(weekly)
  const dailyMin = daily.trim() === '' ? null : toMinutes(daily)
  const dblMin = dbl.trim() === '' ? null : toMinutes(dbl)
  const presetKey = presetKeyOf({ weeklyOtMin: weeklyMin, dailyOtMin: dailyMin, dailyDoubleMin: dblMin })

  const applyPreset = (key: string) => {
    const p = PRESETS.find(x => x.key === key)
    if (!p) return
    setWeekly(hoursText(p.weeklyOtMin)); setDaily(hoursText(p.dailyOtMin)); setDbl(hoursText(p.dailyDoubleMin))
    touch()
  }

  const pickState = (code: string) => {
    setState(code)
    if (code) applyPreset(presetForState(code).key)
    touch()
  }

  const pickThisDevice = async () => {
    setLocating(true); setLocNote('')
    const r = await readDeviceFix()
    setLocating(false)
    if (!r.fix) { setLocNote(r.problem); return }
    setLat(r.fix.lat.toFixed(6)); setLng(r.fix.lng.toFixed(6))
    setLocNote(`Saved from this device. Its location is accurate to about ${Math.round(r.fix.accuracy)} m.`)
    touch()
  }

  // The first pay period that will be used, so the owner can see what the choices mean before saving.
  const preview = useMemo(() => {
    if (!todayKey) return ''
    const draft = { weekStart, periodDays, periodAnchor: anchor }
    const start = periodStartFor(todayKey, draft)
    return periodLabel(start, periodDays)
  }, [todayKey, weekStart, periodDays, anchor])

  const build = (): TimeRules | string => {
    if (weekly.trim() !== '' && weeklyMin === null) return 'Enter the hours before weekly overtime as a number, or leave it empty for none.'
    if (daily.trim() !== '' && dailyMin === null) return 'Enter the hours before daily overtime as a number, or leave it empty for none.'
    if (dbl.trim() !== '' && dblMin === null) return 'Enter the hours before double time as a number, or leave it empty for none.'
    if (dblMin !== null && (dailyMin === null || dblMin <= dailyMin)) return 'Double time has to start after daily overtime does.'
    if (periodDays === 14 && !anchor) return 'Pick the first day of a pay period, so two-week periods can be counted from it.'
    let geofence: TimeRules['geofence'] = null
    if (mode !== 'off') {
      const la = Number(lat), ln = Number(lng), r = Number(radius)
      if (lat.trim() === '' || lng.trim() === '' || !Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return 'Set where the shop is: use this device while you are at the shop, or enter the latitude and longitude.'
      if (!Number.isFinite(r) || r < 30 || r > 5000) return 'Enter a shop area radius between 30 and 5,000 meters.'
      geofence = { lat: la, lng: ln, radiusM: Math.round(r) }
    } else if (lat.trim() !== '' && lng.trim() !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      geofence = { lat: Number(lat), lng: Number(lng), radiusM: Math.min(5000, Math.max(30, Math.round(Number(radius)) || 200)) }
    }
    return { weekStart, periodDays, periodAnchor: anchor, weeklyOtMin: weeklyMin, dailyOtMin: dailyMin, dailyDoubleMin: dblMin, state, locationMode: mode, geofence, requirePin }
  }

  const submit = () => {
    const r = build()
    if (typeof r === 'string') { setShown(r); return }
    setShown('')
    onSave(r)
  }

  const off = !canChange
  const message = shown || error
  const anchorStart = anchor ? weekStartFor(anchor, { weekStart }) : ''

  return (
    <form onSubmit={e => { e.preventDefault(); submit() }} className="space-y-6" noValidate>
      {off && <p className="rounded-md border border-border bg-bg-base px-3 py-2.5 text-[0.9375rem] text-text-secondary">Only an owner or admin can change these. You can see how time is counted.</p>}

      <fieldset className="space-y-3" disabled={off}>
        <legend className="section-title">Overtime</legend>
        <p className="text-[0.875rem] text-text-secondary">Pick your state to start from its usual rule, then adjust. This is a starting point, not legal advice: check your own state and any union or contract rules.</p>
        <div>
          <label htmlFor="rf-state" className="form-label">State</label>
          <select id="rf-state" className="form-select" value={state} onChange={e => pickState(e.target.value)}>
            <option value="">Not chosen</option>
            {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </div>
        <div role="radiogroup" aria-label="Overtime rule" className="space-y-2">
          {PRESETS.map(p => (
            <label key={p.key} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 ${presetKey === p.key ? 'border-blue bg-blue/[0.06]' : 'border-border bg-bg-card'}`}>
              <input type="radio" name="rf-preset" className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={presetKey === p.key} onChange={() => applyPreset(p.key)} />
              <span className="min-w-0">
                <span className="block font-bold">{p.label}</span>
                <span className="block text-[0.875rem] text-text-secondary">{p.note}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="rf-weekly" className="form-label">Weekly overtime after (hours)</label>
            <input id="rf-weekly" className="form-input" inputMode="decimal" value={weekly} onChange={e => { setWeekly(e.target.value); touch() }} placeholder="None" />
          </div>
          <div>
            <label htmlFor="rf-daily" className="form-label">Daily overtime after (hours)</label>
            <input id="rf-daily" className="form-input" inputMode="decimal" value={daily} onChange={e => { setDaily(e.target.value); touch() }} placeholder="None" />
          </div>
          <div>
            <label htmlFor="rf-dbl" className="form-label">Double time after (hours)</label>
            <input id="rf-dbl" className="form-input" inputMode="decimal" value={dbl} onChange={e => { setDbl(e.target.value); touch() }} placeholder="None" />
          </div>
        </div>
        <p className="text-[0.875rem] text-text-secondary" aria-live="polite">{describeRules({ weeklyOtMin: weeklyMin, dailyOtMin: dailyMin, dailyDoubleMin: dblMin })}</p>
      </fieldset>

      <fieldset className="space-y-3" disabled={off}>
        <legend className="section-title">Pay week and pay period</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="rf-ws" className="form-label">The pay week starts on</label>
            <select id="rf-ws" className="form-select" value={weekStart} onChange={e => { setWeekStart(Number(e.target.value)); touch() }}>
              {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rf-pd" className="form-label">How often you pay</label>
            <select id="rf-pd" className="form-select" value={periodDays} onChange={e => { setPeriodDays(Number(e.target.value) === 14 ? 14 : 7); touch() }}>
              <option value={7}>Every week</option>
              <option value={14}>Every two weeks</option>
            </select>
          </div>
        </div>
        {periodDays === 14 && (
          <div>
            <label htmlFor="rf-anchor" className="form-label">The first day of any one pay period</label>
            <input id="rf-anchor" type="date" className="form-input sm:max-w-[16rem]" value={anchor} onChange={e => { setAnchor(e.target.value); touch() }} />
            <p className="mt-1 text-[0.875rem] text-text-secondary">
              Pick the first day of a recent pay period. Two-week periods are counted from it{anchorStart && anchorStart !== anchor ? `, starting ${dayLabel(anchorStart)}` : ''}.
            </p>
          </div>
        )}
        {preview && <p className="num text-[0.9375rem]"><span className="text-text-secondary">The current pay period is </span><strong>{preview}</strong>.</p>}
        <p className="text-[0.875rem] text-text-secondary">Overtime is always worked out one pay week at a time, even when you pay every two weeks.</p>
      </fieldset>

      <fieldset className="space-y-3" disabled={off}>
        <legend className="section-title">Where people can clock in</legend>
        <div role="radiogroup" aria-label="Clock-in location check" className="space-y-2">
          {LOCATION_MODES.map(m => (
            <label key={m.value} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 ${mode === m.value ? 'border-blue bg-blue/[0.06]' : 'border-border bg-bg-card'}`}>
              <input type="radio" name="rf-loc" className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={mode === m.value} onChange={() => { setMode(m.value); touch() }} />
              <span className="min-w-0"><span className="block font-bold">{m.label}</span><span className="block text-[0.875rem] text-text-secondary">{m.help}</span></span>
            </label>
          ))}
        </div>
        {mode !== 'off' && (
          <div className="space-y-3 rounded-md border border-border bg-bg-base p-3">
            <p className="text-[0.875rem] text-text-secondary">The device&apos;s location is read once, when a person clocks in, and checked on our server. Only inside, outside or unknown and the distance are kept, never the exact spot. Phone and tablet locations can be off by a block or more indoors, so keep the area generous.</p>
            <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={() => void pickThisDevice()} disabled={locating || off}>
              <Icon name="map" className="h-5 w-5" />{locating ? 'Finding this device…' : 'Use this device as the shop spot'}
            </button>
            {locNote && <p role="status" className="text-[0.875rem]">{locNote}</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label htmlFor="rf-lat" className="form-label">Latitude</label><input id="rf-lat" className="form-input" inputMode="decimal" value={lat} onChange={e => { setLat(e.target.value); touch() }} /></div>
              <div><label htmlFor="rf-lng" className="form-label">Longitude</label><input id="rf-lng" className="form-input" inputMode="decimal" value={lng} onChange={e => { setLng(e.target.value); touch() }} /></div>
              <div>
                <label htmlFor="rf-rad" className="form-label">Shop area radius (meters)</label>
                <input id="rf-rad" className="form-input" inputMode="numeric" value={radius} onChange={e => { setRadius(e.target.value); touch() }} />
                <p className="mt-1 text-[0.8125rem] text-text-secondary">{Number(radius) > 0 ? distanceWords(Number(radius)) : ''} from the spot.</p>
              </div>
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2" disabled={off}>
        <legend className="section-title">Shop tablet</legend>
        <label className="flex min-h-[44px] cursor-pointer items-start gap-3 text-[0.9375rem]">
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={requirePin} onChange={e => { setRequirePin(e.target.checked); touch() }} />
          <span><span className="block font-bold">Ask for a PIN on the shop tablet</span><span className="block text-[0.875rem] text-text-secondary">Each person sets or gets a PIN in Team, People. Without PINs, anyone at the tablet can clock anyone in.</span></span>
        </label>
      </fieldset>

      {message && <p role="alert" className="form-error">{message}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>{off ? 'Close' : 'Cancel'}</button>
        {!off && <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save pay rules'}</button>}
      </div>
      {!off && <p className="text-[0.8125rem] text-text-secondary">Changing the rules changes how hours are counted from now on, including hours already on the clock this period. Approved periods keep the hours they were approved with.</p>}
    </form>
  )
}
