import { calcTotals } from '@/lib/supabase'

export type DocType = 'Estimate' | 'Invoice' | 'Receipt'

export interface Customer { id: string; name: string; phone: string; email: string; vehicle_year: string; vehicle_make: string; vehicle_model: string; vehicle_vin: string; vehicle_plate: string; vehicle_mileage: string }

export interface PaymentPlan { enabled: boolean; down_payment: number; installments: number; frequency: string; payments: { date: string; amount: number; paid: boolean }[] }

export interface Doc { id: string; type: string; doc_number: string; status: string; shop_id?: string; doc_date: string; customer_name: string; customer_id: string; customer_phone?: string; customer_email?: string; signature_requested_at?: string; signature_signed_at?: string; signature_signer_name?: string; vehicle_year: string; vehicle_make: string; vehicle_model: string; vehicle_vin?: string; vehicle_plate?: string; vehicle_mileage?: string | number; parts: Record<string,unknown>[]; labors: Record<string,unknown>[]; tax_rate: number; apply_tax: boolean; shop_supplies: number; deposit: number; notes: string; warranty_type: string; warranty_months: number | null; warranty_mileage: number | null; warranty_start: string | null; warranty_exclusions: string | null; payment_terms: string; payment_methods: string; amount_paid: number; payment_method: string; created_at: string; payment_plan?: PaymentPlan; expires_date?: string | null; due_date?: string | null; internal_notes?: string; sent_at?: string | null; updated_at?: string; job_id?: string | null; warranty_claim?: string | null }

export type Totals = ReturnType<typeof calcTotals>
export type Line = Record<string, unknown>

/** A short message shown above the bottom bar of the editor (saved, failed, undo). */
export interface Notice { kind: 'ok' | 'error'; text: string; undo?: () => void }

/** Paid and part-paid documents are locked by the database: lines, tax and totals cannot change. */
export const isLocked = (status: string | undefined) => status === 'Paid' || status === 'Partial'

export const docCar = (d: { vehicle_year?: unknown; vehicle_make?: unknown; vehicle_model?: unknown }) =>
  [d.vehicle_year, d.vehicle_make, d.vehicle_model].filter(Boolean).join(' ')

/** "Oct 13, 2026" from a yyyy-mm-dd string. */
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export const docWord = (type: string) => (type === 'Estimate' ? 'estimate' : type === 'Receipt' ? 'receipt' : 'invoice')

/** A saved job the shop quotes often (the base fields; the extras live beside them). */
export interface CannedJob {
  id: string; name: string; category: string | null; description: string | null
  labor_hours: number; labor_rate: number; total_price: number
  parts: { name: string; part_number?: string; cost: number; qty: number }[] | null
}

export const PAYMENT_METHODS = ['Cash', 'Card', 'Zelle', 'Check', 'Cash App', 'Other']
