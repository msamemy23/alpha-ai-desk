/** What the shop tablet route sends and the tablet screen reads. No imports, so both sides share it. */
export type KioskState = 'in' | 'break' | 'out'

export interface KioskPerson {
  id: number
  name: string
  role: string
  state: KioskState
  /** When the current state began: the clock-in, or the start of the break. */
  since: string | null
  job: { label: string; started_at: string } | null
  /** A clock-in from an earlier day that was never closed. The tablet sends the person to a manager. */
  needs_fix: boolean
  /** A clock-out from the last 15 minutes, which the person can take back. */
  can_undo: boolean
  has_pin: boolean
}

export interface KioskJob { id: string; ro: string; customer: string; car: string }

export interface KioskRoster {
  ok: true
  now: string
  shopName: string
  requirePin: boolean
  locationMode: 'off' | 'record' | 'require'
  pinsAvailable: boolean
  people: KioskPerson[]
  jobs: KioskJob[]
}
