// A small in-memory stand-in for the Supabase client, for the receptionist tests.
// Supports the query shapes src/lib/voice/store.ts and the pipelines use. Not a test file itself.
let counter = 0

function matchLike(value, pattern) {
  const re = new RegExp('^' + String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
  return re.test(String(value ?? ''))
}

export function makeDb({ tables = {}, missing = [], unique = {}, failOn = {} } = {}) {
  const data = {}
  for (const [k, v] of Object.entries(tables)) data[k] = v.map(r => ({ ...r }))
  const missingSet = new Set(missing)
  const calls = []

  function table(name) { return (data[name] ||= []) }

  function violates(name, row, ignoreIndex = -1) {
    for (const cols of unique[name] || []) {
      if (cols.some(c => row[c] === undefined || row[c] === null)) continue
      const idx = table(name).findIndex((r, i) => i !== ignoreIndex && cols.every(c => r[c] === row[c]))
      if (idx >= 0) return idx
    }
    return -1
  }

  function builder(name) {
    const b = {
      op: 'select', filters: [], payload: null, wantRows: false, orderBy: null, max: Infinity, conflict: null, name,
      select() { if (this.op === 'select') this.op = 'select'; else this.wantRows = true; return this },
      insert(p) { this.op = 'insert'; this.payload = p; return this },
      update(p) { this.op = 'update'; this.payload = p; return this },
      upsert(p, o) { this.op = 'upsert'; this.payload = p; this.conflict = o?.onConflict || null; return this },
      delete() { this.op = 'delete'; return this },
      eq(c, v) { this.filters.push(r => r[c] === v); return this },
      neq(c, v) { this.filters.push(r => r[c] !== v); return this },
      gt(c, v) { this.filters.push(r => r[c] > v); return this },
      gte(c, v) { this.filters.push(r => r[c] >= v); return this },
      lt(c, v) { this.filters.push(r => r[c] < v); return this },
      lte(c, v) { this.filters.push(r => r[c] <= v); return this },
      is(c, v) { this.filters.push(r => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return this },
      in(c, vs) { this.filters.push(r => vs.includes(r[c])); return this },
      not(c, op, v) {
        if (op === 'in') { const vs = String(v).replace(/[()"]/g, '').split(',').map(s => s.trim()); this.filters.push(r => !vs.includes(String(r[c]))) }
        else if (op === 'is') this.filters.push(r => !(v === null ? r[c] === null || r[c] === undefined : r[c] === v))
        return this
      },
      ilike(c, p) { this.filters.push(r => matchLike(r[c], p)); return this },
      order(c, o) { this.orderBy = { c, asc: o?.ascending !== false }; return this },
      limit(n) { this.max = n; return this },
      maybeSingle() { this.single_ = 'maybe'; return this.run() },
      single() { this.single_ = 'one'; return this.run() },
      then(res, rej) { return this.run().then(res, rej) },
      async run() {
        calls.push({ table: name, op: this.op })
        if (missingSet.has(name)) return { data: null, error: { code: '42P01', message: `relation "${name}" does not exist` } }
        if (failOn[name]) return { data: null, error: { code: 'XX000', message: 'boom' } }
        const rows = table(name)
        const match = r => this.filters.every(f => f(r))
        let out = []
        let error = null
        if (this.op === 'select') {
          out = rows.filter(match)
        } else if (this.op === 'insert') {
          const list = Array.isArray(this.payload) ? this.payload : [this.payload]
          for (const p of list) {
            const row = { id: `${name}-${++counter}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...p }
            if (violates(name, row) >= 0) { error = { code: '23505', message: 'duplicate key value violates unique constraint' }; break }
            rows.push(row); out.push(row)
          }
        } else if (this.op === 'upsert') {
          const p = { ...this.payload }
          const cols = this.conflict ? this.conflict.split(',') : null
          const idx = cols ? rows.findIndex(r => cols.every(c => r[c] === p[c])) : -1
          if (idx >= 0) { rows[idx] = { ...rows[idx], ...p }; out = [rows[idx]] }
          else { const row = { id: `${name}-${++counter}`, ...p }; rows.push(row); out = [row] }
        } else if (this.op === 'update') {
          for (let i = 0; i < rows.length; i++) if (match(rows[i])) { rows[i] = { ...rows[i], ...this.payload }; out.push(rows[i]) }
        } else if (this.op === 'delete') {
          for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) out.push(...rows.splice(i, 1))
        }
        if (this.orderBy) {
          const { c, asc } = this.orderBy
          out = [...out].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1))
        }
        out = out.slice(0, this.max)
        if (error) return { data: null, error }
        const noReturn = (this.op === 'insert' || this.op === 'update' || this.op === 'upsert' || this.op === 'delete') && !this.wantRows
        if (noReturn) return { data: null, error: null }
        if (this.single_) return { data: out[0] || null, error: null }
        return { data: out, error: null }
      },
    }
    return b
  }

  return { from: builder, data, calls, table }
}
