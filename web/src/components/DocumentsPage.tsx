'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase, calcTotals, formatCurrency } from '@/lib/supabase'

interface Customer { id: string; name: string; phone: string; email: string; vehicle_year: string; vehicle_make: string; vehicle_model: string; vehicle_vin: string; vehicle_plate: string; vehicle_mileage: string }
interface Doc { id: string; type: string; doc_number: string; status: string; doc_date: string; customer_name: string; customer_id: string; vehicle_year: string; vehicle_make: string; vehicle_model: string; parts: Record<string,unknown>[]; labors: Record<string,unknown>[]; tax_rate: number; apply_tax: boolean; shop_supplies: number; deposit: number; notes: string; warranty_type: string; warranty_months: number | null; warranty_mileage: number | null; warranty_start: string | null; warranty_exclusions: string | null; payment_terms: string; payment_methods: string; amount_paid: number; payment_method: string; created_at: string; payment_plan?: { enabled: boolean; down_payment: number; installments: number; frequency: string; payments: { date: string; amount: number; paid: boolean }[] } }

const WARRANTY_PRESETS = [
  {
    label: 'No Warranty',
    months: 0,
    mileage: 0,
    exclusions: ''
  },
  {
    label: 'Oil Change — 3 Months / 3,000 Miles',
    months: 3,
    mileage: 3000,
    exclusions: `LIMITED WARRANTY: The oil change service performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. This warranty covers defects in materials and workmanship for the oil change service, including the oil filter and motor oil installed, for a period of 3 months or 3,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will re-perform the oil change service or replace defective materials at no additional cost, provided the vehicle is returned to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs performed by any other facility without prior written authorization from Alpha will void this warranty immediately.

EXCLUSIONS: This warranty does not cover: (a) pre-existing engine leaks, oil consumption, or internal engine wear; (b) damage caused by use of non-recommended oil grade, viscosity, or filter after the warranted service; (c) engine damage resulting from neglect, overheating, coolant contamination, or failure to maintain proper fluid levels; (d) damage caused by accident, collision, misuse, abuse, negligence, or unauthorized modification; (e) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, property damage, business interruption, or any other costs of any kind; (f) customer-supplied parts or fluids. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Brakes — 12 Months / 12,000 Miles',
    months: 12,
    mileage: 12000,
    exclusions: `LIMITED WARRANTY: The brake repair service performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the brake components replaced (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 12 months or 12,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace defective brake components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs, diagnostics, or adjustments performed by any other facility without prior written authorization from Alpha will immediately void this warranty in its entirety, and Alpha shall have no further obligation.

EXCLUSIONS: This warranty does not cover: (a) normal wear and tear of brake pads, shoes, rotors, or drums; (b) brake noise, vibration, or pulsation caused by normal wear, road conditions, or driving habits; (c) damage caused by accident, collision, misuse, abuse, negligence, improper driving habits (excessive braking, riding the brakes), or unauthorized modification; (d) brake system failures caused by hydraulic leaks, ABS module failures, or other components not replaced under this invoice; (e) vehicles used for commercial, racing, towing, or off-road purposes unless expressly noted on the invoice; (f) pre-existing conditions or failures in unrelated vehicle systems; (g) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, property damage, business interruption, or any other costs of any kind; (h) customer-supplied or used parts. Alpha reserves the right to warranty wear items (brake pads, shoes, rotors) at its sole discretion. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Engine Repair — 12 Months / 12,000 Miles',
    months: 12,
    mileage: 12000,
    exclusions: `LIMITED WARRANTY: The engine repair service performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the specific engine components repaired or replaced (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 12 months or 12,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace the specific defective engine components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs, diagnostics, or service performed by any other facility without prior written authorization from Alpha will immediately void this warranty in its entirety.

EXCLUSIONS: This warranty does not cover: (a) engine components, sensors, or systems not specifically repaired or replaced on this invoice; (b) damage caused by overheating, coolant loss, oil starvation, or failure to maintain proper fluid levels and scheduled maintenance; (c) pre-existing conditions, sludge buildup, or internal engine wear not addressed in the original repair; (d) damage caused by accident, collision, flood, misuse, abuse, negligence, or unauthorized modification including aftermarket performance parts, tuning, or engine swaps; (e) head gasket failure caused by overheating events occurring after the repair; (f) vehicles used for commercial, racing, towing, or off-road purposes unless expressly noted; (g) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, property damage, business interruption, or any other costs of any kind; (h) customer-supplied or used parts. The customer must follow all recommended maintenance schedules and return for any required follow-up inspections noted on the invoice. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Engine Rebuild — 24 Months / 24,000 Miles',
    months: 24,
    mileage: 24000,
    exclusions: `LIMITED WARRANTY: The engine rebuild performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the internal engine components replaced during the rebuild (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 24 months or 24,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace defective internal engine components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs, diagnostics, or service performed by any other facility without prior written authorization from Alpha will immediately void this warranty in its entirety, and Alpha shall have no further obligation.

MANDATORY MAINTENANCE: The customer must adhere to the following maintenance schedule to maintain warranty coverage: oil and filter changes every 3,000 miles or 3 months (whichever comes first) using the oil grade and viscosity specified on this invoice. Failure to maintain proper oil change intervals, or use of non-recommended oil or filters, will void this warranty. Customer must retain all maintenance receipts as proof of compliance.

EXCLUSIONS: This warranty does not cover: (a) external engine components, accessories, sensors, wiring, exhaust, or systems not specifically rebuilt or replaced on this invoice; (b) damage caused by overheating, coolant system failure, oil starvation, or failure to maintain proper fluid levels; (c) pre-existing conditions in unrelated vehicle systems (transmission, electrical, cooling system) that cause engine damage; (d) damage caused by accident, collision, flood, misuse, abuse, negligence, or unauthorized modification including aftermarket performance parts, tuning, nitrous oxide, superchargers, turbo kits, or engine swaps; (e) vehicles used for commercial, racing, towing, or off-road purposes unless expressly noted; (f) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, death, property damage, business interruption, or any other costs of any kind; (g) customer-supplied or used parts; (h) damage resulting from failure to complete required follow-up inspections. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Transmission Repair — 12 Months / 12,000 Miles',
    months: 12,
    mileage: 12000,
    exclusions: `LIMITED WARRANTY: The transmission repair performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the specific transmission components repaired or replaced (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 12 months or 12,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace the specific defective transmission components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs, diagnostics, or service performed by any other facility without prior written authorization from Alpha will immediately void this warranty in its entirety.

EXCLUSIONS: This warranty does not cover: (a) transmission components, solenoids, sensors, or systems not specifically repaired or replaced on this invoice; (b) damage caused by fluid neglect, use of incorrect transmission fluid, or failure to maintain proper fluid levels; (c) damage caused by towing abuse, excessive payload, or operating the vehicle beyond its rated capacity; (d) pre-existing conditions, internal wear, or contamination not addressed in the original repair; (e) damage caused by accident, collision, flood, misuse, abuse, negligence, or unauthorized modification; (f) vehicles used for commercial, racing, towing, or off-road purposes unless expressly noted; (g) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, property damage, business interruption, or any other costs of any kind; (h) customer-supplied or used parts. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Transmission Rebuild — 24 Months / 24,000 Miles',
    months: 24,
    mileage: 24000,
    exclusions: `LIMITED WARRANTY: The transmission rebuild performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the internal transmission components replaced during the rebuild (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 24 months or 24,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace defective internal transmission components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs, diagnostics, or service performed by any other facility without prior written authorization from Alpha will immediately void this warranty in its entirety.

MANDATORY MAINTENANCE: The customer must adhere to the recommended transmission fluid change interval of every 30,000 miles or as specified on this invoice. Failure to maintain proper fluid change intervals or use of non-recommended fluid will void this warranty. Customer must retain all maintenance receipts as proof of compliance.

EXCLUSIONS: This warranty does not cover: (a) external transmission components, cooler lines, mounts, sensors, or systems not specifically rebuilt or replaced on this invoice; (b) damage caused by fluid neglect, contamination, or use of incorrect transmission fluid; (c) damage caused by towing abuse, excessive payload, racing, or operating the vehicle beyond its rated capacity; (d) pre-existing conditions in unrelated vehicle systems (engine, electrical, cooling) that cause transmission damage; (e) damage caused by accident, collision, flood, misuse, abuse, negligence, or unauthorized modification; (f) vehicles used for commercial purposes unless expressly noted; (g) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, death, property damage, business interruption, or any other costs of any kind; (h) customer-supplied or used parts. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Electrical / Diagnostics — 6 Months / 6,000 Miles',
    months: 6,
    mileage: 6000,
    exclusions: `LIMITED WARRANTY: The electrical/diagnostic repair performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the specific electrical components or sensors replaced (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 6 months or 6,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace defective electrical components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs or service performed by any other facility without prior written authorization from Alpha will immediately void this warranty.

EXCLUSIONS: This warranty does not cover: (a) electrical components, wiring, modules, or sensors not specifically replaced on this invoice; (b) damage caused by water intrusion, rodent damage, corrosion, or wiring harness failures unrelated to the repair; (c) aftermarket electrical accessories, stereos, alarms, remote starters, or lighting modifications that affect the repaired system; (d) intermittent electrical faults that cannot be replicated during diagnosis; (e) damage caused by jump-starting, incorrect battery installation, or electrical surges; (f) pre-existing conditions or failures in unrelated vehicle systems; (g) damage caused by accident, collision, flood, misuse, abuse, negligence, or unauthorized modification; (h) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, property damage, or any other costs of any kind; (i) customer-supplied parts. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Suspension — 12 Months / 12,000 Miles',
    months: 12,
    mileage: 12000,
    exclusions: `LIMITED WARRANTY: The suspension repair performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the specific suspension components replaced (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 12 months or 12,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace defective suspension components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs or service performed by any other facility without prior written authorization will void this warranty.

EXCLUSIONS: This warranty does not cover: (a) wheel alignment services — alignment is a separate service and is not warranted against future misalignment; (b) tire wear, tire damage, or uneven tire wear regardless of cause; (c) suspension components not specifically replaced on this invoice; (d) damage caused by road hazards, potholes, curb strikes, speed bumps, or off-road driving; (e) damage caused by accident, collision, misuse, abuse, negligence, vehicle overloading, or unauthorized modification including lift kits and lowering kits; (f) noise or vibration caused by normal wear or unrelated components; (g) vehicles used for commercial, racing, towing, or off-road purposes unless expressly noted; (h) pre-existing conditions or failures in unrelated vehicle systems; (i) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, property damage, or any other costs of any kind; (j) customer-supplied or used parts. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'AC / Heating — 6 Months / 6,000 Miles',
    months: 6,
    mileage: 6000,
    exclusions: `LIMITED WARRANTY: The AC/heating repair performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the specific AC/heating components repaired or replaced (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 6 months or 6,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace the specific defective AC/heating components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs or service performed by any other facility without prior written authorization will void this warranty.

EXCLUSIONS: This warranty does not cover: (a) AC/heating components not specifically repaired or replaced on this invoice; (b) refrigerant leaks originating from components not serviced under this invoice; (c) compressor failure caused by pre-existing contamination, debris, or system neglect not addressed in the original repair; (d) cabin air filters, blend door actuators, or ductwork not replaced under this invoice; (e) reduced cooling performance caused by clogged condenser, radiator fan failure, or engine overheating; (f) damage caused by accident, collision, misuse, abuse, negligence, or unauthorized modification; (g) vehicles used for commercial purposes unless expressly noted; (h) pre-existing conditions or failures in unrelated vehicle systems; (i) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, property damage, or any other costs of any kind; (j) customer-supplied parts. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Body & Paint — 6 Months (Cosmetic)',
    months: 6,
    mileage: 0,
    exclusions: `LIMITED WARRANTY: The body and paint work performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the specific body and paint work performed (as documented on this invoice) will be free from defects in workmanship for a period of 6 months from the date on this invoice.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, re-perform the defective body or paint work at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed.

EXCLUSIONS: This warranty does not cover: (a) rock chips, scratches, dents, or physical damage occurring after the repair; (b) paint fading, discoloration, or oxidation caused by sun exposure, weather, chemicals, bird droppings, tree sap, or environmental contamination; (c) damage caused by improper washing techniques, automatic car washes, abrasive cleaners, or failure to maintain the finish; (d) paint or body work on panels or areas not documented on this invoice; (e) color matching variations that are within industry-accepted tolerances; (f) rust or corrosion originating from areas not treated during the repair; (g) damage caused by accident, collision, vandalism, misuse, abuse, or negligence; (h) consequential or incidental damages including but not limited to vehicle rental, lost wages, personal injury, property damage, or any other costs of any kind. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'State Inspection — No Warranty',
    months: 0,
    mileage: 0,
    exclusions: ''
  },
  {
    label: 'General Repair — 12 Months / 12,000 Miles',
    months: 12,
    mileage: 12000,
    exclusions: `LIMITED WARRANTY: The repair service performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that all parts and labor sold in connection with the services documented on this invoice will be free from defects in materials and workmanship under normal, non-commercial use for a period of 12 months or 12,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, with reasonable promptness and subject to parts availability, repair or replace at its sole discretion any defective parts or components covered under this invoice and perform any labor reasonably necessary to complete such repair at no additional cost. The customer must deliver the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs, diagnostics, or service performed by any other facility without prior written authorization from Alpha will immediately void this warranty in its entirety, and Alpha shall have no further obligation to honor this warranty.

EXCLUSIONS: This warranty does not cover, nor extend to: (a) any repairs, replacements, or service made necessary by accident, collision, misuse, abuse, negligence, neglect, or any cause other than normal use and operation of the vehicle; (b) any parts, components, or systems not specifically repaired or replaced as documented on this invoice; (c) pre-existing conditions, wear, or failures in unrelated vehicle systems; (d) damage resulting from unauthorized modifications, tampering, or alteration to the warranted repair by anyone other than Alpha; (e) used parts purchased at customer's request or parts supplied by the customer; (f) vehicles used for commercial, racing, towing, or off-road purposes unless expressly noted on the invoice; (g) customer's towing charges, car rental, lodging, lost wages, interruption of business, personal injury, death, property damage, or any other charges, damages, liability, or costs of any kind whatsoever, whether incidental or consequential; (h) any repairs or replacements made by another repair facility without prior written authorization from Alpha.

GENERAL PROVISIONS: Should any tampering or alteration to the warranted repair or service be evident, all rights under this warranty shall immediately terminate and be void. This warranty is in lieu of and Alpha hereby expressly disclaims any and all other warranties, either express or implied, including without limitation any implied warranty of merchantability or fitness for a particular purpose. This limited warranty may not be altered or modified except in writing signed by the customer and an authorized representative of Alpha International Auto Center.`
  },
  {
    label: 'Custom Warranty',
    months: 0,
    mileage: 0,
    exclusions: ''
  },
]

function getStatuses(type: string) {
  if (type === 'Receipt') return ['Draft','Paid']
  if (type === 'Invoice') return ['Draft','Sent','Unpaid','Partial','Paid']
  return ['Draft','Sent','Approved']
}

export default function DocumentsPage({ type }: { type: 'Estimate'|'Invoice'|'Receipt' }) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [form, setForm] = useState<Partial<Doc>>({})
  const [search, setSearch] = useState('')
  const [sendModal, setSendModal] = useState<Doc | null>(null)
  // Feature 13: Payment Plan
  const [planModal, setPlanModal] = useState<Doc | null>(null)
  const [planForm, setPlanForm] = useState({ down_payment: 0, installments: 3, frequency: 'monthly' })
  const [emailSending, setEmailSending] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: d }, { data: c }] = await Promise.all([
      supabase.from('documents').select('*').eq('type', type).order('created_at', { ascending: false }),
      supabase.from('customers').select('id,name,phone,email,vehicle_year,vehicle_make,vehicle_model,vehicle_vin,vehicle_plate,vehicle_mileage').order('name')
    ])
    setDocs((d || []) as Doc[]); setCustomers((c || []) as Customer[])
  }, [type])

  useEffect(() => {
    load()
    const ch = supabase.channel(`docs_${type}`).on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load, type])

  const genDocNumber = async () => {
    const prefix = type === 'Estimate' ? 'EST' : type === 'Invoice' ? 'INV' : 'REC'
    const year = new Date().getFullYear()
    const { data } = await supabase.from('documents').select('doc_number').eq('type', type).like('doc_number', `${prefix}-${year}-%`)
    const nums = (data || []).map((d: Record<string,string>) => parseInt(d.doc_number.split('-').pop() || '0'))
    const next = Math.max(0, ...nums) + 1
    return `${prefix}-${year}-${String(next).padStart(4,'0')}`
  }

  const openNew = async () => {
    const docNumber = await genDocNumber()
    setForm({ type, doc_number: docNumber, doc_date: new Date().toISOString().split('T')[0], status: 'Draft', tax_rate: 8.25, apply_tax: true, warranty_type: 'No Warranty', parts: [], labors: [] })
    setEditing('new')
  }

  const save = async () => {
    const data = { ...form, type, updated_at: new Date().toISOString() }
    if (editing === 'new') await supabase.from('documents').insert({ ...data, created_at: new Date().toISOString() })
    else if (editing) await supabase.from('documents').update(data).eq('id', editing)
    setEditing(null); setForm({}); load()
  }

  const del = async () => {
    if (!editing || editing === 'new') return
    if (!confirm('Delete?')) return
    await supabase.from('documents').delete().eq('id', editing)
    setEditing(null); setForm({}); load()
  }

  const selectCustomer = (id: string) => {
    const c = customers.find(c => c.id === id)
    if (c) setForm(f => ({ ...f, customer_id: c.id, customer_name: c.name, vehicle_year: c.vehicle_year, vehicle_make: c.vehicle_make, vehicle_model: c.vehicle_model, vehicle_vin: c.vehicle_vin, vehicle_plate: c.vehicle_plate, vehicle_mileage: c.vehicle_mileage }))
  }

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const filtered = docs.filter(d => !search || [d.doc_number, d.customer_name, d.status].some(v => (v||'').toLowerCase().includes(search.toLowerCase())))
  const totals = form ? calcTotals(form as Record<string,unknown>) : null
  const fmt = (d: string) => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'

  const statusColor: Record<string,string> = { Draft:'tag-gray', Sent:'tag-blue', Approved:'tag-green', Unpaid:'tag-red', Partial:'tag-amber', Paid:'tag-green' }

  const sendDoc = async (channel: 'sms'|'email') => {
    if (!sendModal) return
    const customer = customers.find(c => c.id === sendModal.customer_id)
    const to = channel === 'sms' ? customer?.phone : customer?.email
    if (!to) return alert(`No ${channel === 'sms' ? 'phone' : 'email'} on file`)
    await fetch('/api/send-document', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: sendModal.id, channel, [channel === 'sms' ? 'phone' : 'email']: to })
    })
    setSendModal(null); load()
  }

  // Feature 9: Quick email to customer from list
  const quickEmail = async (doc: Doc) => {
    const customer = customers.find(c => c.id === doc.customer_id)
    if (!customer?.email) return alert('No email on file for this customer')
    setEmailSending(doc.id)
    try {
      await fetch('/api/send-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: doc.id, channel: 'email', email: customer.email })
      })
    } catch { alert('Failed to send email') }
    finally { setEmailSending(null); load() }
  }

  // Feature 13: Save payment plan
  const savePaymentPlan = async () => {
    if (!planModal) return
    const t = calcTotals(planModal as unknown as Record<string,unknown>)
    const remaining = t.total - planForm.down_payment
    const perPayment = remaining / planForm.installments
    const payments: { date: string; amount: number; paid: boolean }[] = []
    const freqDays = planForm.frequency === 'weekly' ? 7 : planForm.frequency === 'biweekly' ? 14 : 30
    for (let i = 0; i < planForm.installments; i++) {
      const d = new Date()
      d.setDate(d.getDate() + freqDays * (i + 1))
      payments.push({ date: d.toISOString().split('T')[0], amount: Math.round(perPayment * 100) / 100, paid: false })
    }
    const plan = { enabled: true, down_payment: planForm.down_payment, installments: planForm.installments, frequency: planForm.frequency, payments }
    await supabase.from('documents').update({ payment_plan: plan, updated_at: new Date().toISOString() }).eq('id', planModal.id)
    setPlanModal(null); load()
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      {editing !== null ? (
        /* Doc Form */
        <div className="flex flex-col lg:grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <h1 className="text-xl sm:text-2xl font-bold">{editing === 'new' ? `New ${type}` : `Edit ${type}`}</h1>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-secondary" onClick={()=>{setEditing(null);setForm({})}}>← Back</button>
                <button className="btn btn-primary" onClick={save}>Save {type}</button>
                {editing !== 'new' && <button className="btn btn-danger" onClick={del}>Delete</button>}
                {editing !== 'new' && <button className="btn btn-secondary" onClick={() => setSendModal(form as Doc)}>Send</button>}
                {editing !== 'new' && type === 'Invoice' && <button className="btn btn-secondary" onClick={() => setPlanModal(form as Doc)}>Payment Plan</button>}
              </div>
            </div>

            {/* Header fields */}
            <div className="card grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div><label className="form-label">Doc #</label><input className="form-input opacity-60" readOnly value={form.doc_number||''} /></div>
              <div><label className="form-label">Status</label>
                <select className="form-select" value={form.status||'Draft'} onChange={sf('status')}>
                  {getStatuses(type).map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div><label className="form-label">Date</label><input className="form-input" type="date" value={form.doc_date||''} onChange={sf('doc_date')} /></div>
              <div className="sm:col-span-2"><label className="form-label">Customer</label>
                <select className="form-select" value={(form as Record<string,string>).customer_id||''} onChange={e => selectCustomer(e.target.value)}>
                  <option value="">Select customer...</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="form-label">Tax Rate %</label><input className="form-input" type="number" step="0.01" value={form.tax_rate||8.25} onChange={sf('tax_rate')} /></div>
            </div>

            {/* Vehicle */}
            <div className="card grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-3 text-xs font-bold uppercase tracking-wider text-text-secondary">Vehicle</div>
              {['vehicle_year','vehicle_make','vehicle_model','vehicle_vin','vehicle_plate','vehicle_mileage'].map(k => (
                <div key={k}><label className="form-label">{k.split('_').pop()!.charAt(0).toUpperCase()+k.split('_').pop()!.slice(1)}</label><input className="form-input" value={(form as Record<string,string>)[k]||''} onChange={sf(k)} /></div>
              ))}
            </div>

            {/* Parts */}
            <div className="card overflow-x-auto">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Parts</div>
              <div className="space-y-2 min-w-[600px]">
                {((form.parts||[]) as Record<string,unknown>[]).map((p,i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input className="form-input col-span-4" placeholder="Part name" value={p.name as string||''} onChange={e => { const p2=[...((form.parts||[]) as Record<string,unknown>[])]; p2[i]={...p2[i],name:e.target.value}; setForm(f=>({...f,parts:p2})) }} />
                    <input className="form-input col-span-2" placeholder="Brand" value={p.brand as string||''} onChange={e => { const p2=[...((form.parts||[]) as Record<string,unknown>[])]; p2[i]={...p2[i],brand:e.target.value}; setForm(f=>({...f,parts:p2})) }} />
                    <input className="form-input col-span-1" type="number" placeholder="Qty" value={p.qty as number||1} onChange={e => { const p2=[...((form.parts||[]) as Record<string,unknown>[])]; p2[i]={...p2[i],qty:Number(e.target.value)}; setForm(f=>({...f,parts:p2})) }} />
                    <input className="form-input col-span-2" type="number" step="0.01" placeholder="Price" value={p.unitPrice as number||0} onChange={e => { const p2=[...((form.parts||[]) as Record<string,unknown>[])]; p2[i]={...p2[i],unitPrice:Number(e.target.value)}; setForm(f=>({...f,parts:p2})) }} />
                    <div className="col-span-1 flex items-center gap-1"><input type="checkbox" checked={p.taxable !== false} onChange={e => { const p2=[...((form.parts||[]) as Record<string,unknown>[])]; p2[i]={...p2[i],taxable:e.target.checked}; setForm(f=>({...f,parts:p2})) }} /><span className="text-xs">Tax</span></div>
                    <div className="col-span-1 text-right text-sm">{formatCurrency((Number(p.qty)||1)*(Number(p.unitPrice)||0))}</div>
                    <button className="col-span-1 btn btn-danger btn-sm" onClick={() => setForm(f=>({...f,parts:((f.parts||[]) as Record<string,unknown>[]).filter((_,j)=>j!==i)}))}>✕</button>
                  </div>
                ))}
                <button className="btn btn-secondary btn-sm mt-2" onClick={() => setForm(f=>({...f,parts:[...((f.parts||[]) as Record<string,unknown>[]),{name:'',brand:'',qty:1,unitPrice:0,taxable:true,status:'Ordered'}]}))}>+ Add Part</button>
              </div>
            </div>

            {/* Labor */}
            <div className="card overflow-x-auto">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Labor</div>
              <div className="space-y-2 min-w-[600px]">
                {((form.labors||[]) as Record<string,unknown>[]).map((l,i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input className="form-input col-span-5" placeholder="Operation" value={l.operation as string||''} onChange={e => { const l2=[...((form.labors||[]) as Record<string,unknown>[])]; l2[i]={...l2[i],operation:e.target.value}; setForm(f=>({...f,labors:l2})) }} />
                    <select className="form-select col-span-2" value={l.tech as string||''} onChange={e => { const l2=[...((form.labors||[]) as Record<string,unknown>[])]; l2[i]={...l2[i],tech:e.target.value}; setForm(f=>({...f,labors:l2})) }}>
                      <option value="">—</option>{['Paul','Devin','Luis','Louie'].map(t=><option key={t}>{t}</option>)}
                    </select>
                    <input className="form-input col-span-1" type="number" step="0.5" placeholder="Hrs" value={l.hours as number||0} onChange={e => { const l2=[...((form.labors||[]) as Record<string,unknown>[])]; l2[i]={...l2[i],hours:Number(e.target.value)}; setForm(f=>({...f,labors:l2})) }} />
                    <input className="form-input col-span-2" type="number" step="0.01" placeholder="Rate" value={l.rate as number||120} onChange={e => { const l2=[...((form.labors||[]) as Record<string,unknown>[])]; l2[i]={...l2[i],rate:Number(e.target.value)}; setForm(f=>({...f,labors:l2})) }} />
                    <div className="col-span-1 text-right text-sm">{formatCurrency((Number(l.hours)||0)*(Number(l.rate)||0))}</div>
                    <button className="col-span-1 btn btn-danger btn-sm" onClick={() => setForm(f=>({...f,labors:((f.labors||[]) as Record<string,unknown>[]).filter((_,j)=>j!==i)}))}>✕</button>
                  </div>
                ))}
                <button className="btn btn-secondary btn-sm mt-2" onClick={() => setForm(f=>({...f,labors:[...((f.labors||[]) as Record<string,unknown>[]),{operation:'',tech:'',hours:0,rate:120}]}))}>+ Add Labor</button>
              </div>
            </div>

            <div className="card grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="form-label">Shop Supplies $</label><input className="form-input" type="number" step="0.01" value={form.shop_supplies||0} onChange={sf('shop_supplies')} /></div>
              <div><label className="form-label">Deposit $</label><input className="form-input" type="number" step="0.01" value={form.deposit||0} onChange={sf('deposit')} /></div>
              <div className="sm:col-span-2"><label className="form-label">Notes</label><textarea className="form-textarea" rows={3} value={form.notes||''} onChange={sf('notes')} /></div>
            </div>

            {/* Warranty Section */}
            <div className="card">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-3">Warranty</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="form-label">Warranty Type</label>
                  <select className="form-select" value={form.warranty_type || 'No Warranty'} onChange={e => {
                    const preset = WARRANTY_PRESETS.find(p => p.label === e.target.value)
                    if (preset) {
                      setForm(f => ({
                        ...f,
                        warranty_type: preset.label,
                        warranty_months: preset.months || null,
                        warranty_mileage: preset.mileage || null,
                        warranty_exclusions: preset.exclusions || null,
                        warranty_start: f.doc_date || new Date().toISOString().split('T')[0],
                      }))
                    }
                  }}>
                    {WARRANTY_PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
                  </select>
                </div>
                {form.warranty_type && form.warranty_type !== 'No Warranty' && form.warranty_type !== 'State Inspection — No Warranty' && (
                  <>
                    <div><label className="form-label">Months</label><input className="form-input" type="number" value={form.warranty_months || ''} onChange={sf('warranty_months')} /></div>
                    <div><label className="form-label">Mileage</label><input className="form-input" type="number" value={form.warranty_mileage || ''} onChange={sf('warranty_mileage')} /></div>
                    <div><label className="form-label">Start Date</label><input className="form-input" type="date" value={form.warranty_start || form.doc_date || ''} onChange={sf('warranty_start')} /></div>
                    <div className="sm:col-span-2"><label className="form-label">Exclusions</label><textarea className="form-textarea" rows={2} value={form.warranty_exclusions || ''} onChange={sf('warranty_exclusions')} /></div>
                  </>
                )}
              </div>
            </div>

            {/* Payment plan display */}
            {form.payment_plan?.enabled && (
              <div className="card border-blue/30">
                <div className="text-xs font-bold uppercase tracking-wider text-blue mb-3">Payment Plan</div>
                <div className="text-sm mb-2">Down payment: {formatCurrency(form.payment_plan.down_payment)} · {form.payment_plan.installments} {form.payment_plan.frequency} payments</div>
                <div className="space-y-1">
                  {form.payment_plan.payments.map((p, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <input type="checkbox" checked={p.paid} onChange={e => {
                        const plan = { ...form.payment_plan! }
                        const payments = [...plan.payments]
                        payments[i] = { ...payments[i], paid: e.target.checked }
                        setForm(f => ({ ...f, payment_plan: { ...plan, payments } }))
                      }} />
                      <span className={p.paid ? 'line-through text-text-muted' : ''}>{p.date} — {formatCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
                {(() => {
                  const paid = form.payment_plan!.payments.filter(p => p.paid).length
                  const total = form.payment_plan!.payments.length
                  const pct = total > 0 ? (paid / total) * 100 : 0
                  return (
                    <div className="mt-3">
                      <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
                        <div className="h-full bg-green rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-xs text-text-muted mt-1">{paid}/{total} payments complete</div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="lg:col-span-2">
            <div className="sticky top-4 bg-white text-gray-900 rounded-xl shadow-2xl overflow-hidden" style={{fontFamily:'Arial,Helvetica,sans-serif'}}>
              {/* Header */}
              <div style={{background:'#1a1a2e',padding:'24px 28px',textAlign:'center'}}>
                <h2 style={{margin:0,fontSize:'18px',fontWeight:700,color:'#fff',letterSpacing:'0.5px'}}>Alpha International Auto Center</h2>
                <p style={{margin:'4px 0 0',fontSize:'11px',color:'#9ca3af'}}>10710 S Main St, Houston TX 77025 &nbsp;·&nbsp; (713) 663-6979</p>
              </div>

              {/* Doc type badge + info */}
              <div style={{textAlign:'center',padding:'16px 28px 12px'}}>
                <span style={{display:'inline-block',background:'#e67e22',color:'#fff',padding:'4px 18px',borderRadius:'999px',fontWeight:700,fontSize:'11px',textTransform:'uppercase',letterSpacing:'0.08em'}}>{type}</span>
                <div style={{fontSize:'12px',color:'#666',marginTop:'6px'}}>#{form.doc_number} &nbsp;·&nbsp; {fmt(form.doc_date || '')}</div>
              </div>

              {/* Customer / Vehicle info */}
              <div style={{padding:'0 28px 16px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',fontSize:'12px',borderBottom:'1px solid #eee'}}>
                <div>
                  <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#999',marginBottom:'2px'}}>Customer</div>
                  <div style={{fontWeight:600,color:'#111'}}>{form.customer_name || '—'}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#999',marginBottom:'2px'}}>Vehicle</div>
                  <div style={{fontWeight:600,color:'#111'}}>{[form.vehicle_year,form.vehicle_make,form.vehicle_model].filter(Boolean).join(' ') || '—'}</div>
                  {form.vehicle_mileage && <div style={{color:'#666',fontSize:'11px'}}>{Number(form.vehicle_mileage).toLocaleString()} miles</div>}
                </div>
              </div>

              {/* Parts table */}
              {((form.parts||[]) as Record<string,unknown>[]).length > 0 && (
                <div style={{padding:'16px 28px 8px'}}>
                  <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#999',marginBottom:'8px'}}>Parts</div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                    <thead>
                      <tr style={{background:'#f8f8f8'}}>
                        <th style={{padding:'6px 8px',textAlign:'left',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666'}}>Description</th>
                        <th style={{padding:'6px 8px',textAlign:'center',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666',width:'40px'}}>Qty</th>
                        <th style={{padding:'6px 8px',textAlign:'right',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666',width:'80px'}}>Unit Price</th>
                        <th style={{padding:'6px 8px',textAlign:'right',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666',width:'80px'}}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((form.parts||[]) as Record<string,unknown>[]).map((p,i) => (
                        <tr key={i} style={{background:i%2===1?'#fafafa':'transparent'}}>
                          <td style={{padding:'6px 8px',color:'#111'}}>{(p.name as string) || '—'}{p.brand ? <span style={{color:'#999',fontSize:'10px',marginLeft:'4px'}}>({p.brand as string})</span> : ''}</td>
                          <td style={{padding:'6px 8px',textAlign:'center',color:'#666'}}>{(p.qty as number)||1}</td>
                          <td style={{padding:'6px 8px',textAlign:'right',color:'#666'}}>{formatCurrency(Number(p.unitPrice)||0)}</td>
                          <td style={{padding:'6px 8px',textAlign:'right',fontWeight:600,color:'#111'}}>{formatCurrency((Number(p.qty)||1)*(Number(p.unitPrice)||0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Labor table */}
              {((form.labors||[]) as Record<string,unknown>[]).length > 0 && (
                <div style={{padding:'12px 28px 8px'}}>
                  <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#999',marginBottom:'8px'}}>Labor</div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                    <thead>
                      <tr style={{background:'#f8f8f8'}}>
                        <th style={{padding:'6px 8px',textAlign:'left',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666'}}>Operation</th>
                        <th style={{padding:'6px 8px',textAlign:'center',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666',width:'50px'}}>Hours</th>
                        <th style={{padding:'6px 8px',textAlign:'right',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666',width:'80px'}}>Rate</th>
                        <th style={{padding:'6px 8px',textAlign:'right',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666',width:'80px'}}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((form.labors||[]) as Record<string,unknown>[]).map((l,i) => (
                        <tr key={i} style={{background:i%2===1?'#fafafa':'transparent'}}>
                          <td style={{padding:'6px 8px',color:'#111'}}>{(l.operation as string) || '—'}</td>
                          <td style={{padding:'6px 8px',textAlign:'center',color:'#666'}}>{(l.hours as number)||0}</td>
                          <td style={{padding:'6px 8px',textAlign:'right',color:'#666'}}>{formatCurrency(Number(l.rate)||0)}/hr</td>
                          <td style={{padding:'6px 8px',textAlign:'right',fontWeight:600,color:'#111'}}>{formatCurrency((Number(l.hours)||0)*(Number(l.rate)||0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Totals */}
              {totals && (
                <div style={{padding:'16px 28px',background:'#f9f9f9',borderTop:'1px solid #eee'}}>
                  <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px',color:'#555'}}>
                    <span>Parts Subtotal</span><span>{formatCurrency(totals.partsTotal)}</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px',color:'#555'}}>
                    <span>Labor Subtotal</span><span>{formatCurrency(totals.laborTotal)}</span>
                  </div>
                  {Number(form.shop_supplies) > 0 && (
                    <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px',color:'#555'}}>
                      <span>Shop Supplies</span><span>{formatCurrency(Number(form.shop_supplies))}</span>
                    </div>
                  )}
                  <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px',color:'#555'}}>
                    <span>Tax ({form.tax_rate || 8.25}%)</span><span>{formatCurrency(totals.taxAmount)}</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0 4px',fontSize:'16px',fontWeight:700,color:'#111',borderTop:'2px solid #111',marginTop:'6px'}}>
                    <span>TOTAL</span><span>{formatCurrency(totals.total)}</span>
                  </div>
                  {Number(form.deposit) > 0 && (
                    <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px',color:'#555'}}>
                      <span>Deposit</span><span>-{formatCurrency(Number(form.deposit))}</span>
                    </div>
                  )}
                  {form.status === 'Paid' ? (
                    <div style={{textAlign:'center',marginTop:'12px'}}>
                      <span style={{display:'inline-block',border:'3px solid #16a34a',color:'#16a34a',padding:'4px 24px',borderRadius:'4px',fontWeight:800,fontSize:'18px',letterSpacing:'0.1em',transform:'rotate(-3deg)',opacity:0.85}}>PAID</span>
                    </div>
                  ) : (
                    <div style={{display:'flex',justifyContent:'space-between',padding:'6px 0 0',fontSize:'14px',fontWeight:700,color:'#dc2626'}}>
                      <span>Balance Due</span><span>{formatCurrency(totals.balanceDue)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              {form.notes && (
                <div style={{padding:'12px 28px',borderTop:'1px solid #eee'}}>
                  <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#999',marginBottom:'4px'}}>Notes</div>
                  <p style={{fontSize:'11px',color:'#555',margin:0,whiteSpace:'pre-wrap'}}>{form.notes}</p>
                </div>
              )}

              {/* Warranty box */}
              {form.warranty_type && form.warranty_type !== 'No Warranty' && form.warranty_type !== 'State Inspection — No Warranty' && (
                <div style={{margin:'0 28px 16px',padding:'14px 16px',border:'1.5px solid #3b82f6',borderRadius:'8px',background:'#eff6ff'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'8px'}}>
                    <span style={{fontSize:'16px'}}>🛡️</span>
                    <span style={{fontSize:'12px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',color:'#1e40af'}}>Warranty Coverage</span>
                  </div>
                  <div style={{fontSize:'12px',fontWeight:600,color:'#111',marginBottom:'4px'}}>{form.warranty_type}</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px',fontSize:'11px',color:'#555'}}>
                    {Number(form.warranty_months) > 0 && <div>Duration: <strong>{form.warranty_months} months</strong></div>}
                    {Number(form.warranty_mileage) > 0 && <div>Mileage: <strong>{Number(form.warranty_mileage).toLocaleString()} miles</strong></div>}
                    {form.warranty_start && <div>Start: <strong>{fmt(form.warranty_start)}</strong></div>}
                    {form.warranty_start && Number(form.warranty_months) > 0 && (() => {
                      const start = new Date(form.warranty_start + 'T00:00:00')
                      start.setMonth(start.getMonth() + Number(form.warranty_months))
                      return <div>Expires: <strong>{start.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</strong></div>
                    })()}
                  </div>
                  {form.warranty_exclusions && (
                    <div style={{marginTop:'8px',fontSize:'10px',color:'#666',lineHeight:'1.4',borderTop:'1px solid #bfdbfe',paddingTop:'8px'}}>
                      <strong>Exclusions:</strong> {form.warranty_exclusions}
                    </div>
                  )}
                  <div style={{marginTop:'10px',fontSize:'9px',color:'#888',lineHeight:'1.4',borderTop:'1px solid #bfdbfe',paddingTop:'8px'}}>
                    All warranty claims must be submitted to Alpha International Auto Center at 10710 S. Main St, Houston, TX 77025 during normal business hours. Contact (713) 663-6979 before beginning any warranty repair. Unauthorized repairs will void this warranty. This warranty is governed by the laws of the State of Texas.
                  </div>
                </div>
              )}

              {/* Footer */}
              <div style={{padding:'12px 28px',textAlign:'center',fontSize:'10px',color:'#999',borderTop:'1px solid #eee',background:'#fafafa'}}>
                <div>Payment Terms: Due on receipt &nbsp;|&nbsp; Accepted: Cash, Card, Zelle, Cash App</div>
                <div style={{marginTop:'4px'}}>(713) 663-6979 &nbsp;·&nbsp; alphainternationalauto.com</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Doc List */
        <div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
            <h1 className="text-xl sm:text-2xl font-bold">{type}s</h1>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <input className="form-input w-full sm:w-56" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
              <button className="btn btn-primary whitespace-nowrap" onClick={openNew}>+ New {type}</button>
            </div>
          </div>
          <div className="card p-0 overflow-x-auto">
            <table className="data-table w-full min-w-[640px]">
              <thead><tr><th>Doc #</th><th>Customer</th><th>Date</th><th>Status</th><th>Total</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={6} className="text-center text-text-muted py-8">No {type.toLowerCase()}s yet</td></tr>}
                {filtered.map(d => {
                  const t = calcTotals(d as unknown as Record<string,unknown>)
                  return (
                    <tr key={d.id} className="cursor-pointer" onClick={() => { setForm(d as Partial<Doc>); setEditing(d.id) }}>
                      <td className="font-mono text-sm text-blue">{d.doc_number}</td>
                      <td className="font-medium">{d.customer_name || '—'}</td>
                      <td className="text-text-secondary">{fmt(d.doc_date)}</td>
                      <td><span className={`tag ${statusColor[d.status]||'tag-gray'}`}>{d.status}</span></td>
                      <td className="font-semibold">{formatCurrency(t.total)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <button className="btn btn-secondary btn-sm" onClick={() => setSendModal(d)}>Send</button>
                          {/* Feature 9: Quick email button */}
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => quickEmail(d)}
                            disabled={emailSending === d.id}
                          >
                            {emailSending === d.id ? '…' : 'Email'}
                          </button>
                          {/* Feature 13: Payment plan button for invoices */}
                          {type === 'Invoice' && <button className="btn btn-secondary btn-sm" onClick={() => { setPlanModal(d); setPlanForm({ down_payment: 0, installments: 3, frequency: 'monthly' }) }}>Plan</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Send modal */}
      {sendModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border rounded-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold mb-4">Send {sendModal.type} #{sendModal.doc_number}</h2>
            <div className="space-y-3">
              <button className="btn btn-primary w-full" onClick={() => sendDoc('email')}>Send via Email</button>
              <button className="btn btn-secondary w-full" onClick={() => sendDoc('sms')}>Send via SMS</button>
              <button className="btn btn-secondary w-full" onClick={() => setSendModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Feature 13: Payment Plan modal */}
      {planModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-card border border-border rounded-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">Payment Plan — {planModal.doc_number}</h2>
            <div className="text-sm text-text-muted mb-4">Total: {formatCurrency(calcTotals(planModal as unknown as Record<string,unknown>).total)}</div>
            <div className="space-y-4">
              <div>
                <label className="form-label">Down Payment</label>
                <input className="form-input" type="number" step="0.01" value={planForm.down_payment} onChange={e => setPlanForm(f => ({ ...f, down_payment: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="form-label">Number of Installments</label>
                <select className="form-select" value={planForm.installments} onChange={e => setPlanForm(f => ({ ...f, installments: Number(e.target.value) }))}>
                  {[2,3,4,5,6,12].map(n => <option key={n} value={n}>{n} payments</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Frequency</label>
                <select className="form-select" value={planForm.frequency} onChange={e => setPlanForm(f => ({ ...f, frequency: e.target.value }))}>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="bg-bg-hover rounded-lg p-3 text-sm">
                <div>Remaining: {formatCurrency(calcTotals(planModal as unknown as Record<string,unknown>).total - planForm.down_payment)}</div>
                <div>Per payment: {formatCurrency((calcTotals(planModal as unknown as Record<string,unknown>).total - planForm.down_payment) / planForm.installments)}</div>
              </div>
              <div className="flex gap-3">
                <button className="btn btn-primary flex-1" onClick={savePaymentPlan}>Save Plan</button>
                <button className="btn btn-secondary" onClick={() => setPlanModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
