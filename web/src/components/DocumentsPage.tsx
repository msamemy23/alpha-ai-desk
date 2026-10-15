'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getShopId, supabase, calcTotals } from '@/lib/supabase'
import { readWithoutMissingColumns } from '@/lib/db-missing'
import { buildPaymentSchedule, getLaborFlatAmount, nonNegativeMoney } from '@/lib/document-money'
import Sheet from '@/components/Sheet'
import DocList from './documents/DocList'
import type { ListFilter } from './documents/DocList'
import DocEditor from './documents/DocEditor'
import { DocPreview, printPreview } from './documents/DocPreview'
import { ActionsMenu, CustomerPicker, ErrorMsg, NewCustomerForm, PaymentForm, PlanForm, SendForm, SignatureForm, WarnMsg } from './documents/Dialogs'
import type { MenuItem, SigResult } from './documents/Dialogs'
import { WARRANTY_PRESETS } from './documents/warranty'
import { useShopLogo } from '@/lib/shop-logo'
import { cleanDecisions, estimateLines, findings, normalizeSections } from '@/lib/dvi'
import { docWord, isLocked } from './documents/types'
import { convertEstimate, createDocument, docAction, nextDocNumber, postPayment, saveDocumentFields } from './documents/api'
import { MONEY_FIELDS } from '@/lib/doc-write'
import type { Customer, Doc, DocType, Notice } from './documents/types'

const PAYMENT_OPERATION_STORAGE_KEY = 'alpha_ai_payment_operations_v1'

// Every dollar received is recorded and applied by one database transaction on the server (/api/documents).
async function recordPayment(
  doc: Pick<Doc, 'id' | 'shop_id'>,
  amount: number,
  method = 'unspecified',
  note = '',
  idempotencyKey: string
): Promise<{ amount_paid?: number; status?: string; balance_due?: number; total?: number } | null> {
  if (!(amount > 0)) return null
  if (!idempotencyKey?.trim()) throw new Error('Payment idempotency key is required')
  const res = await postPayment({ documentId: doc.id, amount: Math.round(amount * 100) / 100, method, note, idempotencyKey: idempotencyKey.trim() })
  if (!res.ok) throw new Error(res.error)
  return res.data.result ?? null
}

async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  } catch {
    // Cookie auth can still succeed; the API will return the real error if not.
  }
  return headers
}

interface CannedJob {
  id: string; name: string; category: string | null; description: string | null
  labor_hours: number; labor_rate: number; total_price: number
  parts: { name: string; part_number?: string; cost: number; qty: number }[] | null
}

type SheetKind = null | 'customer' | 'newcustomer' | 'send' | 'sign' | 'pay' | 'plan' | 'more' | 'preview' | 'convert' | 'delete' | 'canned'

/** Today as yyyy-mm-dd in the shop's own clock, not UTC (UTC is already "tomorrow" on a Houston evening). */
function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const errText = (e: unknown, fallback = 'Something went wrong. Try again.') => (e instanceof Error && e.message ? e.message : fallback)

