export type JsonObject = Record<string, unknown>
type Tool = { write: boolean; required: string[]; fields: string; description: string }
const read = (required: string[], fields: string, description: string): Tool => ({ write: false, required, fields, description })
const write = (required: string[], fields: string, description: string): Tool => ({ write: true, required, fields, description })

// This is an executable allowlist, not a list of abilities invented by a prompt.
export const CATALOG: Record<string, Tool> = {
  searchCustomers: read(['query'], 'query', 'Search customers, jobs and documents. Use returned IDs; disambiguate multiple matches.'),
  getCustomerHistory: read([], 'customer_id customer_name', 'Read the selected customer history.'),
  getShopStats: read([], '', 'Read shop totals and activity.'),
  listStaff: read([], '', 'Read active staff.'),
  getInventory: read([], 'query', 'Read inventory, up to 50 matches.'),
  getTimeclockReport: read([], 'staff_name startDate endDate', 'Read timeclock report.'),
  searchWeb: read(['query'], 'query', 'Search the public web. Search snippets are NOT verified product fitment or checkout prices.'),
  lookupParts: read(['query'], 'query stores', 'Research parts. Include vehicle, requested sides, retailer and engine/trim when known. Results can be incomplete; never invent missing options or labor hours.'),
  createCustomer: write(['name'], 'name phone email address notes', 'Create a customer. Phone and email are OPTIONAL. Never block creation for either.'),
  createJob: write(['customer_name'], 'customer_id customer_name vehicle_year vehicle_make vehicle_model vin status notes', 'Open a job. Customer ID is optional.'),
  createInvoice: write(['customer_name', 'type'], 'type customer_id customer_name customer_phone customer_email vehicle_year vehicle_make vehicle_model parts labors notes tax_rate apply_tax shop_supplies sublet deposit', 'Save an Invoice, Estimate or Receipt as a DRAFT, not sent or paid. Existing customer record is NOT required. parts: [{name,qty,unitPrice,core?,taxable?}]. labors: [{operation,hours,rate}] OR [{operation,amount}] for explicit flat labor. Email/phone optional. No default labor hours, line prices, extra services or fees. Retain vehicle/contact/exclusions across turns. No alignment means no alignment line. Ask only genuinely missing service/price/fitment information.'),
  updateCustomer: write(['id'], 'id name phone email address preferred_contact vehicle_year vehicle_make vehicle_model vehicle_vin vehicle_plate vehicle_mileage notes tags vehicle_color vehicle_engine', 'Update a selected customer.'),
  updateJobStatus: write(['id', 'status'], 'id status', 'Update a selected job status.'),
  updateDocument: write(['id'], 'id customer_name customer_phone customer_email vehicle_year vehicle_make vehicle_model parts labors notes tax_rate apply_tax shop_supplies sublet due_date', 'Edit a selected document; not payment or delivery.'),
  voidDocument: write(['id'], 'id', 'Void a selected document.'),
  deleteRecord: write(['id', 'table'], 'id table', 'Delete a selected customer, job, document or message. table must be customers, jobs, documents or messages.'),
  convertEstimateToInvoice: write(['id'], 'id', 'Create a draft invoice from a selected estimate.'),
  scheduleFollowUp: write(['customer_id', 'channel', 'scheduled_for', 'message_body'], 'customer_id customer_name channel scheduled_for message_body subject', 'Schedule an SMS/email follow-up; destination must exist. Not immediate delivery.'),
  sendEstimateEmail: write(['doc_number', 'email'], 'doc_number email', 'Email the selected document to the explicitly reviewed destination. Separate approval from saving.'),
  addStaff: write(['name'], 'name role emoji', 'Add staff.'),
  removeStaff: write(['id'], 'id', 'Deactivate selected staff.'),
  createAppointment: write(['customer_name', 'scheduled_date', 'scheduled_time'], 'customer_name customer_id scheduled_date scheduled_time vehicle service notes phone email', 'Create an appointment. Get the intended date/time, never silently assume 9AM.'),
  updateAppointment: write(['id'], 'id customer_name customer_id vehicle service tech scheduled_date scheduled_time duration status notes phone email', 'Update a selected appointment.'),
  deleteAppointment: write(['id'], 'id', 'Delete a selected appointment.'),
  updateInventory: write(['id'], 'id name part_number category brand description cost retail_price qty_on_hand qty_reorder qty_on_order supplier supplier_part_number location notes last_ordered', 'Update a selected inventory item.'),
}

