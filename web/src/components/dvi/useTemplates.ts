'use client'
import { useCallback, useEffect, useState } from 'react'

/** A checklist the shop wrote for itself. */
export interface ShopTemplate {
  id: string
  /** The short key an inspection's line ids start with. */
  key: string
  label: string
  blurb: string
  sections: { title: string; items: string[] }[]
  archived: boolean
}

export interface TemplateInput { id?: string; label: string; blurb: string; sections: { title: string; items: string[] }[] }

function shape(r: unknown): ShopTemplate | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.key !== 'string') return null
  const sections = (Array.isArray(o.sections) ? o.sections : []).map(sec => {
    const so = (sec && typeof sec === 'object' ? sec : {}) as Record<string, unknown>
    return { title: typeof so.title === 'string' ? so.title : '', items: (Array.isArray(so.items) ? so.items : []).filter((x): x is string => typeof x === 'string') }
  })
  return { id: o.id, key: o.key, label: typeof o.label === 'string' ? o.label : '', blurb: typeof o.blurb === 'string' ? o.blurb : '', sections, archived: o.archived === true }
}

async function call(method: 'POST' | 'PUT', body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; template?: ShopTemplate }> {
  try {
    const res = await fetch('/api/inspection/templates', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; template?: unknown }
    if (!res.ok || !d.ok) return { ok: false, error: d.error || (res.status === 401 ? 'You were signed out. Refresh the page and sign in again.' : 'That did not save. Try again.') }
    const t = shape(d.template)
    return t ? { ok: true, template: t } : { ok: false, error: 'That did not save. Try again.' }
  } catch {
    return { ok: false, error: 'No connection. Check your internet and try again.' }
  }
}

/**
 * The shop's own inspection checklists. `available` is false until the database update that adds the table has been applied;
 * the three built-in checklists keep working either way.
 */
export function useTemplates() {
  const [list, setList] = useState<ShopTemplate[]>([])
  const [available, setAvailable] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/inspection/templates', { cache: 'no-store' })
      const d = await res.json().catch(() => ({})) as { ok?: boolean; available?: boolean; templates?: unknown[] }
      if (!res.ok || !d.ok) { setError('Your own checklists did not load.'); return }
      setAvailable(d.available !== false)
      setList((d.templates || []).map(shape).filter((t): t is ShopTemplate => t !== null))
      setError('')
    } catch {
      setError('Your own checklists did not load. Check your connection.')
    } finally { setLoaded(true) }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async (input: TemplateInput) => {
    const r = await call(input.id ? 'PUT' : 'POST', { ...input })
    if (r.ok) await load()
    return r
  }, [load])

  const setArchived = useCallback(async (id: string, archived: boolean) => {
    const r = await call('PUT', { id, archived })
    if (r.ok) await load()
    return r
  }, [load])

  return { list, available, loaded, error, reload: load, save, setArchived }
}
