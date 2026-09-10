export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function moneyFromUnknown(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? roundMoney(value) : null
  if (typeof value !== 'string') return null

  const cleaned = value.replace(/[$,\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? roundMoney(parsed) : null
}

export function getLaborFlatAmount(line: Record<string, unknown>): number | null {
  const explicitAmount = moneyFromUnknown(line.amount ?? line.flat_amount ?? line.flatAmount)
  if (explicitAmount !== null) return explicitAmount

  if (line.total !== undefined && line.hours === undefined && line.rate === undefined) {
    return moneyFromUnknown(line.total)
  }

  return null
}

export function laborLineTotal(line: Record<string, unknown>): number {
  const flatAmount = getLaborFlatAmount(line)
  if (flatAmount !== null) return flatAmount

  return roundMoney((Number(line.hours) || 0) * (Number(line.rate) || 0))
}

export function partLineTotal(line: Record<string, unknown>): number {
  return roundMoney((Number(line.qty) || 1) * (Number(line.unitPrice) || 0))
}

/**
 * The one financial calculation used by the editor, reports, signing pages,
 * and outbound document messages. Keeping this here prevents an email or
 * customer-facing page from silently disagreeing with the application.
 */
export function calculateDocumentTotals(doc: Record<string, unknown>) {
  const parts = Array.isArray(doc.parts) ? doc.parts.filter((line): line is Record<string, unknown> => Boolean(line && typeof line === 'object')) : []
  const labors = Array.isArray(doc.labors) ? doc.labors.filter((line): line is Record<string, unknown> => Boolean(line && typeof line === 'object')) : []
  const rawTaxRate = Number(doc.tax_rate)
  const taxRate = Number.isFinite(rawTaxRate) && rawTaxRate >= 0 ? rawTaxRate : 8.25
  const applyTax = doc.apply_tax !== false
  const shopSupplies = Number(doc.shop_supplies) || 0
  const sublet = Number(doc.sublet) || 0
  const rawAmountPaid = Number(doc.amount_paid)
  const amountPaid = Number.isFinite(rawAmountPaid) && rawAmountPaid >= 0 ? roundMoney(rawAmountPaid) : 0
  const deposit = Number(doc.deposit) || 0

  const laborTotal = roundMoney(labors.reduce((sum, line) => sum + laborLineTotal(line), 0))
  const partsTotal = roundMoney(parts.reduce((sum, line) => sum + partLineTotal(line), 0))
  const coreTotal = roundMoney(parts.reduce((sum, line) => sum + roundMoney((Number(line.qty) || 1) * (Number(line.core) || 0)), 0))
  const taxablePartsTotal = roundMoney(parts
    .filter((line) => line.taxable !== false)
    .reduce((sum, line) => sum + partLineTotal(line), 0))
  const taxableBase = applyTax ? roundMoney(taxablePartsTotal + shopSupplies + sublet) : 0
  const taxAmount = roundMoney(taxableBase * (taxRate / 100))
  const subtotal = roundMoney(laborTotal + partsTotal + shopSupplies + sublet + coreTotal)
  const total = roundMoney(subtotal + taxAmount)
  const balanceDue = roundMoney(Math.max(total - amountPaid, 0))

  return {
    laborTotal,
    partsTotal,
    coreTotal,
    shopSupplies,
    sublet,
    taxablePartsTotal,
    taxableBase,
    taxRate,
    applyTax,
    taxAmount,
    subtotal,
    total,
    balanceDue,
    deposit,
    amountPaid,
  }
}
