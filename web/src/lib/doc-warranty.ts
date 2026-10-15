// Warranty wording for paperwork.
//
// The wording here is a plain starting point that names no shop: {shop} is replaced with the shop's
// own name when a preset is applied to a document. Each shop can replace any preset's wording in
// Estimates settings, and that wording is used instead. Shops should have their own advisor review
// their warranty terms; these presets are not legal advice.
//
// The labels are kept exactly as they were, so documents that already store a label still match it.

export interface WarrantyPreset { label: string; months: number; mileage: number; exclusions: string }
export interface WarrantyOverride { label: string; months?: number; mileage?: number; exclusions: string }

const MILES = (n: number) => n.toLocaleString('en-US')

function term(months: number, mileage: number): string {
  if (months > 0 && mileage > 0) return `${months} months or ${MILES(mileage)} miles, whichever comes first,`
  if (months > 0) return `${months} months`
  return 'the stated period'
}

function build(service: string, covers: string, months: number, mileage: number, extra: string[] = []): string {
  const blocks = [
    `LIMITED WARRANTY: The ${service} performed by {shop} is warranted to the original customer named on this document only and is not transferable. It covers defects in ${covers} for ${term(months, mileage)} from the date on this document, under normal, non-commercial use.`,
    `CONDITIONS AND REMEDY: The customer's remedy is limited to repair or replacement of the defective covered item, at the shop's choice, at no charge. Contact {shop} before any warranty work is done. Work by another facility without written approval from {shop} is not covered.`,
    ...extra,
    `EXCLUSIONS: This warranty does not cover wear and tear, damage from accident, misuse, abuse, neglect or lack of maintenance, parts or systems that were not repaired or replaced on this document, or problems that were present before the work. It does not cover towing, rental or loss of use. This is the only warranty given, and it replaces all other warranties to the extent the law allows.`,
  ]
  return blocks.join('\n\n')
}

const RETURN_CHECK = (miles: number) =>
  `RETURN CHECK: Bring the vehicle back to {shop} for a check within ${MILES(miles)} miles of the repair so the work can be inspected. Skipping the check can limit coverage.`

export const WARRANTY_PRESETS: WarrantyPreset[] = [
  { label: 'No Warranty', months: 0, mileage: 0, exclusions: '' },
  { label: 'Oil Change — 3 Months / 3,000 Miles', months: 3, mileage: 3000, exclusions: build('oil change service', 'the oil filter and oil installed and the service itself', 3, 3000, ['LEAKS: If the vehicle is driven with an active oil, coolant or water leak after the customer has been told about it, this warranty does not apply to damage that results.']) },
  { label: 'Oil Change (Synthetic) — 6 Months / 6,000 Miles', months: 6, mileage: 6000, exclusions: build('synthetic oil change service', 'the oil filter and synthetic oil installed and the service itself', 6, 6000, ['LEAKS: If the vehicle is driven with an active oil, coolant or water leak after the customer has been told about it, this warranty does not apply to damage that results.']) },
  { label: 'Brakes — 12 Months / 12,000 Miles', months: 12, mileage: 12000, exclusions: build('brake repair', 'the brake parts replaced and the labor to install them', 12, 12000, [RETURN_CHECK(500), 'BRAKE FLUID: Coverage assumes the brake fluid is kept clean and at the right level.']) },
  { label: 'Engine Repair — 12 Months / 12,000 Miles', months: 12, mileage: 12000, exclusions: build('engine repair', 'the engine parts repaired or replaced and the labor to install them', 12, 12000, [RETURN_CHECK(500), 'MAINTENANCE: Coverage assumes oil and filter changes are done on the maker\'s schedule, with receipts kept.']) },
  { label: 'Engine Rebuild — 12 Months / 12,000 Miles', months: 12, mileage: 12000, exclusions: build('engine rebuild', 'the internal engine parts replaced during the rebuild and the labor to install them', 12, 12000, [RETURN_CHECK(500), 'MAINTENANCE: Coverage assumes oil and filter changes are done on the maker\'s schedule, with receipts kept.']) },
  { label: 'Transmission Repair — 12 Months / 12,000 Miles', months: 12, mileage: 12000, exclusions: build('transmission repair', 'the transmission parts repaired or replaced and the labor to install them', 12, 12000, [RETURN_CHECK(500), 'FLUID: Coverage assumes the correct transmission fluid is used and kept at the right level.']) },
  { label: 'Transmission Rebuild — 24 Months / 24,000 Miles', months: 24, mileage: 24000, exclusions: build('transmission rebuild', 'the internal transmission parts replaced during the rebuild and the labor to install them', 24, 24000, [RETURN_CHECK(500), 'FLUID: Coverage assumes the correct transmission fluid is used and changed on schedule.']) },
  { label: 'Electrical / Diagnostics — 6 Months / 6,000 Miles', months: 6, mileage: 6000, exclusions: build('electrical repair', 'the electrical parts and sensors replaced and the labor to install them', 6, 6000, ['ACCESSORIES: Aftermarket electrical accessories and water or rodent damage are not covered.']) },
  { label: 'Suspension — 12 Months / 12,000 Miles', months: 12, mileage: 12000, exclusions: build('suspension repair', 'the suspension parts replaced and the labor to install them', 12, 12000, [RETURN_CHECK(500), 'ALIGNMENT: A wheel alignment is a separate service and is not covered against future misalignment. Tire wear is not covered.']) },
  { label: 'AC / Heating — 6 Months / 6,000 Miles', months: 6, mileage: 6000, exclusions: build('air conditioning and heating repair', 'the parts replaced and the labor to install them', 6, 6000, ['REFRIGERANT: Leaks from parts that were not serviced on this document are not covered.']) },
  { label: 'Body & Paint — 6 Months (Cosmetic)', months: 6, mileage: 0, exclusions: build('body and paint work', 'workmanship', 6, 0, ['FINISH: Rock chips, scratches, dents, fading from sun or chemicals, and damage from washing or lack of care are not covered.']) },
  { label: 'State Inspection — No Warranty', months: 0, mileage: 0, exclusions: '' },
  { label: 'General Repair — 12 Months / 12,000 Miles', months: 12, mileage: 12000, exclusions: build('repair', 'the parts replaced and the labor to install them', 12, 12000, [RETURN_CHECK(500)]) },
  { label: 'Custom Warranty', months: 0, mileage: 0, exclusions: '' },
]

