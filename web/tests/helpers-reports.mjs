// Shared fake data for the reports, accounting and inventory tests. Everything here is made up.
// Pin the clock's time zone so days from timestamps are the same on every machine.
process.env.TZ = 'America/Chicago'
import { docFrom } from '../src/lib/report-docs.ts'

/** Rows shaped like the documents table. */
export const RAW = {
  // Brake job, card payment, advisor Dana, a Camry with a VIN. Parts have costs.
  brakes: {
    id: 'd-1001', type: 'Invoice', doc_number: 'INV-1001', status: 'Paid', doc_date: '2026-10-02', created_at: '2026-10-02T15:00:00Z',
    customer_id: 'c1', customer_name: 'Maria Lopez', cashier: 'Dana', job_id: 'j1',
    vehicle_year: '2017', vehicle_make: 'Toyota', vehicle_model: 'Camry', vehicle_vin: '4T1BF1FK5HU000001',
    parts: [
      { name: 'Front brake pads', qty: 1, unitPrice: 80, taxable: true, cost: 35 },
      { name: 'Brake rotors', qty: 2, unitPrice: 60, taxable: true, cost: 30 },
    ],
    labors: [{ operation: 'Replace front brakes', tech: 'Sam', hours: 2, rate: 100 }],
    shop_supplies: 10, tax_rate: 8.25, apply_tax: true, amount_paid: 427.33, payment_method: 'card',
    signature_requested_at: '2026-09-30T12:00:00Z', signature_signed_at: '2026-10-01T09:00:00Z',
  },
  // Oil change with one flat-priced line and one part with no cost written down.
  oil: {
    id: 'd-1002', type: 'Invoice', doc_number: 'INV-1002', status: 'Paid', doc_date: '2026-10-05',
    customer_id: 'c2', customer_name: 'James Carter', cashier: 'Dana',
    vehicle_year: '2012', vehicle_make: 'Honda', vehicle_model: 'Civic', vehicle_plate: 'ABC-1234',
    parts: [
      { name: 'Oil filter', qty: 1, unitPrice: 12, taxable: true, cost: 5 },
      { name: 'Synthetic oil', qty: 5, unitPrice: 9, taxable: true },
    ],
    labors: [
      { operation: 'Oil change', tech: 'Lee', hours: 0.5, rate: 90 },
      { operation: 'Multi-point inspection', tech: 'Lee', amount: 25 },
    ],
    shop_supplies: 0, tax_rate: 8.25, apply_tax: true, amount_paid: 131.7, payment_method: 'cash',
  },
  // Open invoice with a core charge, sublet, a partial payment and no advisor. Written last month.
  alternator: {
    id: 'd-1003', type: 'Invoice', doc_number: 'INV-1003', status: 'Sent', doc_date: '2026-09-20',
    customer_id: 'c3', customer_name: 'Priya Shah', cashier: '',
    vehicle_year: '2015', vehicle_make: 'Ford', vehicle_model: 'F-150',
    parts: [{ name: 'Alternator', qty: 1, unitPrice: 210, taxable: true, cost: 120, core: 30 }],
    labors: [{ operation: 'Replace alternator', tech: 'Sam', hours: 2.5, rate: 100 }],
    sublet: 40, tax_rate: 8.25, apply_tax: true, amount_paid: 100, payment_method: 'card',
    customer_phone: '555-0103', customer_email: 'priya@example.com',
  },
  // The Camry back earlier in the month for rear brakes (so INV-1001 is a repeat visit 4 days after).
  rear: {
    id: 'd-1004', type: 'Invoice', doc_number: 'INV-1004', status: 'Paid', doc_date: '2026-09-28',
    customer_id: 'c1', customer_name: 'Maria Lopez', cashier: 'Dana',
    vehicle_year: '2017', vehicle_make: 'Toyota', vehicle_model: 'Camry', vehicle_vin: '4T1BF1FK5HU000001',
    parts: [{ name: 'Rear brake pads', qty: 1, unitPrice: 70, taxable: true, cost: 30 }],
    labors: [{ operation: 'Replace rear brake pads', tech: 'Sam', hours: 1, rate: 100 }],
    shop_supplies: 5, tax_rate: 8.25, apply_tax: true, amount_paid: 181.19, payment_method: 'card',
  },
  // The Civic back 7 days later for routine work. Not a comeback.
  oil2: {
    id: 'd-1005', type: 'Invoice', doc_number: 'INV-1005', status: 'Paid', doc_date: '2026-10-12',
    customer_id: 'c2', customer_name: 'James Carter', cashier: 'Dana',
    vehicle_year: '2012', vehicle_make: 'Honda', vehicle_model: 'Civic', vehicle_plate: 'ABC-1234',
    parts: [], labors: [{ operation: 'Oil change', tech: 'Lee', hours: 0.5, rate: 90 }],
    tax_rate: 8.25, apply_tax: true, amount_paid: 45, payment_method: 'cash',
  },
  // An old record: no doc_date, no customer id, text amounts, nothing about payment. Marked Paid but no money recorded.
  // It carries the shop's rate: a document with no tax rate at all now totals as untaxed, and none are stored that way
  // (the documents column defaults to 8.25, and none of the 185 stored documents lacked one when this was checked).
  old: {
    id: 'd-0900', type: 'Invoice', doc_number: 'INV-0900', status: 'Paid', created_at: '2026-08-15T14:00:00Z',
    customer_name: 'Walk-in', parts: [{ name: 'Spark plugs', qty: '4', unitPrice: '8.50' }], labors: [{ description: 'Tune up', amount: '150' }], tax_rate: 8.25,
  },
  draft: { id: 'd-1006', type: 'Invoice', doc_number: 'INV-1006', status: 'Draft', doc_date: '2026-10-09', customer_name: 'Pat Doe', parts: [], labors: [{ operation: 'Brake inspection', hours: 1, rate: 100 }], tax_rate: 8.25 },
  voided: { id: 'd-1007', type: 'Invoice', doc_number: 'INV-1007', status: 'Void', doc_date: '2026-10-09', customer_name: 'Pat Doe', parts: [], labors: [{ operation: 'Tire rotation', hours: 1, rate: 100 }], tax_rate: 8.25 },
  // An estimate sent for online approval and not yet answered.
  estimate: {
    id: 'e-2001', type: 'Estimate', doc_number: 'EST-2001', status: 'Sent', doc_date: '2026-10-08',
    customer_id: 'c4', customer_name: 'Omar Reyes', parts: [], labors: [{ operation: 'Replace timing belt', hours: 4, rate: 100 }],
    tax_rate: 8.25, signature_requested_at: '2026-10-08T15:00:00Z',
  },
  // A receipt (counts as a sale).
  receipt: {
    id: 'd-1008', type: 'Receipt', doc_number: 'RCT-1008', status: 'Paid', doc_date: '2026-10-13',
    customer_name: 'Walk-in', parts: [{ name: 'Wiper blades', qty: 2, unitPrice: 15, taxable: true, cost: 6 }], labors: [],
    tax_rate: 8.25, apply_tax: true, amount_paid: 32.48, payment_method: 'cash',
  },
}

