type DecimalParts = { negative: boolean; digits: bigint; scale: number }

function parseDecimalText(value: string): DecimalParts | null {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i)
  if (!match) return null

  const fraction = match[3] || ''
  const exponent = Number(match[4] || 0)
  if (!Number.isSafeInteger(exponent)) return null
  let digits = BigInt(`${match[2]}${fraction}`)
  let scale = fraction.length - exponent
  if (scale < 0) {
    digits *= BigInt(10) ** BigInt(-scale)
    scale = 0
  }
  const ten = BigInt(10)
  while (scale > 0 && digits % ten === BigInt(0)) {
    digits /= ten
    scale -= 1
  }
  return { negative: match[1] === '-' && digits !== BigInt(0), digits, scale }
}

function decimalText(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : null
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[$,\s]/g, '')
  return parseDecimalText(cleaned) ? cleaned : null
}

function decimalToText(parts: DecimalParts): string {
  const digits = parts.digits.toString()
  if (parts.scale === 0) return `${parts.negative ? '-' : ''}${digits}`
  const padded = digits.padStart(parts.scale + 1, '0')
  const splitAt = padded.length - parts.scale
  return `${parts.negative ? '-' : ''}${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`
}

function roundDecimalText(value: string, places = 2): string {
  const parsed = parseDecimalText(value)
  if (!parsed || !Number.isSafeInteger(places) || places < 0) return '0'
  const ten = BigInt(10)
  if (parsed.scale <= places) {
    return decimalToText({
      ...parsed,
      digits: parsed.digits * ten ** BigInt(places - parsed.scale),
      scale: places,
    })
  }

  const shift = parsed.scale - places
  const divisor = ten ** BigInt(shift)
  let rounded = parsed.digits / divisor
  const remainder = parsed.digits % divisor
  if (remainder * BigInt(2) >= divisor) rounded += BigInt(1)
  return decimalToText({ negative: parsed.negative, digits: rounded, scale: places })
}

function multiplyDecimalText(left: string, right: string): string {
  const a = parseDecimalText(left)
  const b = parseDecimalText(right)
  if (!a || !b) return '0'
  return decimalToText({
    negative: a.negative !== b.negative,
    digits: a.digits * b.digits,
    scale: a.scale + b.scale,
  })
}

function divideByPowerOfTen(value: string, places: number): string {
  const parsed = parseDecimalText(value)
  if (!parsed || !Number.isSafeInteger(places) || places < 0) return '0'
  return decimalToText({ ...parsed, scale: parsed.scale + places })
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Number(roundDecimalText(value.toString(), 2))
}

/** Parse a numeric value without rounding operands before line-item math. */
export function decimalFromUnknown(value: unknown): number | null {
  const text = decimalText(value)
  if (text === null) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

export function moneyFromUnknown(value: unknown): number | null {
  const parsed = decimalFromUnknown(value)
  return parsed === null ? null : roundMoney(parsed)
}

export function quantityFromUnknown(value: unknown, fallback = 1): number {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : 0
  if (typeof value !== 'string') return 0
  const cleaned = value.replace(/[,\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return 0
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

export function nonNegativeMoney(value: unknown, fallback = 0): number {
  const parsed = moneyFromUnknown(value)
  return parsed !== null && parsed >= 0 ? parsed : fallback
}

export function nonNegativeDecimal(value: unknown, fallback = 0): number {
  const parsed = decimalFromUnknown(value)
  return parsed !== null && parsed >= 0 ? parsed : fallback
}

function nonNegativeDecimalText(value: unknown, fallback = '0'): string {
  const text = decimalText(value)
  const parsed = text === null ? null : parseDecimalText(text)
  return parsed && !parsed.negative ? decimalToText(parsed) : fallback
}

function quantityDecimalText(value: unknown, fallback = '1'): string {
  if (value === undefined || value === null || value === '') return fallback
  return nonNegativeDecimalText(value, '0')
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

  return Number(roundDecimalText(multiplyDecimalText(
    nonNegativeDecimalText(line.hours),
    nonNegativeDecimalText(line.rate),
  ), 2))
}

export function partLineTotal(line: Record<string, unknown>): number {
  return Number(roundDecimalText(multiplyDecimalText(
    quantityDecimalText(line.qty),
    nonNegativeDecimalText(line.unitPrice),
  ), 2))
}

/**
 * The one financial calculation used by the editor, reports, signing pages,
 * and outbound document messages. Keeping this here prevents an email or
 * customer-facing page from silently disagreeing with the application.
 */
export function calculateDocumentTotals(doc: Record<string, unknown>) {
  const parts = Array.isArray(doc.parts) ? doc.parts.filter((line): line is Record<string, unknown> => Boolean(line && typeof line === 'object')) : []
  const labors = Array.isArray(doc.labors) ? doc.labors.filter((line): line is Record<string, unknown> => Boolean(line && typeof line === 'object')) : []
  const taxRateText = nonNegativeDecimalText(doc.tax_rate, '8.25')
  const taxRate = Number(taxRateText)
  const applyTax = doc.apply_tax !== false
  const shopSupplies = nonNegativeMoney(doc.shop_supplies)
  const sublet = nonNegativeMoney(doc.sublet)
  const amountPaid = nonNegativeMoney(doc.amount_paid)
  const deposit = nonNegativeMoney(doc.deposit)

  const laborTotal = roundMoney(labors.reduce((sum, line) => sum + laborLineTotal(line), 0))
  const partsTotal = roundMoney(parts.reduce((sum, line) => sum + partLineTotal(line), 0))
  const coreTotal = roundMoney(parts.reduce((sum, line) => sum + Number(roundDecimalText(multiplyDecimalText(
    quantityDecimalText(line.qty),
    nonNegativeDecimalText(line.core),
  ), 2)), 0))
  const taxablePartsTotal = roundMoney(parts
    .filter((line) => line.taxable !== false)
    .reduce((sum, line) => sum + partLineTotal(line), 0))
  const taxableBase = applyTax ? roundMoney(taxablePartsTotal + shopSupplies + sublet) : 0
  const taxAmount = Number(roundDecimalText(multiplyDecimalText(
    taxableBase.toString(),
    divideByPowerOfTen(taxRateText, 2),
  ), 2))
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