export function object(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

type FieldKind = 'string' | 'number' | 'boolean' | 'stringArray' | 'lineArray'

const FIELD_KINDS: Record<string, Record<string, FieldKind>> = {
  searchCustomers: { query: 'string' },
  getCustomerHistory: { customer_id: 'string', customer_name: 'string' },
  getInventory: { query: 'string' },
  getTimeclockReport: { staff_name: 'string', startDate: 'string', endDate: 'string' },
  searchWeb: { query: 'string' },
  lookupParts: { query: 'string', stores: 'stringArray' },
  createCustomer: { name: 'string', phone: 'string', email: 'string', address: 'string', notes: 'string' },
  createJob: { customer_id: 'string', customer_name: 'string', vehicle_year: 'string', vehicle_make: 'string', vehicle_model: 'string', vin: 'string', status: 'string', notes: 'string' },
  createInvoice: { type: 'string', customer_id: 'string', customer_name: 'string', customer_phone: 'string', customer_email: 'string', vehicle_year: 'string', vehicle_make: 'string', vehicle_model: 'string', parts: 'lineArray', labors: 'lineArray', notes: 'string', tax_rate: 'number', apply_tax: 'boolean', shop_supplies: 'number', sublet: 'number', deposit: 'number' },
  updateCustomer: { id: 'string', name: 'string', phone: 'string', email: 'string', address: 'string', preferred_contact: 'string', vehicle_year: 'string', vehicle_make: 'string', vehicle_model: 'string', vehicle_vin: 'string', vehicle_plate: 'string', vehicle_mileage: 'number', notes: 'string', tags: 'stringArray', vehicle_color: 'string', vehicle_engine: 'string' },
  updateJobStatus: { id: 'string', status: 'string' },
  updateDocument: { id: 'string', customer_name: 'string', customer_phone: 'string', customer_email: 'string', vehicle_year: 'string', vehicle_make: 'string', vehicle_model: 'string', parts: 'lineArray', labors: 'lineArray', notes: 'string', tax_rate: 'number', apply_tax: 'boolean', shop_supplies: 'number', sublet: 'number', due_date: 'string' },
  voidDocument: { id: 'string' },
  deleteRecord: { id: 'string', table: 'string' },
  convertEstimateToInvoice: { id: 'string' },
  scheduleFollowUp: { customer_id: 'string', customer_name: 'string', channel: 'string', scheduled_for: 'string', message_body: 'string', subject: 'string' },
  sendEstimateEmail: { doc_number: 'string', email: 'string' },
  addStaff: { name: 'string', role: 'string', emoji: 'string' },
  removeStaff: { id: 'string' },
  createAppointment: { customer_name: 'string', customer_id: 'string', scheduled_date: 'string', scheduled_time: 'string', vehicle: 'string', service: 'string', notes: 'string', phone: 'string', email: 'string' },
  updateAppointment: { id: 'string', customer_name: 'string', customer_id: 'string', vehicle: 'string', service: 'string', tech: 'string', scheduled_date: 'string', scheduled_time: 'string', duration: 'number', status: 'string', notes: 'string', phone: 'string', email: 'string' },
  deleteAppointment: { id: 'string' },
  updateInventory: { id: 'string', name: 'string', part_number: 'string', category: 'string', brand: 'string', description: 'string', cost: 'number', retail_price: 'number', qty_on_hand: 'number', qty_reorder: 'number', qty_on_order: 'number', supplier: 'string', supplier_part_number: 'string', location: 'string', notes: 'string', last_ordered: 'string' },
}

const LINE_KINDS: Record<string, Record<string, FieldKind>> = {
  parts: { name: 'string', position: 'string', partNumber: 'string', store: 'string', brand: 'string', url: 'string', sourceConfidence: 'string', qty: 'number', unitPrice: 'number', core: 'number', taxable: 'boolean' },
  labors: { operation: 'string', hours: 'number', rate: 'number', amount: 'number' },
}

function validFieldValue(kind: FieldKind, value: unknown): boolean {
  if (value === null) return true // Explicit null clears an optional field in a patch.
  if (kind === 'string') return typeof value === 'string' && value.length <= 12000
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (kind === 'boolean') return typeof value === 'boolean'
  if (kind === 'stringArray') return Array.isArray(value) && value.length <= 100 && value.every(item => typeof item === 'string' && item.length <= 500)
  if (kind === 'lineArray') return false
  return false
}

function validLineArray(value: unknown, lineKinds: Record<string, FieldKind>): boolean {
  return Array.isArray(value) && value.length <= 100 && value.every(line => object(line) && Object.entries(line).every(([key, child]) => {
    const lineKind = lineKinds[key]
    return !!lineKind && validFieldValue(lineKind, child)
  }))
}

export function validateInput(action: string, payload: JsonObject, partial = false): string[] {
  const tool = CATALOG[action]
  if (!tool) return [`Unsupported tool: ${action}`]
  const allowed = new Set(tool.fields.split(' '))
  const errors = Object.keys(payload).filter(key => !allowed.has(key)).map(key => `Unsupported field: ${key}`)
  for (const [key, value] of Object.entries(payload)) {
    const kind = FIELD_KINDS[action]?.[key]
    const valid = kind === 'lineArray'
      ? validLineArray(value, key === 'parts' ? LINE_KINDS.parts : LINE_KINDS.labors)
      : kind ? validFieldValue(kind, value) : false
    if (allowed.has(key) && (!kind || !valid)) errors.push(`Invalid ${key}`)
  }
  if (JSON.stringify(payload).length > 18000) errors.push('Action is too large')
  if (!partial) for (const field of tool.required) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') errors.push(`Missing ${field}`)
  }
  if (action === 'createInvoice' && payload.type && !['Invoice', 'Estimate', 'Receipt'].includes(String(payload.type))) errors.push('Invalid document type')
  if (action === 'deleteRecord' && payload.table && !['customers', 'jobs', 'documents', 'messages'].includes(String(payload.table))) errors.push('Invalid record type')
  if (action === 'getCustomerHistory' && !partial && !payload.customer_id && !payload.customer_name) errors.push('Customer ID or name is required')
  if (action === 'scheduleFollowUp' && !partial && !payload.customer_id && !payload.customer_name) errors.push('Customer ID or name is required')
  if (action === 'createInvoice') {
    if (payload.apply_tax !== undefined && typeof payload.apply_tax !== 'boolean') errors.push('apply_tax must be true or false')
    for (const field of ['tax_rate', 'shop_supplies', 'sublet', 'deposit']) if (payload[field] !== undefined && (typeof payload[field] !== 'number' || !Number.isFinite(payload[field] as number) || Number(payload[field]) < 0)) errors.push(`Invalid ${field}`)
  }
  for (const key of ['parts', 'labors']) {
    if (payload[key] !== undefined && (!Array.isArray(payload[key]) || (payload[key] as unknown[]).length > 100)) errors.push(`Invalid ${key}`)
    if (Array.isArray(payload[key])) for (const [index, line] of (payload[key] as unknown[]).entries()) {
      if (!object(line)) { errors.push(`Invalid ${key}.${index}`); continue }
      const lineKinds = LINE_KINDS[key]
      for (const [lineKey, lineValue] of Object.entries(line)) {
        if (!lineKinds[lineKey]) errors.push(`Unsupported field: ${key}.${index}.${lineKey}`)
        else if (!validFieldValue(lineKinds[lineKey], lineValue)) errors.push(`Invalid ${key}.${index}.${lineKey}`)
      }
      const label = key === 'parts' ? 'name' : 'operation'
      if (typeof line[label] !== 'string' || !String(line[label]).trim()) errors.push(`Missing ${key}.${index}.${label}`)
      const amounts = key === 'parts' ? ['qty', 'unitPrice'] : line.amount !== undefined ? ['amount'] : ['hours', 'rate']
      for (const field of amounts) if (typeof line[field] !== 'number' || !Number.isFinite(line[field]) || Number(line[field]) < 0) errors.push(`Missing or invalid ${key}.${index}.${field}`)
      if (key === 'labors' && line.amount !== undefined && (line.hours !== undefined || line.rate !== undefined)) errors.push(`Labor ${index} cannot mix flat amount with hours/rate`)
      if (key === 'parts' && line.core !== undefined && (typeof line.core !== 'number' || !Number.isFinite(line.core) || Number(line.core) < 0)) errors.push(`Invalid ${key}.${index}.core`)
    }
  }
  if (!partial && action === 'createInvoice' && !((payload.parts as unknown[])?.length || (payload.labors as unknown[])?.length)) errors.push('Missing priced service lines')
  return errors
}