export const ALL_RAW = Object.values(RAW)
export const allDocs = () => ALL_RAW.map(r => docFrom(r))

/** Payment rows as the reports read them. Some documents (old, alternator top-up) have none or a partial one. */
export const PAYMENTS = [
  { id: 'p1', docId: 'd-1001', amount: 427.33, method: 'card', date: '2026-10-02', customer: 'Maria Lopez' },
  { id: 'p2', docId: 'd-1002', amount: 131.7, method: 'cash', date: '2026-10-05', customer: 'James Carter' },
  { id: 'p3', docId: 'd-1003', amount: 100, method: 'card', date: '2026-09-20', customer: 'Priya Shah' },
  { id: 'p4', docId: 'd-1004', amount: 181.19, method: 'card', date: '2026-09-28', customer: 'Maria Lopez' },
  { id: 'p5', docId: 'd-1005', amount: 45, method: 'cash', date: '2026-10-12', customer: 'James Carter' },
  { id: 'p6', docId: 'd-1008', amount: 32.48, method: 'cash', date: '2026-10-13', customer: '' },
]

export const THIS_MONTH = { from: '2026-10-01', to: '2026-10-14' }
export const TODAY = '2026-10-14'

/** Expense rows as the database returns them. */
export const RAW_EXPENSES = [
  { id: 'x1', date: '2026-10-01', vendor: 'Fake Parts Supply', category: 'parts', amount: 800, paid_on: '2026-10-01', method: 'check', memo: 'Brake order', reference: 'FP-2210' },
  { id: 'x2', date: '2026-10-03', vendor: 'Property Co', category: 'rent', amount: 2500, paid_on: '2026-10-03', method: 'ach' },
  { id: 'x3', date: '2026-10-06', vendor: 'Fake Power Co', category: 'utilities', amount: 310.4, paid_on: null },
  { id: 'x4', date: '2026-10-08', vendor: 'Outside Machine Shop', category: 'sublet', amount: 120, paid_on: '2026-10-12', method: 'card' },
  { id: 'x5', date: '2026-09-15', vendor: 'Fake Payroll Co', category: 'payroll', amount: 4200, paid_on: '2026-09-15', method: 'ach' },
  { id: 'x6', date: '2026-10-05', vendor: 'Mistake', category: 'other', amount: 99, paid_on: null, voided_at: '2026-10-05T10:00:00Z' },
]
