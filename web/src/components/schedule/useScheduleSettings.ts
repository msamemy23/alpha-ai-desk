'use client'
import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_CAPACITY } from '@/lib/schedule-capacity'
import type { CapacitySettings } from '@/lib/schedule-capacity'
import { DEFAULT_ONLINE } from '@/lib/booking'
import type { OnlineSettings } from '@/lib/booking'
import { DEFAULT_BOARD } from '@/lib/jobflow'
import type { BoardSettings } from '@/lib/jobflow'

export interface ScheduleSettingsState {
  capacity: CapacitySettings
  online: OnlineSettings
  board: BoardSettings
  /** False until the database update (migration 050) is applied: settings can be read as defaults but not saved. */
  migrated: boolean
  canChange: boolean
  timezone: string | null
  icalToken: string | null
  icalOn: boolean
}

export type SavePatch = { capacity?: CapacitySettings; online?: OnlineSettings; board?: BoardSettings; ical?: 'on' | 'off' | 'reset' }

const INITIAL: ScheduleSettingsState = { capacity: DEFAULT_CAPACITY, online: DEFAULT_ONLINE, board: DEFAULT_BOARD, migrated: false, canChange: false, timezone: null, icalToken: null, icalOn: false }

/** The shop's scheduling settings: hours, capacity, service times, online booking, the calendar feed. */
export function useScheduleSettings() {
  const [state, setState] = useState<ScheduleSettingsState>(INITIAL)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const apply = (d: Record<string, unknown>) => setState(s => ({
    capacity: (d.capacity as CapacitySettings) || s.capacity,
    online: (d.online as OnlineSettings) || s.online,
    board: (d.board as BoardSettings) || s.board,
    migrated: d.migrated === true,
    canChange: d.canChange === true,
    timezone: typeof d.timezone === 'string' ? d.timezone : s.timezone,
    icalToken: typeof d.icalToken === 'string' ? d.icalToken : null,
    icalOn: d.icalOn === true,
  }))

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/schedule/settings', { cache: 'no-store' })
      const d = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok || d.ok !== true) { setError('The schedule settings did not load.'); return }
      apply(d)
      setError('')
    } catch {
      setError('The schedule settings did not load. Check your connection.')
    } finally { setLoaded(true) }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async (patch: SavePatch): Promise<{ ok: boolean; error?: string; needsUpdate?: boolean }> => {
    try {
      const res = await fetch('/api/schedule/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      const d = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok || d.ok !== true) {
        return { ok: false, needsUpdate: d.migrated === false, error: typeof d.error === 'string' ? d.error : res.status === 403 ? 'Only owners, admins and managers can change these settings.' : 'That did not save. Try again.' }
      }
      setState(s => ({ ...s, capacity: (d.capacity as CapacitySettings) || s.capacity, online: (d.online as OnlineSettings) || s.online, board: (d.board as BoardSettings) || s.board, migrated: true, icalToken: typeof d.icalToken === 'string' ? d.icalToken : null, icalOn: d.icalOn === true }))
      return { ok: true }
    } catch {
      return { ok: false, error: 'No connection. Check your internet and try again.' }
    }
  }, [])

  return { settings: state, loaded, error, reload: load, save }
}
