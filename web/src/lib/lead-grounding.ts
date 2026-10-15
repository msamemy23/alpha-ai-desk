// Keeps AI-written lead profiles honest. Alpha reads search results and asks an AI to summarise each business or post.
// An AI will happily fill a gap with a plausible name, number or email. Nothing it adds is kept unless the same fact is
// in the search text it was given. Pure.

const words = (value: string): string[] => value.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(w => w.length > 1)

/** The value, if every word in it appears in the source text. Otherwise null. Used for people's names. */
export function nameFoundIn(value: unknown, source: string): string | null {
  const v = String(value ?? '').trim()
  if (!v || /^(unknown|n\/a|none|null|not found)$/i.test(v)) return null
  const hay = ` ${words(source).join(' ')} `
  const parts = words(v)
  return parts.length && parts.every(p => hay.includes(` ${p} `) || hay.includes(` ${p}`)) ? v : null
}

/** A phone number, if its last ten digits appear in the source text. */
export function phoneFoundIn(value: unknown, source: string): string | null {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length < 10) return null
  const ten = digits.slice(-10)
  return source.replace(/\D/g, '').includes(ten) ? String(value).trim() : null
}

/** An email address, if it appears in the source text (case-insensitive). */
export function emailFoundIn(value: unknown, source: string): string | null {
  const v = String(value ?? '').trim().toLowerCase()
  if (!/^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/.test(v)) return null
  return source.toLowerCase().includes(v) ? v : null
}

/** The first email address in a block of text, ignoring image file names that look like addresses. */
export function firstEmailIn(text: string): string | null {
  for (const m of text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
    if (!/\.(png|jpe?g|gif|svg|webp)$/i.test(m[0])) return m[0].toLowerCase()
  }
  return null
}

/** Matches an AI row back to the business it came from, by name. */
export function matchSource<T extends { name?: unknown }>(row: { name?: unknown }, sources: readonly T[]): T | null {
  const key = String(row.name ?? '').trim().toLowerCase()
  if (!key) return null
  return sources.find(s => String(s.name ?? '').trim().toLowerCase() === key)
    || sources.find(s => { const n = String(s.name ?? '').trim().toLowerCase(); return n.length > 3 && (n.includes(key) || key.includes(n)) })
    || null
}

/** A score from 1 to 10, or null. */
export const scoreOf = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : null
}
