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
