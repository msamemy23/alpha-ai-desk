/**
 * The customer list as a spreadsheet file. The owner's own data, going to the owner: name, contact, car, tags, the text
 * permission, visits and money. Cells that could run as a formula are guarded (see csv.ts). Imports only the CSV writer.
 */
import { toCsv } from '../csv.ts'

export interface ExportCustomer {
  name: string
  phone: string
  email: string
  address: string
  preferred_contact: string
  vehicle_year: string
  vehicle_make: string
  vehicle_model: string
  vehicle_vin: string
  vehicle_plate: string
  vehicle_mileage: string
  notes: string
  created_at: string
  tags: string[]
  textStatus: string
  visits: number
  lastVisit: string
  lifetime: number
  owed: number
}

export const EXPORT_HEADERS = [
  'Name', 'Phone', 'Email', 'Address', 'Preferred contact', 'Year', 'Make', 'Model', 'VIN', 'Plate', 'Mileage', 'Tags', 'Text permission',
  'Repair orders', 'Last visit', 'Paid to date', 'Balance owed', 'Customer since', 'Notes',
]

const day = (iso: string): string => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''
}

export function customersCsv(list: ExportCustomer[]): string {
  const rows: unknown[][] = [EXPORT_HEADERS]
  for (const c of list) {
    rows.push([
      c.name, c.phone, c.email, c.address, c.preferred_contact, c.vehicle_year, c.vehicle_make, c.vehicle_model, c.vehicle_vin, c.vehicle_plate, c.vehicle_mileage,
      c.tags.join('; '), c.textStatus, c.visits, day(c.lastVisit), c.lifetime.toFixed(2), c.owed.toFixed(2), day(c.created_at), c.notes,
    ])
  }
  return toCsv(rows)
}

export const exportFileName = (today: string): string => `customers-${today}.csv`
