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
