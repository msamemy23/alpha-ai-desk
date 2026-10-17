// A one-table stand-in for the database, shaped like the parts of the Supabase client the settings routes use.
// A column that is not in `columns` behaves like a column the database does not have: reading or writing it is an error (42703).
export function makeSettingsDb({ columns, rows }) {
  const state = { rows: rows.map(r => ({ ...r })), writes: [] }
  const known = new Set(columns)
  const missing = list => list.find(c => c && !known.has(c))
  function builder(table) {
    const q = { table, cols: '*', filters: [], op: null, values: null }
    const run = () => {
      if (table !== 'settings') return { data: null, error: { code: 'PGRST205', message: `no table ${table}` } }
      const hit = state.rows.filter(r => q.filters.every(([k, v]) => r[k] === v))
      if (q.op === 'update') {
        const bad = missing(Object.keys(q.values))
        if (bad) return { data: null, error: { code: '42703', message: `column "${bad}" of relation "settings" does not exist` } }
        state.writes.push({ op: 'update', values: { ...q.values } })
        hit.forEach(r => Object.assign(r, q.values))
        return { data: null, error: null }
      }
      if (q.op === 'insert') {
        const bad = missing(Object.keys(q.values))
        if (bad) return { data: null, error: { code: '42703', message: `column "${bad}" of relation "settings" does not exist` } }
        state.writes.push({ op: 'insert', values: { ...q.values } })
        state.rows.push({ ...q.values })
        return { data: null, error: null }
      }
      const wanted = q.cols === '*' ? null : String(q.cols).split(',').map(s => s.trim())
      const bad = wanted && missing(wanted)
      if (bad) return { data: null, error: { code: '42703', message: `column settings.${bad} does not exist` } }
      const pick = r => (wanted ? Object.fromEntries(wanted.map(c => [c, r[c] ?? null])) : { ...r })
      return { data: hit[0] ? pick(hit[0]) : null, error: null }
    }
    const api = {
      select(cols) { q.cols = cols; return api },
      update(values) { q.op = 'update'; q.values = values; return api },
      insert(values) { q.op = 'insert'; q.values = values; return api },
      eq(k, v) { q.filters.push([k, v]); return api },
      order() { return api },
      limit() { return api },
      maybeSingle() { return Promise.resolve(run()) },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
    }
    return api
  }
  return { from: builder, state }
}
