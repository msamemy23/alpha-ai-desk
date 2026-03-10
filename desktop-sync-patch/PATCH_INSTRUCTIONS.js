/**
 * PATCH for alpha-desk-electron/electron/main.js
 * 
 * Add this block near the top of main.js (after requires):
 * ────────────────────────────────────────────────────────────
 */

// 1. Require the db module
const { initSupabase, db } = require('../src/db')

// 2. Load Supabase config from electron-store / settings file
// Add this right after app.whenReady():
function setupSupabase() {
  const url = process.env.SUPABASE_URL || store.get('supabaseUrl')
  const key = process.env.SUPABASE_ANON_KEY || store.get('supabaseAnonKey')
  if (url && key) {
    initSupabase(url, key)
    console.log('[Supabase] Connected:', url)
  } else {
    console.warn('[Supabase] Not configured — running in offline mode')
  }
}

// 3. IPC handlers to expose db to renderer
// Add these alongside your existing ipcMain.handle blocks:

ipcMain.handle('db-get-all', async (_, table, options) => {
  return db.getAll(table, options || {})
})

ipcMain.handle('db-get-by-id', async (_, table, id) => {
  return db.getById(table, id)
})

ipcMain.handle('db-upsert', async (_, table, record) => {
  return db.upsert(table, record)
})

ipcMain.handle('db-delete', async (_, table, id) => {
  return db.delete(table, id)
})

ipcMain.handle('db-get-settings', async () => {
  return db.getSettings()
})

ipcMain.handle('db-update-settings', async (_, updates) => {
  return db.updateSettings(updates)
})

ipcMain.handle('db-configure', async (_, { url, anonKey }) => {
  // Called from settings UI to save Supabase creds
  store.set('supabaseUrl', url)
  store.set('supabaseAnonKey', anonKey)
  initSupabase(url, anonKey)
  return { ok: true }
})

/**
 * PATCH for alpha-desk-electron/electron/preload.js
 * 
 * Add to the contextBridge.exposeInMainWorld block:
 * ────────────────────────────────────────────────────────────
 */
const dbAPI = {
  getAll: (table, options) => ipcRenderer.invoke('db-get-all', table, options),
  getById: (table, id) => ipcRenderer.invoke('db-get-by-id', table, id),
  upsert: (table, record) => ipcRenderer.invoke('db-upsert', table, record),
  delete: (table, id) => ipcRenderer.invoke('db-delete', table, id),
  getSettings: () => ipcRenderer.invoke('db-get-settings'),
  updateSettings: (updates) => ipcRenderer.invoke('db-update-settings', updates),
  configure: (config) => ipcRenderer.invoke('db-configure', config),
}

// Expose as window.cloudDB in renderer
// contextBridge.exposeInMainWorld('cloudDB', dbAPI)

/**
 * USAGE in app.js — replace localStorage calls:
 * ────────────────────────────────────────────────────────────
 * 
 * BEFORE (localStorage):
 *   const customers = JSON.parse(localStorage.getItem('customers') || '[]')
 *   localStorage.setItem('customers', JSON.stringify([...customers, newCustomer]))
 * 
 * AFTER (Supabase via IPC):
 *   const customers = await window.cloudDB.getAll('customers')
 *   await window.cloudDB.upsert('customers', newCustomer)
 * 
 * The app.js can do a gradual migration — use cloudDB if available,
 * fall back to localStorage if not configured (offline mode).
 */