export default function DocumentsPage({ type }: { type: DocType }) {
  const router = useRouter()
  const noun = docWord(type)

  /* ---------- data ---------- */
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [staff, setStaff] = useState<string[]>([])

  /* ---------- list ---------- */
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ListFilter>('all')

  /* ---------- editor ---------- */
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [form, setForm] = useState<Partial<Doc>>({})
  const [baseline, setBaseline] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [signatureImg, setSignatureImg] = useState<string | null>(null)
  const editingRef = useRef<string | null | 'new'>(null)
  useEffect(() => { editingRef.current = editing }, [editing])
  const handledLink = useRef(false)

  /* ---------- sheets ---------- */
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [target, setTarget] = useState<Doc | null>(null)
  const [busy, setBusy] = useState(false)
  const [sheetError, setSheetError] = useState('')
  const [sendSuccess, setSendSuccess] = useState('')
  const [sigResult, setSigResult] = useState<SigResult | null>(null)
  const [payDone, setPayDone] = useState<{ amount: number; balance: number } | null>(null)
  const [planForm, setPlanForm] = useState({ down_payment: 0, installments: 3, frequency: 'monthly' })
  const [canned, setCanned] = useState<CannedJob[] | null>(null)
  const [cannedError, setCannedError] = useState('')
  const [cannedQuery, setCannedQuery] = useState('')

  const paymentOperationKeys = useRef(new Map<string, string>())
  const persistPaymentOperationKeys = () => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(PAYMENT_OPERATION_STORAGE_KEY, JSON.stringify(Object.fromEntries(paymentOperationKeys.current)))
  }

  const forgetPaymentOperation = (fingerprint: string) => {
    paymentOperationKeys.current.delete(fingerprint)
    persistPaymentOperationKeys()
  }

  const getPaymentOperation = (docId: string, amount: number, method: string, operation: string) => {
    const fingerprint = `${docId}:${operation}:${Math.round(amount * 100) / 100}:${method || 'unspecified'}`
    if (!paymentOperationKeys.current.has(fingerprint) && typeof window !== 'undefined') {
      try {
        const stored = JSON.parse(window.localStorage.getItem(PAYMENT_OPERATION_STORAGE_KEY) || '{}') as Record<string, unknown>
        for (const [storedFingerprint, storedKey] of Object.entries(stored)) {
          if (typeof storedKey === 'string') paymentOperationKeys.current.set(storedFingerprint, storedKey)
        }
      } catch { /* ignore malformed local retry state */ }
    }
    let key = paymentOperationKeys.current.get(fingerprint)
    if (!key) {
      key = `document-payment-${docId}-${crypto.randomUUID()}`
      paymentOperationKeys.current.set(fingerprint, key)
      persistPaymentOperationKeys()
    }
    return { fingerprint, key }
  }

  /* ---------- the shop's own details ---------- */
  const { logo: shopLogo } = useShopLogo()
  const shopName = settings.shop_name?.trim() || ''
  const shopAddress = settings.shop_address?.trim() || ''
  const shopPhone = settings.shop_phone?.trim() || ''
  const shopEmail = settings.shop_email?.trim() || ''
  // No made-up rate: until the shop sets one, a new labor line starts at $0 an hour and the person types the rate.
  const laborRate = Number(settings.labor_rate) > 0 ? Number(settings.labor_rate) : 0
  const shopMethods = useMemo(() => String(settings.payment_methods || '').split(',').map(s => s.trim()).filter(Boolean), [settings.payment_methods])
  const formatWarrantyText = (value: unknown) => String(value || '')
    // The presets name no shop: {shop} is where this shop's own name goes.
    .replace(/\{shop\}/g, shopName || 'our shop')
    .replace(/Alpha International Auto Center/g, shopName || 'our shop')
    .replace(/Alpha's/g, `${shopName || 'our shop'}'s`)
    .replace(/\bAlpha\b/g, shopName || 'our shop')
    .replace(/10710 S\. Main St, Houston, TX 77025/g, shopAddress || 'our shop')
    .replace(/\(713\) 663-6979/g, shopPhone || 'our shop phone')

  const dirty = editing !== null && JSON.stringify(form) !== baseline
  const totals = useMemo(() => calcTotals(form as unknown as Record<string, unknown>), [form])

  /* ---------- loading ---------- */
  const load = useCallback(async (): Promise<Doc[] | null> => {
    let shopId: string | null = null
    try { shopId = await getShopId() } catch { shopId = null }
    if (!shopId) {
      setDocs([]); setCustomers([])
      setLoadError('We could not find your shop. Try refreshing, or sign out and back in.')
      setLoading(false)
      return null
    }
    const [{ data: d, error: docsError }, { data: c }, { data: s }] = await Promise.all([
      supabase.from('documents').select('*').eq('shop_id', shopId).in('type', type === 'Invoice' ? ['Invoice', 'Receipt'] : [type]).order('created_at', { ascending: false }),
      supabase.from('customers').select('id,name,phone,email,vehicle_year,vehicle_make,vehicle_model,vehicle_vin,vehicle_plate,vehicle_mileage').eq('shop_id', shopId).order('name'),
      supabase.from('settings').select('shop_name,shop_address,shop_phone,shop_email,labor_rate,tax_rate,payment_methods').eq('shop_id', shopId).maybeSingle(),
    ])
    if (docsError) {
      // Keep whatever is on screen and show the banner, so a failed refresh never looks like "you have none".
      setLoadError(`Your ${type.toLowerCase()}s could not be loaded. Check your connection and try again.`)
      setLoading(false)
      return null
    }
    const rows = (d || []) as Doc[]
    const people = (c || []) as Customer[]
    const shop = (s || {}) as Record<string, string>
    setLoadError(null)
    setDocs(rows); setCustomers(people); setSettings(shop)
    setLoading(false)

    // Links from other screens: ?document=<id> opens one, ?new=1 starts a new one.
    if (!handledLink.current && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const wanted = params.get('document')
      const wantsNew = params.get('new')
      if (wanted) {
        const hit = rows.find(r => r.id === wanted)
        if (hit) { handledLink.current = true; openDoc(hit, people) }
      } else if (wantsNew) {
        handledLink.current = true
        void openNew(shop, params.get('customer') || undefined, people, params.get('job') || undefined, params.get('dvi') || undefined)
      }
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  useEffect(() => {
    load()
    const ch = supabase.channel(`docs_${type}`).on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => { void load() }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load, type])

  useEffect(() => {
    fetch('/api/staff?role=technician').then(r => r.json()).then(d => {
      if (d?.ok && Array.isArray(d.staff)) setStaff(d.staff.map((s: { name: string }) => s.name).filter(Boolean))
    }).catch(() => { /* the tech field falls back to typing a name */ })
  }, [])

  // Leaving the page with unsaved work asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const clearNotice = useCallback(() => setNotice(null), [])
  const closeSheet = useCallback(() => { setSheet(null); setSheetError('') }, [])
  const stripLinkParams = () => {
    if (typeof window !== 'undefined' && window.location.search) window.history.replaceState(null, '', window.location.pathname)
  }

  /* ---------- opening and closing documents ---------- */
  function openDoc(d: Doc, people: Customer[] = customers) {
    const cust = people.find(c => c.id === d.customer_id)
    const next = { ...d, customer_phone: d.customer_phone || cust?.phone || '', customer_email: d.customer_email || cust?.email || '' } as Partial<Doc>
    setForm(next); setBaseline(JSON.stringify(next)); setEditing(d.id)
    setSignatureImg(null); setNotice(null)
    if (d.signature_signed_at) {
      fetch('/api/signature?documentId=' + encodeURIComponent(d.id)).then(r => r.json()).then(sig => { if (sig?.signature_data) setSignatureImg(sig.signature_data) }).catch(() => { /* the signed date still shows */ })
    }
  }

  const genDocNumber = async () => {
    const res = await nextDocNumber(type)
    if (!res.ok || typeof res.data.docNumber !== 'string') throw new Error(res.error || 'Document numbering failed')
    return res.data.docNumber
  }

  async function openNew(shop: Record<string, string> = settings, customerId?: string, people: Customer[] = customers, jobId?: string, dviId?: string) {
    setActionError(null)
    try {
      const docNumber = await genDocNumber()
      const rate = shop.tax_rate !== undefined && shop.tax_rate !== null && String(shop.tax_rate).trim() !== '' ? Number(shop.tax_rate) : NaN
      const next: Partial<Doc> = {
        type, doc_number: docNumber, doc_date: localToday(), status: 'Draft',
        tax_rate: Number.isFinite(rate) && rate >= 0 ? rate : 0, apply_tax: true,
        warranty_type: 'No Warranty', parts: [], labors: [],
      }
      // Started from a customer (for example from the schedule): fill in who and what car.
      const who = customerId ? people.find(c => c.id === customerId) : undefined
      if (who) Object.assign(next, { customer_id: who.id, customer_name: who.name, customer_phone: who.phone, customer_email: who.email, vehicle_year: who.vehicle_year, vehicle_make: who.vehicle_make, vehicle_model: who.vehicle_model, vehicle_vin: who.vehicle_vin, vehicle_plate: who.vehicle_plate, vehicle_mileage: who.vehicle_mileage })
      // Started from a job: link the paperwork to it and take the car from the job, which is the most exact record of it.
      if (jobId) {
        const shopId = await getShopId()
        const { data: job } = shopId
          ? await supabase.from('jobs').select('id,customer_id,customer_name,vehicle_year,vehicle_make,vehicle_model,vehicle_vin,vehicle_plate,vehicle_mileage').eq('id', jobId).eq('shop_id', shopId).maybeSingle()
          : { data: null }
        if (job) {
          const owner = job.customer_id ? people.find(c => c.id === job.customer_id) : undefined
          Object.assign(next, {
            job_id: job.id,
            ...(job.customer_id ? { customer_id: job.customer_id } : {}),
            customer_name: job.customer_name || owner?.name || '',
            customer_phone: owner?.phone ?? '', customer_email: owner?.email ?? '',
            vehicle_year: job.vehicle_year ?? '', vehicle_make: job.vehicle_make ?? '', vehicle_model: job.vehicle_model ?? '',
            vehicle_vin: job.vehicle_vin ?? '', vehicle_plate: job.vehicle_plate ?? '', vehicle_mileage: job.vehicle_mileage ?? '',
          })
        }
      }
      // Started from an inspection: the repairs the customer approved become the first lines.
      let carried: { count: number; priced: number } | null = null
      let carryFailed = false
      if (dviId) {
        const shopId = await getShopId()
        // The customer's answers and the customer link are newer columns; an inspection still opens without them.
        const inspResult = shopId
          ? await readWithoutMissingColumns('sections,customer_decisions,customer_name,vehicle,customer_id,job_id', ['customer_decisions', 'customer_id'], columns => supabase.from('dvi').select(columns).eq('id', dviId).eq('shop_id', shopId).maybeSingle())
          : { data: null, error: null }
        const inspError = inspResult.error
        const insp = inspResult.data as unknown as Record<string, unknown> | null
        if (inspError || !insp) carryFailed = true
        else {
          const lines = estimateLines(findings(normalizeSections(insp.sections)), cleanDecisions(insp.customer_decisions, findings(normalizeSections(insp.sections)).map(f => f.id)))
          Object.assign(next, { labors: lines.map(l => ({ operation: l.operation, tech: '', pricing: 'flat', amount: l.amount })) })
          carried = { count: lines.length, priced: lines.filter(l => l.amount > 0).length }
          if (!next.customer_name && insp.customer_name) next.customer_name = String(insp.customer_name)
          if (!next.customer_id && insp.customer_id) {
            const owner = people.find(c => c.id === insp.customer_id)
            if (owner) Object.assign(next, { customer_id: owner.id, customer_name: owner.name, customer_phone: owner.phone, customer_email: owner.email })
          }
        }
      }
      setForm(next); setBaseline(JSON.stringify(next)); setEditing('new')
      setSignatureImg(null)
      const taxUnset = !(Number.isFinite(rate) && rate >= 0)
      const laborUnset = !(laborRate > 0)
      setNotice(carried
        ? { kind: 'ok', text: carried.count === 0 ? 'The customer has not approved anything yet, so this starts empty.' : `Added ${carried.count} approved ${carried.count === 1 ? 'repair' : 'repairs'} from the inspection${carried.priced < carried.count ? `. ${carried.count - carried.priced} still need a price` : ''}. Add parts and labor, then save.` }
        : carryFailed ? { kind: 'error', text: 'The inspection could not be loaded, so this estimate starts empty.' }
        : taxUnset && laborUnset ? { kind: 'error', text: `Your shop's tax rate and labor rate are not set, so this ${noun} starts at 0% tax and new labor lines start at $0 an hour. Type them here, or set them once in Settings.` }
        : taxUnset ? { kind: 'error', text: `Your shop's tax rate is not set, so this ${noun} starts at 0% tax. Type the rate in the Tax field, or set it once in Settings.` }
        : laborUnset ? { kind: 'error', text: `Your shop's labor rate is not set, so new labor lines start at $0 an hour. Type the rate on the line, or set it once in Settings.` } : null)
    } catch (e) {
      setActionError(`Could not start a new ${noun}. ${errText(e)}`)
    }
  }

  function closeEditor() {
    setEditing(null); setForm({}); setBaseline(''); setNotice(null); setSignatureImg(null); setSheet(null)
    stripLinkParams()
  }

  const goBack = () => {
    if (dirty && !window.confirm(`Leave without saving? The changes you made to this ${noun} will be lost.`)) return
    closeEditor()
  }

  /** Patch fields only the server changes (status, payments, signatures) into the open form without marking it as edited. */
  const applyServerPatch = (patch: Partial<Doc>) => {
    setForm(f => ({ ...f, ...patch }))
    setBaseline(b => { try { return JSON.stringify({ ...JSON.parse(b), ...patch }) } catch { return b } })
  }

  const syncFromServer = (id: string, fresh: Doc[] | null) => {
    if (editingRef.current !== id) return
    const row = fresh?.find(x => x.id === id)
    if (!row) return
    applyServerPatch({
      status: row.status, amount_paid: row.amount_paid, payment_method: row.payment_method,
      signature_requested_at: row.signature_requested_at, signature_signed_at: row.signature_signed_at,
      signature_signer_name: row.signature_signer_name, payment_plan: row.payment_plan,
    })
  }

  /* ---------- warranty ---------- */
  const detectWarranty = (doc: Record<string, unknown>) => {
    const parts = ((doc.parts || []) as Record<string, unknown>[])
    const labors = ((doc.labors || []) as Record<string, unknown>[])
    const desc = [
      ...parts.map((p: Record<string, unknown>) => String(p.name || '') + ' ' + String(p.brand || '')),
      ...labors.map((l: Record<string, unknown>) => String(l.operation || '')),
      String(doc.notes || '')
    ].join(' ').toLowerCase()
    let matched = WARRANTY_PRESETS.find(p => p.label === "No Warranty")!
    if (/synthetic|full.?syn/i.test(desc) && /oil.?change|lube|oil.?service/i.test(desc)) {
      matched = WARRANTY_PRESETS.find(p => p.label.includes("Synthetic")) || matched
    } else if (/oil.?change|lube|oil.?service/i.test(desc)) {
      matched = WARRANTY_PRESETS.find(p => p.label === "Oil Change — 3 Months / 3,000 Miles") || matched
    } else if (/rebuild|engine.?rebuild|motor.?rebuild/i.test(desc)) {
      matched = WARRANTY_PRESETS.find(p => p.label.includes("Engine Rebuild")) || matched
    } else if (/engine|motor/i.test(desc)) {
      matched = WARRANTY_PRESETS.find(p => p.label.includes("Engine Repair")) || matched
    } else if (/transmission|trans\b|tranny/i.test(desc)) {
      matched = WARRANTY_PRESETS.find(p => p.label.includes("Transmission")) || matched
    } else if (/brake|rotor|caliper|pad/i.test(desc)) {
      matched = WARRANTY_PRESETS.find(p => p.label.includes("Brakes")) || matched
    } else if (/ac\b|a\/c|air.?cond|hvac|refrigerant|freon/i.test(desc)) {
      matched = WARRANTY_PRESETS.find(p => p.label.includes("AC")) || matched
    } else if (/suspension|strut|shock|spring|sway.?bar|control.?arm|ball.?joint/i.test(desc)) {
      matched = WARRANTY_PRESETS.find(p => p.label.includes("Suspension")) || matched
    } else if (/electric|wiring|alternator|starter|battery|fuse|relay|module|ecm|pcm/i.test(desc)) {
      matched = WARRANTY_PRESETS.find(p => p.label.includes("Electrical")) || matched
    } else if (/body|paint|dent|bumper|panel|collision/i.test(desc)) {
      matched = WARRANTY_PRESETS.find(p => p.label.includes("Body")) || matched
    } else if (/inspection|state.?insp/i.test(desc)) {
      matched = WARRANTY_PRESETS.find(p => p.label.includes("State Inspection")) || matched
    }
    return matched
  }

  const applyWarranty = (preset: { label: string; months: number; mileage: number; exclusions: string }) =>
    setForm(f => ({
      ...f,
      warranty_type: preset.label,
      warranty_months: preset.months || null,
      warranty_mileage: preset.mileage || null,
      warranty_exclusions: formatWarrantyText(preset.exclusions) || null,
      warranty_start: f.doc_date || localToday(),
    }))

  /* ---------- saving ---------- */
  /** Saves the open document. Returns the saved document, or null if it did not save (the editor shows why). */
  const save = async (override?: Partial<Doc>): Promise<Doc | null> => {
    if (saving) return null
    const shopId = await getShopId()
    if (!shopId) { setNotice({ kind: 'error', text: 'Not saved. No shop is linked to this sign-in. Refresh, or sign out and back in.' }); return null }
    const VALID_COLS = new Set(['type','doc_number','status','doc_date','due_date','expires_date','customer_id','customer_name','job_id','vehicle_year','vehicle_make','vehicle_model','vehicle_vin','vehicle_plate','vehicle_mileage','parts','labors','shop_supplies','sublet','tax_rate','apply_tax','deposit','payment_method','cashier','payment_terms','payment_methods','warranty_type','warranty_months','warranty_mileage','warranty_start','warranty_exclusions','warranty_claim','notes','internal_notes','locked','sent_at','created_at','updated_at','customer_phone','customer_email','signature_signed_at','signature_signer_name','signature_requested_at','line_items','payment_plan'])
    const merged = { ...form, ...(override || {}) } as Partial<Doc>
    // Drop lines nobody filled in, so a stray "Add part" tap does not print an empty row.
    // Paid and part paid documents keep their lines exactly as they are.
    if (!isLocked(merged.status)) {
      const blankPart = (p: Record<string, unknown>) => !String(p.name || '').trim() && !(Number(p.unitPrice) > 0) && !(Number(p.core) > 0)
      const blankLabor = (l: Record<string, unknown>) => !String(l.operation || '').trim() && !(Number(l.hours) > 0) && !(Number(getLaborFlatAmount(l)) > 0)
      merged.parts = ((merged.parts || []) as Record<string, unknown>[]).filter(p => !blankPart(p))
      merged.labors = ((merged.labors || []) as Record<string, unknown>[]).filter(l => !blankLabor(l))
    }
    // A document keeps its own type (a receipt stays a receipt even when it is opened from Invoices).
    const raw = { ...merged, type: merged.type || type, updated_at: new Date().toISOString() } as Record<string, unknown>
    const data: Record<string, unknown> = {}
    for (const k of Object.keys(raw)) { if (VALID_COLS.has(k)) data[k] = raw[k] }
    data.shop_id = shopId
    // Once a payment is recorded the lines, tax and totals are locked on the server. Send only what can still change
    // (customer, notes, warranty, dates) so a notes edit on a paid invoice is a normal save, not a refusal.
    if (editing !== 'new' && isLocked(merged.status)) {
      for (const field of MONEY_FIELDS) delete data[field]
    }
    // Auto-detect warranty only when creating a new document, never override on edits
    if (editing === 'new' && (!data.warranty_type || data.warranty_type === 'No Warranty')) {
      const detected = detectWarranty(data)
      if (detected && detected.label !== 'No Warranty') {
        data.warranty_type = detected.label
        data.warranty_months = detected.months || null
        data.warranty_mileage = detected.mileage || null
        data.warranty_exclusions = formatWarrantyText(detected.exclusions) || null
        data.warranty_start = (data.doc_date as string) || localToday()
      }
    }
    setSaving(true)
    try {
      let saved: Partial<Doc> = { ...merged, ...(data as Partial<Doc>) }
      if (editing === 'new') {
        // Added on the server: it checks the shop, the customer and the job, and keeps the document number.
        const result = await createDocument({ ...data, created_at: new Date().toISOString() })
        if (!result.ok) throw new Error(result.error)
        let row = result.data.document as Doc | undefined
        if (!row?.id) {
          // The save worked but did not hand the row back: find it by its number.
          const fresh = await load()
          row = fresh?.find(r => r.doc_number === data.doc_number)
        }
        if (row) saved = { ...saved, ...row }
      } else if (editing) {
        const result = await saveDocumentFields(editing, data)
        if (!result.ok) throw new Error(result.error || 'Save failed')
      }
      if (saved.id) setEditing(saved.id)
      setForm(saved); setBaseline(JSON.stringify(saved))
      setNotice({ kind: 'ok', text: 'Saved.' })
      void load()
      return saved as Doc
    } catch (e) {
      setNotice({ kind: 'error', text: `Not saved. ${errText(e, 'Check your connection and try again.')}` })
      return null
    } finally {
      setSaving(false)
    }
  }

  /** Send, sign, pay and convert all act on what is saved, so save first when there are changes. */
  const ensureSaved = async (): Promise<Doc | null> => {
    if (editing !== 'new' && !dirty) return form as Doc
    return await save()
  }

  /* ---------- customers ---------- */
  const selectCustomer = (id: string) => {
    const c = customers.find(x => x.id === id)
    if (c) setForm(f => ({ ...f, customer_id: c.id, customer_name: c.name, customer_phone: c.phone, customer_email: c.email, vehicle_year: c.vehicle_year, vehicle_make: c.vehicle_make, vehicle_model: c.vehicle_model, vehicle_vin: c.vehicle_vin, vehicle_plate: c.vehicle_plate, vehicle_mileage: c.vehicle_mileage }))
    closeSheet()
  }

  const createInlineCustomer = async (v: { name: string; email: string; phone: string }) => {
    if (!v.name.trim()) return
    setBusy(true); setSheetError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      const { data, error } = await supabase.from('customers').insert({
        shop_id: shopId,
        name: v.name.trim(),
        email: v.email.trim() || null,
        phone: v.phone.trim() || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).select().single()
      if (error) throw error
      if (data) {
        setCustomers(list => [...list, data as Customer].sort((a, b) => String(a.name).localeCompare(String(b.name))))
        setForm(f => ({ ...f, customer_id: data.id, customer_name: data.name, customer_phone: data.phone || '', customer_email: data.email || '' }))
      }
      closeSheet()
    } catch (e) { setSheetError(`Customer not added. ${errText(e)}`) }
    finally { setBusy(false) }
  }

  /* ---------- sending ---------- */
  const contactFor = (d: Doc) => {
    const customer = customers.find(c => c.id === d.customer_id)
    return { email: d.customer_email || customer?.email || '', phone: d.customer_phone || customer?.phone || '' }
  }

  const openSend = (d: Doc) => { setTarget(d); setSendSuccess(''); setSheetError(''); setSheet('send') }

  const sendDoc = async (channel: 'sms' | 'email') => {
    if (!target) return
    setSheetError(''); setSendSuccess('')
    const { email, phone } = contactFor(target)
    const to = channel === 'sms' ? phone : email
    setBusy(true)
    try {
      const res = await fetch('/api/send-document', {
        method: 'POST', headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ documentId: target.id, channel, ...(email ? { email } : {}), ...(phone ? { phone } : {}) })
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Send failed')
      }
      setSendSuccess(`${channel === 'email' ? 'Email' : 'Text message'} sent to ${to}.`)
      syncFromServer(target.id, await load())
    } catch (e) {
      setSheetError(errText(e, 'It did not send. Check your connection and try again.'))
    } finally { setBusy(false) }
  }

  /* ---------- signatures ---------- */
  const openSign = (d: Doc) => { setTarget(d); setSigResult(null); setSheetError(''); setSheet('sign') }

  const sendSignature = async () => {
    if (!target) return
    setBusy(true); setSigResult(null)
    try {
      const res = await fetch('/api/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', documentId: target.id })
      })
      const data = await res.json()
      if (data.success) {
        const email = contactFor(target).email
        setSigResult(data.emailError
          ? { type: 'partial', msg: `The signing link was made, but the email did not go out (${data.emailError}). Copy the link below and send it yourself.`, signUrl: data.signUrl }
          : { type: 'success', msg: `Signature request sent to ${email}.`, signUrl: data.signUrl })
        syncFromServer(target.id, await load())
      } else {
        setSigResult({ type: 'error', msg: data.error || 'The signature request did not send. Try again.' })
      }
    } catch {
      setSigResult({ type: 'error', msg: 'Could not reach the server. Check your connection and try again.' })
    } finally { setBusy(false) }
  }

  /* ---------- payments ---------- */
  const owedOn = (d: Doc) => {
    const t = calcTotals(d as unknown as Record<string, unknown>)
    const paid = nonNegativeMoney(d.amount_paid)
    return { total: t.total, paid, owed: Math.max(0, t.total - paid) }
  }

  const openPay = (d: Doc) => { setTarget(d); setPayDone(null); setSheetError(''); setSheet('pay') }

  const submitPay = async (rawAmount: string, method: string) => {
    const d = target
    if (!d) return
    const { total, paid, owed } = owedOn(d)
    const amount = Number.parseFloat(rawAmount.replace(/[^0-9.]/g, ''))
    if (!(amount > 0)) { setSheetError('Enter a payment greater than zero.'); return }
    if (amount > owed + 0.005) { setSheetError(`Payment cannot exceed the remaining balance of $${owed.toFixed(2)}.`); return }
    setBusy(true); setSheetError('')
    try {
      const how = method || 'unspecified'
      const operation = getPaymentOperation(d.id, amount, how, 'pay-sheet')
      const result = await recordPayment(d, amount, how, `Payment recorded from the ${d.type.toLowerCase()} screen`, operation.key)
      forgetPaymentOperation(operation.fingerprint)
      const paidTotal = Number(result?.amount_paid ?? paid + amount)
      const balance = Number(result?.balance_due ?? Math.max(0, total - paidTotal))
      setPayDone({ amount, balance })
      const fresh = await load()
      if (editingRef.current === d.id) {
        const row = fresh?.find(x => x.id === d.id)
        applyServerPatch({ status: row?.status || result?.status || (balance <= 0.005 ? 'Paid' : 'Partial'), amount_paid: row?.amount_paid ?? paidTotal, payment_method: row?.payment_method ?? how })
      }
    } catch (e) {
      // The same payment keeps the same key, so trying again can never charge twice.
      setSheetError(`${errText(e)} Nothing was recorded twice. You can try again.`)
    } finally { setBusy(false) }
  }

  /* ---------- payment plan ---------- */
  const openPlan = (d: Doc) => { setTarget(d); setPlanForm({ down_payment: 0, installments: 3, frequency: 'monthly' }); setSheetError(''); setSheet('plan') }

  const savePaymentPlan = async () => {
    if (!target) return
    setBusy(true); setSheetError('')
    try {
      if (isLocked(target.status) || Number(target.amount_paid || 0) > 0) throw new Error('A payment is already recorded, so a plan cannot be added now. Set up the plan before taking the first payment; a down payment can be recorded right after.')
      const t = calcTotals(target as unknown as Record<string, unknown>)
      const frequency = planForm.frequency === 'weekly' || planForm.frequency === 'biweekly' ? planForm.frequency : 'monthly'
      const payments = buildPaymentSchedule(t.total, 0, planForm.down_payment, planForm.installments, frequency)
      const plan = { enabled: true, down_payment: planForm.down_payment, installments: planForm.installments, frequency: planForm.frequency, payments }
      const saved = await saveDocumentFields(target.id, { payment_plan: plan })
      if (!saved.ok) throw new Error(saved.error)
      closeSheet()
      syncFromServer(target.id, await load())
      setNotice({ kind: 'ok', text: 'Payment plan saved.' })
    } catch (e) { setSheetError(`Payment plan not saved. ${errText(e)}`) }
    finally { setBusy(false) }
  }

  /* ---------- convert, duplicate, delete ---------- */
  const convertToInvoice = async () => {
    if (!form.id) return
    setBusy(true); setSheetError('')
    try {
      // The server gives the estimate its invoice number and changes it in place, so there is no duplicate.
      const converted = await convertEstimate(form.id)
      if (!converted.ok) throw new Error(converted.error)
      const id = form.id
      closeSheet(); closeEditor()
      router.push(`/invoices?document=${encodeURIComponent(id)}`)
    } catch (e) { setSheetError(`Not converted. ${errText(e)}`) }
    finally { setBusy(false) }
  }

  const duplicate = async () => {
    closeSheet()
    try {
      const number = await genDocNumber()
      const drop = new Set(['id', 'shop_id', 'created_at', 'updated_at', 'amount_paid', 'payment_method', 'payment_plan', 'signature_requested_at', 'signature_signed_at', 'signature_signer_name', 'sent_at', 'locked', 'job_id'])
      const copy = Object.fromEntries(Object.entries(form).filter(([k]) => !drop.has(k))) as Partial<Doc>
      const next: Partial<Doc> = {
        ...copy, type: (form.type as string) || type, doc_number: number, doc_date: localToday(), status: 'Draft',
        parts: ((form.parts || []) as Record<string, unknown>[]).map(p => ({ ...p, status: 'Ordered' })),
      }
      setForm(next); setBaseline(JSON.stringify(next)); setEditing('new'); setSignatureImg(null)
      setNotice({ kind: 'ok', text: `Copied into a new ${noun}. Check it, then save.` })
    } catch (e) { setNotice({ kind: 'error', text: `Could not copy. ${errText(e)}` }) }
  }

  const del = async () => {
    if (!form.id) return
    setBusy(true); setSheetError('')
    try {
      const removed = await docAction(form.id, 'delete')
      // Only an unsent draft can be removed. Anything that was sent, signed or paid stays on record, so say that plainly.
      if (!removed.ok) throw new Error(removed.status === 409 ? 'This one is kept on record, so it cannot be deleted. Only a draft that was never sent can be.' : removed.error)
      closeSheet(); closeEditor()
      await load()
    } catch (e) { setSheetError(`Not deleted. ${errText(e)}`) }
    finally { setBusy(false) }
  }

  /* ---------- canned jobs ---------- */
  const openCanned = async () => {
    setCannedQuery(''); setCannedError(''); setSheet('canned')
    if (canned) return
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop.')
      const { data, error } = await supabase.from('canned_jobs').select('id,name,category,description,labor_hours,labor_rate,total_price,parts').eq('shop_id', shopId).eq('active', true).order('name')
      if (error) throw new Error(error.message)
      setCanned((data || []) as CannedJob[])
    } catch (e) { setCannedError(errText(e, 'Your canned jobs did not load.')) }
  }

  const addCanned = (j: CannedJob) => {
    const rate = Number(j.labor_rate) > 0 ? Number(j.labor_rate) : laborRate
    const labor = Number(j.labor_hours) > 0 ? [{ operation: j.name, tech: '', hours: Number(j.labor_hours), rate }] : []
    const parts = (Array.isArray(j.parts) ? j.parts : []).map(p => ({ name: p.name, brand: '', qty: Number(p.qty) || 1, unitPrice: Number(p.cost) || 0, taxable: true, status: 'Ordered' }))
    setForm(f => ({ ...f, labors: [...((f.labors || []) as Record<string, unknown>[]), ...labor], parts: [...((f.parts || []) as Record<string, unknown>[]), ...parts] }))
    closeSheet()
    setNotice({ kind: 'ok', text: `Added ${j.name}. Check the prices, then save.` })
  }

  /* ---------- render ---------- */
  const isNew = editing === 'new'
  const docType = String(form.type || type)
  const { owed: formOwed } = owedOn(form as Doc)
  const formLocked = isLocked(form.status)

  const menuItems: MenuItem[] = [
    { key: 'preview', label: 'Preview and print', hint: 'See the paper version', icon: 'print', onClick: () => setSheet('preview') },
    ...(!isNew ? [
      { key: 'send', label: `Send ${noun}`, hint: 'Text or email it to the customer', icon: 'send', onClick: async () => { closeSheet(); const d = await ensureSaved(); if (d) openSend(d) } },
      { key: 'sign', label: 'Request signature', hint: 'Email a link the customer signs on their phone', icon: 'pen', onClick: async () => { closeSheet(); const d = await ensureSaved(); if (d) openSign(d) } },
    ] : []),
    ...(!isNew && docType !== 'Estimate' && formOwed > 0 ? [{ key: 'pay', label: 'Record payment', hint: 'Money you already received', icon: 'dollar', onClick: async () => { closeSheet(); const d = await ensureSaved(); if (d) openPay(d) } }] : []),
    ...(!isNew && docType === 'Invoice' && !formLocked ? [{ key: 'plan', label: form.payment_plan?.enabled ? 'Change payment plan' : 'Set up payment plan', hint: 'Split the balance into payments', icon: 'calendar', onClick: async () => { closeSheet(); const d = await ensureSaved(); if (d) openPlan(d) } }] : []),
    ...(!isNew && docType === 'Estimate' ? [{ key: 'convert', label: 'Turn into an invoice', hint: 'Moves it from Estimates to Invoices', icon: 'invoice', onClick: async () => { closeSheet(); const d = await ensureSaved(); if (d) { setSheetError(''); setSheet('convert') } } }] : []),
    ...(!isNew ? [{ key: 'copy', label: `Duplicate ${noun}`, hint: 'Copy the customer, vehicle and lines into a new one', icon: 'copy', onClick: duplicate }] : []),
    ...(!isNew ? [{ key: 'delete', label: `Delete ${noun}`, hint: 'Removes it for good', icon: 'trash', danger: true, onClick: () => { setSheetError(''); setSheet('delete') } }] : []),
  ]

  const filteredCanned = (canned || []).filter(j => {
    const q = cannedQuery.trim().toLowerCase()
    return !q || [j.name, j.category, j.description].some(v => String(v || '').toLowerCase().includes(q))
  })

  const doneLabel = (d: Doc) => `${docWord(d.type)} ${d.doc_number}`

  return (
    <>
      {editing === null ? (
        <DocList
          type={type}
          docs={docs}
          loading={loading}
          loadError={loadError}
          actionError={actionError}
          onDismissActionError={() => setActionError(null)}
          onRetry={() => { setLoadError(null); void load() }}
          onNew={() => { void openNew() }}
          onOpen={d => openDoc(d)}
          onQuickSend={d => openSend(d)}
          onQuickPay={d => openPay(d)}
          search={search}
          setSearch={setSearch}
          filter={filter}
          setFilter={setFilter}
        />
      ) : (
        <DocEditor
          type={type}
          isNew={isNew}
          form={form}
          setForm={setForm}
          totals={totals}
          dirty={dirty}
          saving={saving}
          notice={notice}
          onClearNotice={clearNotice}
          showUndo={(label, restore) => setNotice({ kind: 'ok', text: label, undo: restore })}
          staff={staff}
          signatureImg={signatureImg}
          warrantyLabels={WARRANTY_PRESETS.map(p => p.label)}
          laborRate={laborRate}
          onAddCanned={openCanned}
          onBack={goBack}
          onSave={() => { void save() }}
          onPickCustomer={() => { setSheetError(''); setSheet('customer') }}
          onSend={async () => { const d = await ensureSaved(); if (d) openSend(d) }}
          onSign={async () => { const d = await ensureSaved(); if (d) openSign(d) }}
          onPay={async () => { const d = await ensureSaved(); if (d) openPay(d) }}
          onPlan={async () => { const d = await ensureSaved(); if (d) openPlan(d) }}
          onConvert={async () => { const d = await ensureSaved(); if (d) { setSheetError(''); setSheet('convert') } }}
          onApprove={() => { void save({ status: 'Approved' }) }}
          onPreview={() => setSheet('preview')}
          onMore={() => setSheet('more')}
          onWarrantyPreset={label => { const p = WARRANTY_PRESETS.find(x => x.label === label); if (p) applyWarranty(p) }}
          onSuggestWarranty={() => {
            const m = detectWarranty(form as Record<string, unknown>)
            applyWarranty(m)
            setNotice({ kind: 'ok', text: m.label === 'No Warranty' ? 'Nothing in this work matches a warranty, so it is set to none.' : `Warranty set to ${m.label}.` })
          }}
        />
      )}

      {/* ---------- sheets ---------- */}
      <Sheet open={sheet === 'customer'} onClose={closeSheet} title="Choose a customer">
        <CustomerPicker customers={customers} selectedId={form.customer_id} onPick={selectCustomer} onAddNew={() => { setSheetError(''); setSheet('newcustomer') }} />
      </Sheet>

      <Sheet open={sheet === 'newcustomer'} onClose={closeSheet} title="Add a customer">
        <NewCustomerForm busy={busy} error={sheetError} onSubmit={createInlineCustomer} onCancel={() => { setSheetError(''); setSheet('customer') }} />
      </Sheet>

      <Sheet open={sheet === 'send'} onClose={closeSheet} title={`Send ${target ? docWord(target.type) : noun}`}>
        {target && (
          <SendForm
            key={target.id}
            noun={docWord(target.type)}
            docNumber={target.doc_number}
            customerName={target.customer_name}
            total={calcTotals(target as unknown as Record<string, unknown>).total}
            email={contactFor(target).email}
            phone={contactFor(target).phone}
            busy={busy}
            error={sheetError}
            success={sendSuccess}
            onSend={sendDoc}
            onClose={closeSheet}
          />
        )}
      </Sheet>

      <Sheet open={sheet === 'sign'} onClose={closeSheet} title="Request a signature">
        {target && (
          <SignatureForm
            key={target.id}
            noun={docWord(target.type)}
            isEstimate={target.type === 'Estimate'}
            docNumber={target.doc_number}
            customerName={target.customer_name}
            email={contactFor(target).email}
            total={calcTotals(target as unknown as Record<string, unknown>).total}
            signedAt={target.signature_signed_at}
            signerName={target.signature_signer_name}
            requestedAt={target.signature_requested_at}
            busy={busy}
            result={sigResult}
            onSend={sendSignature}
            onClose={closeSheet}
          />
        )}
      </Sheet>

      <Sheet open={sheet === 'pay'} onClose={closeSheet} title="Record a payment">
        {target && (() => {
          const m = owedOn(target)
          return (
            <PaymentForm
              key={target.id}
              noun={docWord(target.type)}
              docNumber={target.doc_number}
              customerName={target.customer_name}
              total={m.total}
              paid={m.paid}
              owed={m.owed}
              initialMethod={target.payment_method || shopMethods[0] || 'unspecified'}
              methods={shopMethods}
              busy={busy}
              error={sheetError}
              done={payDone}
              onSubmit={submitPay}
              onClose={closeSheet}
            />
          )
        })()}
      </Sheet>

      <Sheet open={sheet === 'plan'} onClose={closeSheet} title="Payment plan">
        {target && (
          <PlanForm
            docNumber={target.doc_number}
            total={calcTotals(target as unknown as Record<string, unknown>).total}
            form={planForm}
            setForm={fn => setPlanForm(fn)}
            busy={busy}
            error={sheetError}
            onSave={savePaymentPlan}
            onClose={closeSheet}
          />
        )}
      </Sheet>

      <Sheet open={sheet === 'more'} onClose={closeSheet} title="More actions">
        <ActionsMenu items={menuItems} />
      </Sheet>

      <Sheet open={sheet === 'preview'} onClose={closeSheet} title="Preview" wide>
        {!shopName && !shopPhone && (
          <div className="mb-3"><WarnMsg>Your shop name and phone are not set, so they are missing from the paper. Add them in Settings, under Shop info.</WarnMsg></div>
        )}
        <div className="max-h-[62dvh] overflow-y-auto overscroll-contain">
          <DocPreview
            form={form}
            type={docType}
            totals={totals}
            shopName={shopName}
            shopAddress={shopAddress}
            shopPhone={shopPhone}
            shopEmail={shopEmail}
            paymentMethods={String(settings.payment_methods || '')}
            logo={shopLogo}
            signatureImg={signatureImg}
            formatWarrantyText={formatWarrantyText}
          />
        </div>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={closeSheet}>Close</button>
          <button type="button" className="btn btn-primary" onClick={() => printPreview(String(form.doc_number || docType))}>Print or save as PDF</button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'convert'} onClose={closeSheet} title="Turn into an invoice">
        <p className="text-[0.9375rem]">
          Estimate {form.doc_number} for {form.customer_name || 'this customer'} becomes a new invoice with its own number. It leaves Estimates and moves to Invoices. Nothing is sent to the customer.
        </p>
        {sheetError && <div className="mt-3"><ErrorMsg>{sheetError}</ErrorMsg></div>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={closeSheet} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={convertToInvoice} disabled={busy}>{busy ? 'Converting…' : 'Turn into invoice'}</button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'delete'} onClose={closeSheet} title={`Delete ${noun}?`}>
        <p className="text-[0.9375rem]">
          {docWord(docType)[0].toUpperCase() + docWord(docType).slice(1)} {form.doc_number}{form.customer_name ? ` for ${form.customer_name}` : ''} will be removed for good. This cannot be undone.
        </p>
        {sheetError && <div className="mt-3"><ErrorMsg>{sheetError}</ErrorMsg></div>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={closeSheet} disabled={busy}>Keep it</button>
          <button type="button" className="btn btn-danger" onClick={del} disabled={busy}>{busy ? 'Deleting…' : `Delete ${noun}`}</button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'canned'} onClose={closeSheet} title="Add a canned job">
        {cannedError ? (
          <div>
            <ErrorMsg>{cannedError}</ErrorMsg>
            <button type="button" className="btn btn-secondary mt-3" onClick={() => { setCanned(null); void openCanned() }}>Try again</button>
          </div>
        ) : canned === null ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading canned jobs">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-14" />)}</div>
        ) : canned.length === 0 ? (
          <p className="py-6 text-center text-[0.9375rem] text-text-secondary">
            No canned jobs yet. Save the jobs you quote often, like a brake job or an oil change, in <a className="text-blue underline" href="/canned-jobs">Canned jobs</a>, and add them here in one tap.
          </p>
        ) : (
          <div>
            <input type="search" className="form-input" placeholder="Search canned jobs" aria-label="Search canned jobs" value={cannedQuery} onChange={e => setCannedQuery(e.target.value)} />
            {filteredCanned.length === 0 ? (
              <p className="py-6 text-center text-[0.9375rem] text-text-secondary">No canned job matches “{cannedQuery.trim()}”.</p>
            ) : (
              <ul className="ledger mt-3 max-h-[50dvh] overflow-y-auto">
                {filteredCanned.map(j => {
                  const n = Array.isArray(j.parts) ? j.parts.length : 0
                  return (
                    <li key={j.id}>
                      <button type="button" className="ledger-row" onClick={() => addCanned(j)}>
                        <span className="ledger-main">
                          <span className="ledger-title block">{j.name}</span>
                          <span className="ledger-sub block">{[j.category, `${Number(j.labor_hours) || 0} h labor`, n > 0 ? `${n} ${n === 1 ? 'part' : 'parts'}` : ''].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="ledger-amt">{Number(j.total_price) > 0 ? '$' + Number(j.total_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </Sheet>

      {/* keeps doneLabel referenced for screen readers announcing the last action */}
      <span className="sr-only" aria-live="polite">{target && sendSuccess ? `${doneLabel(target)} sent` : ''}</span>
    </>
  )
}
