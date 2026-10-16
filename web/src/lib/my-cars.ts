/**
 * "My cars": the part of the shop board that belongs to one technician.
 *
 * A technician picks their own name once on their phone and from then on sees only their cars, in the order they should
 * be worked. Nothing here is a lock. The choice only decides which cars are shown; everyone signed in to the shop can still
 * see every car on the Shop board, and this file never decides who may do what.
 *
 * The only import is a sibling with no imports of its own, so this runs the same in the browser and under `node --test`.
 */
import { normName } from './shopboard.ts'

/** Where the browser keeps "this phone belongs to <person>". The person's id, nothing else. */
export const MY_CARS_KEY = 'alpha-desk:my-cars:person'

export type MyGroupKey = 'working' | 'next' | 'waiting' | 'ready'

export interface MyGroup {
  key: MyGroupKey
  title: string
  /** One plain line for a group with nothing in it. */
  empty: string
}

/** In the order a technician reads them: what they are on now, what is next, what is stuck, what is finished. */
export const MY_GROUPS: MyGroup[] = [
  { key: 'working', title: 'Working on now', empty: 'Nothing in progress.' },
  { key: 'next', title: 'Up next', empty: 'Nothing is waiting for you to start.' },
  { key: 'waiting', title: 'Waiting on something', empty: 'Nothing is stuck.' },
  { key: 'ready', title: 'Done, waiting for pickup', empty: 'Nothing is waiting for its owner.' },
]

/** Which group a job stage goes in. A paid or closed job is not on anyone's list. */
export function groupKeyOf(stage: string): MyGroupKey | null {
  switch (stage) {
    case 'working': return 'working'
    case 'new':
    case 'approved': return 'next'
    case 'waiting': return 'waiting'
    case 'ready': return 'ready'
    default: return null
  }
}

export interface MyCars<T> {
  groups: Record<MyGroupKey, T[]>
  /** Every car on the list, finished ones included. */
  total: number
  /** Cars someone still has to work on: everything except the finished ones. */
  active: number
}

/**
 * The cars that carry this technician's name, split into groups. Names are matched ignoring capitals and extra spaces,
 * as the board does, because jobs keep the technician's name as plain text.
 * `stageOf` turns a status into a stage key ("working", "ready" and so on) and `order` sorts each group.
 */
export function splitMine<T extends { tech?: string | null; status: string }>(
  jobs: T[],
  name: string,
  stageOf: (status: string) => string,
  order?: (a: T, b: T) => number,
): MyCars<T> {
  const groups: Record<MyGroupKey, T[]> = { working: [], next: [], waiting: [], ready: [] }
  const me = normName(name)
  if (me) {
    for (const j of jobs) {
      if (normName(j.tech) !== me) continue
      const key = groupKeyOf(stageOf(j.status))
      if (key) groups[key].push(j)
    }
  }
  if (order) for (const k of Object.keys(groups) as MyGroupKey[]) groups[k].sort(order)
  const total = groups.working.length + groups.next.length + groups.waiting.length + groups.ready.length
  return { groups, total, active: total - groups.ready.length }
}

/** "1 car", "3 cars". */
export const carsWord = (n: number): string => `${n} ${n === 1 ? 'car' : 'cars'}`

/** The line under the page title: "3 cars to work on, 1 late". */
export function summaryLine(active: number, late: number): string {
  if (active === 0) return 'Nothing on your list right now'
  return `${carsWord(active)} to work on${late > 0 ? `, ${late} late` : ''}`
}

/* ---------- remembering who this phone belongs to ---------- */

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Browsers can refuse storage (private windows, blocked site data), so every read and write is guarded. */
export function readSaved(store: Store | null | undefined): string | null {
  try {
    return store?.getItem(MY_CARS_KEY) || null
  } catch {
    return null
  }
}

export function writeSaved(store: Store | null | undefined, id: string | number | null): void {
  try {
    if (!store) return
    if (id === null || id === '') store.removeItem(MY_CARS_KEY)
    else store.setItem(MY_CARS_KEY, String(id))
  } catch {
    // Not remembering is fine: the person picks their name again next time.
  }
}

/**
 * The remembered person, only if they are still on the list. Someone who left the team, or whose id no longer exists,
 * is not shown: the page asks again instead of showing a stranger's cars.
 */
export function pickSaved<P extends { id: number | string }>(people: P[], saved: string | null): P | null {
  if (!saved) return null
  return people.find(p => String(p.id) === saved) ?? null
}
