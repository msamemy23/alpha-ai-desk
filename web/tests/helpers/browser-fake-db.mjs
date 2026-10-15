// A tiny in-memory stand-in for the database client, just enough for the browser tests.
// eq / neq / gt / gte / lt / in / like filters, order, limit, select after a write, maybeSingle, upsert by conflict columns.
// `failures` maps "op:table" or "table" to an error object. `missing` lists tables that do not exist yet.
export function createBrowserDb(seed = {}, options = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]))
  const missing = new Set(options.missing || [])
  const failures = options.failures || {}
  const log = []
  let counter = 0
  const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

  function from(table) {
    const state = { op: 'select', filters: [], values: null, wantRows: false, limit: null, single: false, orderBy: null, onConflict: null }
    const builder = {
      select() { if (state.op !== 'select') state.wantRows = true; return builder },
      insert(values) { state.op = 'insert'; state.values = values; return builder },
      upsert(values, opts) { state.op = 'upsert'; state.values = values; state.onConflict = opts?.onConflict || 'id'; return builder },
      update(values) { state.op = 'update'; state.values = values; return builder },
      delete() { state.op = 'delete'; return builder },
      eq(c, v) { state.filters.push(r => r[c] !== undefined && String(r[c]) === String(v)); return builder },
      neq(c, v) { state.filters.push(r => r[c] !== v); return builder },
      gt(c, v) { state.filters.push(r => r[c] !== undefined && String(r[c]) > String(v)); return builder },
      gte(c, v) { state.filters.push(r => r[c] !== undefined && String(r[c]) >= String(v)); return builder },
      lt(c, v) { state.filters.push(r => r[c] !== undefined && String(r[c]) < String(v)); return builder },
      in(c, vs) { state.filters.push(r => vs.includes(r[c])); return builder },
      like(c, p) { const re = new RegExp(`^${String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`); state.filters.push(r => re.test(String(r[c]))); return builder },
      order(c, o) { state.orderBy = [c, o?.ascending !== false]; return builder },
      limit(n) { state.limit = n; return builder },
      maybeSingle() { state.single = true; return run() },
      single() { state.single = true; return run() },
      then(resolve, reject) { return run().then(resolve, reject) },
    }
    async function run() {
      log.push({ table, op: state.op, values: state.values, filters: state.filters.length })
      if (missing.has(table)) return { data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } }
      const failure = failures[`${state.op}:${table}`] || failures[table]
      if (failure) return { data: null, error: failure }
      const rows = (tables[table] ||= [])
      const matching = () => rows.filter(r => state.filters.every(f => f(r)))
      let result
      if (state.op === 'insert') {
        const list = (Array.isArray(state.values) ? state.values : [state.values]).map(v => ({ id: uuid(), created_at: new Date().toISOString(), ...v }))
        rows.push(...list)
        result = list
      } else if (state.op === 'upsert') {
        const keys = String(state.onConflict).split(',')
        const value = { ...state.values }
        const index = rows.findIndex(r => keys.every(k => r[k] === value[k]))
        if (index >= 0) { rows[index] = { ...rows[index], ...value }; result = [rows[index]] }
        else { const row = { id: uuid(), created_at: new Date().toISOString(), ...value }; rows.push(row); result = [row] }
      } else if (state.op === 'update') {
        result = matching()
        for (const r of result) Object.assign(r, state.values)
      } else if (state.op === 'delete') {
        result = matching()
        for (const r of result) rows.splice(rows.indexOf(r), 1)
      } else {
        result = matching()
        if (state.orderBy) { const [c, asc] = state.orderBy; result = [...result].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1)) }
        if (state.limit) result = result.slice(0, state.limit)
      }
      if (state.single) return { data: result[0] ? { ...result[0] } : null, error: null }
      const plainWrite = state.op !== 'select' && !state.wantRows
      return { data: plainWrite ? null : result.map(r => ({ ...r })), error: null }
    }
    return builder
  }
  return { from, tables, log }
}
