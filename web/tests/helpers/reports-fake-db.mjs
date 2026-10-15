// A small in-memory stand-in for the database client, for the reports, accounting and parts tests.
// It speaks the same chained calls the app makes (select, insert, update, upsert, delete, filters, order, range, rpc) and can
// pretend a table or a column does not exist, refuse a duplicate, or fail on purpose.
//
//   const db = createDb({ expenses: [...] }, { missingTables: ['saved_reports'], unique: { report_send_log: [['saved_report_id', 'period_key']] },
//                          rpc: { next_po_number: (args, db) => 'PO-0001' } })

let counter = 0
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function splitTop(str) {
  const parts = []
  let depth = 0, cur = ''
  for (const ch of str) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

const cmp = (a, op, b) => {
  if (op === 'is') return b === 'null' ? a == null : String(a) === b
  if (a == null) return false
  const x = typeof a === 'number' ? a : String(a)
  const y = typeof a === 'number' ? Number(b) : String(b)
  switch (op) {
    case 'eq': return x === y
    case 'neq': return x !== y
    case 'gt': return x > y
    case 'gte': return x >= y
    case 'lt': return x < y
    case 'lte': return x <= y
    default: return false
  }
}

function evalOr(row, part) {
  const g = /^(and|or)\((.*)\)$/.exec(part)
  if (g) {
    const subs = splitTop(g[2])
    return g[1] === 'and' ? subs.every(s => evalOr(row, s)) : subs.some(s => evalOr(row, s))
  }
  const m = /^([a-z_]+)\.(eq|neq|gt|gte|lt|lte|is)\.(.*)$/.exec(part)
  return m ? cmp(row[m[1]], m[2], m[3]) : false
}

export function createDb(seed = {}, options = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map(r => ({ ...r }))]))
  const log = []
  const missingTables = new Set(options.missingTables || [])
  const missingColumns = options.missingColumns || {}
  const failures = options.failures || {}
  const unique = options.unique || {}
  const rpcHandlers = options.rpc || {}
  const missingFunctions = new Set(options.missingFunctions || [])

  const missingTable = table => ({ data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } })

  function from(table) {
    const state = { table, op: 'select', filters: [], values: null, head: false, count: false, wantRows: false, limit: null, offset: 0, single: null, orders: [], onConflict: null, columns: '*' }
    const builder = {
      select(cols, opts) {
        if (state.op === 'select') { state.head = Boolean(opts?.head); state.count = opts?.count === 'exact'; state.columns = cols || '*' } else state.wantRows = true
        return builder
      },
      insert(values) { state.op = 'insert'; state.values = values; return builder },
      upsert(values, opts) { state.op = 'upsert'; state.values = values; state.onConflict = opts?.onConflict || null; return builder },
      update(values) { state.op = 'update'; state.values = values; return builder },
      delete() { state.op = 'delete'; return builder },
      eq(c, v) { state.filters.push(r => r[c] !== undefined && r[c] !== null && String(r[c]) === String(v)); return builder },
      neq(c, v) { state.filters.push(r => String(r[c]) !== String(v)); return builder },
      gt(c, v) { state.filters.push(r => cmp(r[c], 'gt', v)); return builder },
      gte(c, v) { state.filters.push(r => cmp(r[c], 'gte', v)); return builder },
      lt(c, v) { state.filters.push(r => cmp(r[c], 'lt', v)); return builder },
      lte(c, v) { state.filters.push(r => cmp(r[c], 'lte', v)); return builder },
      in(c, vs) { state.filters.push(r => vs.map(String).includes(String(r[c]))); return builder },
      is(c, v) { state.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return builder },
      not(c, op, v) {
        state.filters.push(r => { const t = op === 'is' ? (v === null ? r[c] == null : r[c] === v) : cmp(r[c], op, String(v)); return !t })
        return builder
      },
      or(f) { const parts = splitTop(f.startsWith('(') && f.endsWith(')') ? f.slice(1, -1) : f); state.filters.push(r => parts.some(p => evalOr(r, p))); return builder },
      order(c, o) { state.orders.push([c, o?.ascending !== false]); return builder },
      limit(n) { state.limit = n; return builder },
      range(a, b) { state.offset = a; state.limit = b - a + 1; return builder },
      maybeSingle() { state.single = 'maybe'; return run() },
      single() { state.single = 'one'; return run() },
      then(resolve, reject) { return run().then(resolve, reject) },
    }

    async function run() {
      log.push({ table, op: state.op, values: state.values, columns: state.columns })
      if (missingTables.has(table)) return missingTable(table)
      const failure = failures[`${state.op}:${table}`] || failures[table]
      if (failure) return { data: null, error: failure }
      const gone = (missingColumns[table] || []).find(c => new RegExp(`(^|,)\\s*${c}\\s*(,|$)`).test(state.columns))
      if (state.op === 'select' && gone) return { data: null, error: { code: '42703', message: `column ${table}.${gone} does not exist` } }

      const rows = (tables[table] ||= [])
      const matching = () => rows.filter(r => state.filters.every(f => f(r)))
      const conflicts = (candidate, ignore) => (unique[table] || []).some(cols =>
        cols.every(c => candidate[c] !== undefined && candidate[c] !== null) && rows.some(r => r !== ignore && cols.every(c => String(r[c]) === String(candidate[c]))))
      let result
      if (state.op === 'insert') {
        const list = (Array.isArray(state.values) ? state.values : [state.values]).map(v => ({ id: newId(), ...v }))
        for (const v of list) {
          if (conflicts(v)) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${table}` } }
          if (rows.some(r => r.id === v.id)) return { data: null, error: { code: '23505', message: 'duplicate key value' } }
        }
        rows.push(...list)
        result = list
      } else if (state.op === 'upsert') {
        const keys = String(state.onConflict || 'id').split(',').map(s => s.trim())
        const list = Array.isArray(state.values) ? state.values : [state.values]
        result = []
        for (const v of list) {
          const i = rows.findIndex(r => keys.every(k => String(r[k]) === String(v[k])))
          if (i >= 0) {
            if (conflicts({ ...rows[i], ...v }, rows[i])) return { data: null, error: { code: '23505', message: 'duplicate key value' } }
            Object.assign(rows[i], v); result.push(rows[i])
          } else {
            const row = { id: newId(), ...v }
            if (conflicts(row)) return { data: null, error: { code: '23505', message: 'duplicate key value' } }
            rows.push(row); result.push(row)
          }
        }
      } else if (state.op === 'update') {
        result = matching()
        for (const r of result) {
          const next = { ...r, ...state.values }
          if (conflicts(next, r)) return { data: null, error: { code: '23505', message: 'duplicate key value' } }
          Object.assign(r, state.values)
        }
      } else if (state.op === 'delete') {
        result = matching()
        for (const r of result) rows.splice(rows.indexOf(r), 1)
      } else {
        result = matching()
        for (const [c, asc] of [...state.orders].reverse()) {
          result = [...result].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1))
        }
        const total = result.length
        if (state.offset) result = result.slice(state.offset)
        if (state.limit != null) result = result.slice(0, state.limit)
        if (state.head) return { data: null, error: null, count: total }
        // Only the columns asked for come back, like the real thing.
        if (state.columns !== '*') {
          const want = state.columns.split(',').map(c => c.trim()).filter(Boolean)
          result = result.map(r => Object.fromEntries(want.filter(c => c in r).map(c => [c, r[c]])))
        }
        if (state.count) return { data: result.map(r => ({ ...r })), error: null, count: total }
      }
      if (state.single) {
        if (state.single === 'one' && result.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
        return { data: result[0] ? { ...result[0] } : null, error: null }
      }
      const plainWrite = ['insert', 'upsert', 'update', 'delete'].includes(state.op) && !state.wantRows
      return { data: plainWrite ? null : result.map(r => ({ ...r })), error: null }
    }
    return builder
  }

  async function rpc(fn, args = {}) {
    log.push({ table: `rpc:${fn}`, op: 'rpc', values: args })
    if (missingFunctions.has(fn)) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } }
    const failure = failures[`rpc:${fn}`]
    if (failure) return { data: null, error: failure }
    const h = rpcHandlers[fn]
    if (!h) return { data: null, error: { code: '42883', message: `function ${fn} does not exist` } }
    try { return { data: await h(args, api), error: null } } catch (e) { return { data: null, error: e && typeof e === 'object' && 'code' in e ? e : { code: 'P0001', message: String(e?.message || e) } } }
  }

  const api = { from, rpc, tables, log }
  return api
}
