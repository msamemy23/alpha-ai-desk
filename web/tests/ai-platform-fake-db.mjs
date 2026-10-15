// A tiny in-memory stand-in for the Supabase client, just enough for the AI platform tests.
// Supports select/insert/update/delete/upsert with eq/neq/gte/lte/in/like filters and maybeSingle/single.
export function createFakeDb(seed = {}, options = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]))
  const log = []
  const failures = options.failures || {}

  function from(table) {
    const state = { table, op: 'select', filters: [], values: null, head: false, count: false, wantRows: false, limit: null, single: null, orderBy: null }
    const builder = {
      select(_cols, opts) {
        if (state.op === 'select') {
          state.head = Boolean(opts?.head)
          state.count = opts?.count === 'exact'
        } else {
          state.wantRows = true
        }
        return builder
      },
      insert(values) { state.op = 'insert'; state.values = values; return builder },
      upsert(values, opts) { state.op = 'upsert'; state.values = values; state.onConflict = opts?.onConflict; return builder },
      update(values) { state.op = 'update'; state.values = values; return builder },
      delete() { state.op = 'delete'; return builder },
      eq(column, value) { state.filters.push(row => String(row[column]) === String(value) && row[column] !== undefined); return builder },
      neq(column, value) { state.filters.push(row => row[column] !== value); return builder },
      gte(column, value) { state.filters.push(row => String(row[column]) >= String(value)); return builder },
      lte(column, value) { state.filters.push(row => String(row[column]) <= String(value)); return builder },
      in(column, values) { state.filters.push(row => values.includes(row[column])); return builder },
      like(column, pattern) { const re = new RegExp(`^${String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`); state.filters.push(row => re.test(String(row[column]))); return builder },
      order(column, o) { state.orderBy = [column, o?.ascending !== false]; return builder },
      limit(n) { state.limit = n; return builder },
      maybeSingle() { state.single = 'maybe'; return run() },
      single() { state.single = 'one'; return run() },
      then(resolve, reject) { return run().then(resolve, reject) },
    }
    async function run() {
      log.push({ table, op: state.op, values: state.values })
      const failure = failures[`${state.op}:${table}`] || failures[table]
      if (failure) return { data: null, error: failure, count: null }
      const rows = (tables[table] ||= [])
      const matching = () => rows.filter(row => state.filters.every(fn => fn(row)))
      let result
      if (state.op === 'insert') {
        const list = Array.isArray(state.values) ? state.values : [state.values]
        for (const value of list) {
          if (value.id && rows.some(row => row.id === value.id)) return { data: null, error: { code: '23505', message: 'duplicate key' } }
          rows.push({ ...value })
        }
        result = list
      } else if (state.op === 'upsert') {
        const keys = String(state.onConflict || 'id').split(',')
        const value = { ...state.values }
        const index = rows.findIndex(row => keys.every(key => row[key] === value[key]))
        if (index >= 0) rows[index] = { ...rows[index], ...value }
        else rows.push(value)
        result = [value]
      } else if (state.op === 'update') {
        result = matching()
        for (const row of result) Object.assign(row, state.values)
      } else if (state.op === 'delete') {
        result = matching()
        for (const row of result) rows.splice(rows.indexOf(row), 1)
      } else {
        result = matching()
        if (state.orderBy) { const [c, asc] = state.orderBy; result = [...result].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1)) }
        if (state.limit) result = result.slice(0, state.limit)
      }
      if (state.head) return { data: null, error: null, count: result.length }
      if (state.single) {
        if (state.single === 'one' && result.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'no rows' } }
        return { data: result[0] ? { ...result[0] } : null, error: null }
      }
      const plainWrite = ['insert', 'upsert', 'update', 'delete'].includes(state.op) && !state.wantRows
      return { data: plainWrite ? null : result.map(row => ({ ...row })), error: null, count: state.count ? result.length : null }
    }
    return builder
  }
  return { from, tables, log }
}