/** The shop's own wording wins over the starting wording, by label. */
export function mergeWarrantyPresets(base: WarrantyPreset[], overrides: WarrantyOverride[] | null | undefined): WarrantyPreset[] {
  const byLabel = new Map((overrides || []).filter((o) => o && typeof o.label === 'string').map((o) => [o.label, o]))
  return base.map((p) => {
    const o = byLabel.get(p.label)
    if (!o) return p
    return {
      label: p.label,
      months: Number.isFinite(Number(o.months)) && o.months !== undefined ? Math.max(0, Math.round(Number(o.months))) : p.months,
      mileage: Number.isFinite(Number(o.mileage)) && o.mileage !== undefined ? Math.max(0, Math.round(Number(o.mileage))) : p.mileage,
      exclusions: String(o.exclusions ?? ''),
    }
  })
}

/** Puts the shop's name where {shop} appears. */
export function renderWarrantyText(value: unknown, shopName: string): string {
  return String(value || '').replace(/\{shop\}/g, shopName.trim() || 'our shop')
}

/** One line for a document: "12 months or 12,000 miles". */
export function warrantyHeadline(months: unknown, mileage: unknown): string {
  const m = Number(months) || 0
  const mi = Number(String(mileage ?? '').replace(/[^0-9.]/g, '')) || 0
  if (m > 0 && mi > 0) return `${m} months or ${MILES(mi)} miles`
  if (m > 0) return `${m} months`
  if (mi > 0) return `${MILES(mi)} miles`
  return ''
}

type Doc = Record<string, unknown>

/** The label of the preset that best matches the work on a document. Same rules as before. */
export function detectWarrantyLabel(doc: Doc): string {
  const parts = Array.isArray(doc.parts) ? (doc.parts as Doc[]) : []
  const labors = Array.isArray(doc.labors) ? (doc.labors as Doc[]) : []
  const desc = [
    ...parts.map((p) => String(p.name || '') + ' ' + String(p.brand || '')),
    ...labors.map((l) => String(l.operation || '')),
    String(doc.notes || ''),
  ].join(' ').toLowerCase()
  const find = (needle: string) => WARRANTY_PRESETS.find((p) => p.label.includes(needle))?.label
  let label = 'No Warranty'
  if (/synthetic|full.?syn/i.test(desc) && /oil.?change|lube|oil.?service/i.test(desc)) label = find('Synthetic') || label
  else if (/oil.?change|lube|oil.?service/i.test(desc)) label = 'Oil Change — 3 Months / 3,000 Miles'
  else if (/rebuild|engine.?rebuild|motor.?rebuild/i.test(desc)) label = find('Engine Rebuild') || label
  else if (/engine|motor/i.test(desc)) label = find('Engine Repair') || label
  else if (/transmission|trans\b|tranny/i.test(desc)) label = find('Transmission') || label
  else if (/brake|rotor|caliper|pad/i.test(desc)) label = find('Brakes') || label
  else if (/ac\b|a\/c|air.?cond|hvac|refrigerant|freon/i.test(desc)) label = find('AC') || label
  else if (/suspension|strut|shock|spring|sway.?bar|control.?arm|ball.?joint/i.test(desc)) label = find('Suspension') || label
  else if (/electric|wiring|alternator|starter|battery|fuse|relay|module|ecm|pcm/i.test(desc)) label = find('Electrical') || label
  else if (/body|paint|dent|bumper|panel|collision/i.test(desc)) label = find('Body') || label
  else if (/inspection|state.?insp/i.test(desc)) label = find('State Inspection') || label
  return label
}
