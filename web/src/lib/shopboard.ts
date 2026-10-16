/**
 * How cars are sorted onto technician columns. No imports, so it runs the same in the browser and under `node --test`.
 * Jobs and appointments store the technician's name as plain text, so matching ignores capitals and extra spaces.
 */

export const normName = (s: unknown): string => String(s ?? '').trim().toLowerCase()

/** An empty name, or the word "Unassigned" some screens write, means nobody has the car yet. */
export const isUnassigned = (tech: unknown): boolean => {
  const t = normName(tech)
  return t === '' || t === 'unassigned'
}

export interface Grouped<T> {
  unassigned: T[]
  /** One list per technician, in the order the names were given. Empty lists are kept. */
  byTech: Map<string, T[]>
  /** Names on cars that are not on the team list (a typo, or someone who left). Each gets its own column. */
  others: { name: string; jobs: T[] }[]
}

export function groupByTech<T extends { tech?: string | null }>(jobs: T[], techNames: string[]): Grouped<T> {
  const canonical = new Map<string, string>()
  for (const n of techNames) if (!canonical.has(normName(n))) canonical.set(normName(n), n)
  const byTech = new Map<string, T[]>()
  for (const n of canonical.values()) byTech.set(n, [])
  const unassigned: T[] = []
  const other = new Map<string, { name: string; jobs: T[] }>()
  for (const j of jobs) {
    if (isUnassigned(j.tech)) { unassigned.push(j); continue }
    const hit = canonical.get(normName(j.tech))
    if (hit) { (byTech.get(hit) as T[]).push(j); continue }
    const key = normName(j.tech)
    const entry = other.get(key) || { name: String(j.tech).trim(), jobs: [] }
    entry.jobs.push(j)
    other.set(key, entry)
  }
  return { unassigned, byTech, others: [...other.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}

/** What is saved on the car when it is given to someone. Taking it back saves an empty name, as the Jobs screen does. */
export const techValue = (name: string): string => (isUnassigned(name) ? '' : name.trim())

/* ---------- jumping to a column on a phone ---------- */

export interface JumpChip {
  /** The id of the column the chip scrolls to. */
  id: string
  label: string
  count: number
}

/** A tag that is safe to use as an element id, whatever the name has in it. */
export const columnId = (key: string): string => `col-${String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x'}`

/**
 * One chip per column, in the order the columns are drawn: Unassigned first, then the team, then names that are not on it.
 * Two names that clean to the same tag are told apart by their place in the list, so a chip never lands on the wrong column.
 */
export function jumpChips(groups: { key: string; label: string; count: number }[]): JumpChip[] {
  const seen = new Map<string, number>()
  return groups.map(g => {
    const base = columnId(g.key)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { id: n === 1 ? base : `${base}-${n}`, label: g.label, count: g.count }
  })
}

/* ---------- the shop wall (TV) ---------- */

/**
 * What the wall shows for a customer. The screen faces the waiting room, so the name stays off unless the shop turned it on,
 * and then it is the first name only ("Sam"), never the surname.
 */
export function wallCustomer(name: unknown, showNames: boolean): string {
  if (!showNames) return ''
  return String(name ?? '').replace(/^\s*walk-?\s?in\s*[:-]\s*/i, '').trim().split(/\s+/)[0] || ''
}

/** Seconds between refreshes on the wall, kept inside the range the settings allow. */
export function wallSeconds(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.max(10, Math.min(300, Math.round(n))) : 30
}

export interface WallColumn<T> {
  key: string
  name: string
  jobs: T[]
}

/**
 * The columns the wall draws: only people who have cars, with Unassigned first. Everyone else goes in `idle`, so the screen
 * can say who has nothing instead of wasting a column on an empty list.
 */
export function wallColumns<T extends { tech?: string | null }>(jobs: T[], techNames: string[]): { columns: WallColumn<T>[]; idle: string[] } {
  const g = groupByTech(jobs, techNames)
  const columns: WallColumn<T>[] = []
  if (g.unassigned.length > 0) columns.push({ key: '__unassigned__', name: 'Unassigned', jobs: g.unassigned })
  const idle: string[] = []
  for (const [name, list] of g.byTech) {
    if (list.length > 0) columns.push({ key: `tech:${normName(name)}`, name, jobs: list })
    else idle.push(name)
  }
  for (const o of g.others) columns.push({ key: `other:${normName(o.name)}`, name: o.name, jobs: o.jobs })
  return { columns, idle }
}
