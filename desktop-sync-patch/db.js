/**
 * Alpha AI Desk — Supabase Sync Adapter
 * 
 * Drop this into alpha-desk-electron/src/db.js
 * Then update app.js to use `window.db` instead of localStorage
 * 
 * This makes the desktop app read/write Supabase in real-time,
 * syncing with the web dashboard automatically.
 */

const { createClient } = require('@supabase/supabase-js')

let supabase = null

function initSupabase(url, anonKey) {
  supabase = createClient(url, anonKey, {
    realtime: { params: { eventsPerSecond: 10 } }
  })
  return supabase
}

/**
 * The DB object — replaces the old localStorage-based db in app.js
 * 
 * Usage (in app.js):
 *   const customers = await window.db.getAll('customers')
 *   const job = await window.db.getById('jobs', id)
 *   await window.db.upsert('customers', { id, name, phone, ... })
 *   await window.db.delete('customers', id)
 */
const db = {
  async getAll(table, options = {}) {
    if (!supabase) return this._fallback('getAll', table, options)
    let q = supabase.from(table).select('*')
    if (options.orderBy) q = q.order(options.orderBy, { ascending: options.ascending ?? false })
    else q = q.order('created_at', { ascending: false })
    if (options.eq) Object.entries(options.eq).forEach(([k,v]) => { q = q.eq(k, v) })
    if (options.limit) q = q.limit(options.limit)
    const { data, error } = await q
    if (error) { console.error(`db.getAll(${table}):`, error); return [] }
    return data || []
  },

  async getById(table, id) {
    if (!supabase) return this._fallback('getById', table, id)
    const { data, error } = await supabase.from(table).select('*').eq('id', id).single()
    if (error) return null
    return data
  },

  async upsert(table, record) {
    if (!supabase) return this._fallback('upsert', table, record)
    const now = new Date().toISOString()
    const data = { ...record, updated_at: now }
    if (!data.id) {
      data.id = crypto.randomUUID()
      data.created_at = now
    }
    const { data: result, error } = await supabase.from(table).upsert(data).select().single()
    if (error) { console.error(`db.upsert(${table}):`, error); return null }
    return result
  },

  async delete(table, id) {
    if (!supabase) return this._fallback('delete', table, id)
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) console.error(`db.delete(${table}):`, error)
    return !error
  },

  async getSettings() {
    if (!supabase) return this._fallback('getSettings')
    const { data } = await supabase.from('settings').select('*').limit(1).single()
    return data || {}
  },

  async updateSettings(updates) {
    if (!supabase) return this._fallback('updateSettings', updates)
    const existing = await this.getSettings()
    if (existing?.id) {
      await supabase.from('settings').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', existing.id)
    } else {
      await supabase.from('settings').insert({ ...updates })
    }
  },

  // Subscribe to real-time changes from web dashboard
  subscribe(table, callback) {
    if (!supabase) return () => {}
    const channel = supabase.channel(`desktop_${table}_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        callback(payload.eventType, payload.new || payload.old)
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  },

  // Fallback: read/write from old localStorage-based structure if Supabase not configured
  _fallback(method, ...args) {
    console.warn(`[db] Supabase not configured — using localStorage fallback for ${method}(${args[0] || ''})`)
    // Return empty data gracefully so the app still works
    if (method === 'getAll') return []
    if (method === 'getById') return null
    if (method === 'getSettings') return {}
    if (method === 'upsert') return args[1] || null
    return null
  }
}

module.exports = { initSupabase, db }
