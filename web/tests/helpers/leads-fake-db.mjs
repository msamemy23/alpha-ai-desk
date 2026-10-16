// A small in-memory database that answers the same calls the app makes (select, insert, update, delete, upsert, eq, in, ilike, limit,
// single, maybeSingle, count). Nothing here can reach a real database. A test can make one operation fail on purpose:
//   fakeDb(seed, { fail: { 'deleted_calls.upsert': { code: '42P01', message: 'relation "deleted_calls" does not exist' } } })

export function fakeDb(seed = {}, { fail = {} } = {}) {
  const tables = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map(r => ({ ...r }))
  const log = []
  let seq = 0
  const rowsOf = t => (tables[t] ||= [])

  function from(table) {
    const q = { op: 'select', filters: [], head: false, count: null, payload: null, opts: null, limit: null, wantRows: false, single: null }
    const matches = r => q.filters.every(f => f(r))
    const run = () => {
      const failure = fail[`${table}.${q.op}`]
      log.push({ table, op: q.op })
      if (failure) return { data: null, error: failure, count: null }
      const all = rowsOf(table)
      if (q.op === 'select') {
        let found = all.filter(matches)
        const count = q.count ? found.length : null
        if (q.head) return { data: null, error: null, count }
        if (q.limit != null) found = found.slice(0, q.limit)
        found = found.map(r => ({ ...r }))
        if (q.single) return { data: found[0] ?? null, error: q.single === 'one' && !found[0] ? { code: 'PGRST116', message: 'no rows' } : null, count }
        return { data: found, error: null, count }
      }
      if (q.op === 'insert') {
        const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(p => ({ id: p.id ?? `row-${++seq}`, created_at: new Date('2026-10-16T12:00:00Z').toISOString(), ...p }))
        all.push(...list)
        const data = q.wantRows ? list.map(r => ({ ...r })) : null
        return { data: q.single ? (data?.[0] ?? null) : data, error: null }
      }
      if (q.op === 'upsert') {
        const keys = String(q.opts?.onConflict || 'id').split(',')
        const out = []
        for (const p of Array.isArray(q.payload) ? q.payload : [q.payload]) {
          const hit = all.find(r => keys.every(k => r[k] === p[k]))
          if (hit) { if (!q.opts?.ignoreDuplicates) Object.assign(hit, p); continue }
          const row = { ...p }
          all.push(row); out.push({ ...row })
        }
        return { data: q.wantRows ? out : null, error: null }
      }
      if (q.op === 'update') {
        const hit = all.filter(matches)
        hit.forEach(r => Object.assign(r, q.payload))
        return { data: q.wantRows ? hit.map(r => ({ ...r })) : null, error: null }
      }
      if (q.op === 'delete') {
        const hit = all.filter(matches)
        tables[table] = all.filter(r => !hit.includes(r))
        return { data: q.wantRows ? hit.map(r => ({ ...r })) : null, error: null }
      }
      return { data: null, error: { message: 'unsupported' } }
    }
    const api = {
      select(_cols, o) { if (q.op !== 'select') q.wantRows = true; if (o?.head) q.head = true; if (o?.count) q.count = o.count; return api },
      insert(p) { q.op = 'insert'; q.payload = p; return api },
      update(p) { q.op = 'update'; q.payload = p; return api },
      delete() { q.op = 'delete'; return api },
      upsert(p, o) { q.op = 'upsert'; q.payload = p; q.opts = o; return api },
      eq(c, v) { q.filters.push(r => r[c] === v); return api },
      in(c, vs) { q.filters.push(r => vs.includes(r[c])); return api },
      ilike(c, pat) {
        const re = new RegExp('^' + String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
        q.filters.push(r => re.test(String(r[c] ?? '')))
        return api
      },
      limit(n) { q.limit = n; return api },
      order() { return api },
      range() { return api },
      maybeSingle() { q.single = 'maybe'; return Promise.resolve(run()) },
      single() { q.single = 'one'; return Promise.resolve(run()) },
      then(res, rej) { return Promise.resolve(run()).then(res, rej) },
    }
    return api
  }
  return { from, tables, log }
}
