import {
  getLaborFlatAmount,
  laborLineTotal,
  moneyFromUnknown,
  partLineTotal,
  roundMoney,
} from '@/lib/document-money'

type DraftLine = Record<string, unknown>

type NormalizeContext = {
  userText?: string
}

const TOTAL_FIELD_NAMES = [
  'target_total',
  'targetTotal',
  'flat_total',
  'flatTotal',
  'grand_total',
  'grandTotal',
  'total',
  'amount',
  'price',
]

export function allocateAmounts(total: number, count: number): number[] {
  const lineCount = Math.max(1, count)
  const cents = Math.round(roundMoney(total) * 100)
  const base = Math.floor(cents / lineCount)
  const remainder = cents - base * lineCount

  return Array.from({ length: lineCount }, (_unused, index) =>
    roundMoney((base + (index < remainder ? 1 : 0)) / 100)
  )
}

export function extractHardTotal(text?: string, draft?: Record<string, unknown>): number | null {
  const source = text?.trim() || ''
  if (source) {
    const strongPattern =
      /(?:make\s+(?:the\s+)?(?:total|price)|(?:total|price)\s*(?:to\s*be|for|is|=)?|flat(?:\s*rate)?|for\s+everything|everything\s+for|all\s+in|out\s+the\s+door|parts\s+and\s+labor)\D{0,30}\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi
    const strongMatches = [...source.matchAll(strongPattern)]
      .map((match) => moneyFromUnknown(match[1]))
      .filter((amount): amount is number => amount !== null)
    if (strongMatches.length > 0) return strongMatches[strongMatches.length - 1]

    const dollarMatches = [...source.matchAll(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/g)]
      .map((match) => moneyFromUnknown(match[1]))
      .filter((amount): amount is number => amount !== null)
    if (dollarMatches.length > 0) return dollarMatches[dollarMatches.length - 1]

    const hasDocumentIntent = /\b(invoice|estimate|quote|total|price|flat|parts\s+and\s+labor)\b/i.test(source)
    if (hasDocumentIntent) {
      const forAmountMatches = [...source.matchAll(/\bfor\s+\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\b/gi)]
        .map((match) => moneyFromUnknown(match[1]))
        .filter((amount): amount is number => amount !== null && amount > 0 && amount < 100000)
      if (forAmountMatches.length > 0) return forAmountMatches[forAmountMatches.length - 1]
    }
  }

  if (draft) {
    for (const field of TOTAL_FIELD_NAMES) {
      const amount = moneyFromUnknown(draft[field])
      if (amount !== null && amount > 0) return amount
    }
  }

  return null
}

export function extractServiceItems(text?: string): string[] {
  if (!text) return []
  const source = text.toLowerCase()
  const items: string[] = []

  const add = (value: string) => {
    if (!items.includes(value)) items.push(value)
  }

  if (/(?:\b(?:all\s*)?(?:4|four)\b.{0,24}\bbrakes?\b|\bbrakes?\b.{0,24}\b(?:all\s*)?(?:4|four)\b)/i.test(source)) {
    add('Four wheel brake service')
  } else if (/\bfront\b.{0,18}\bbrakes?\b|\bbrakes?\b.{0,18}\bfront\b/i.test(source)) {
    add('Front brake service')
  } else if (/\brear\b.{0,18}\bbrakes?\b|\bbrakes?\b.{0,18}\brear\b/i.test(source)) {
    add('Rear brake service')
  } else if (/\bbrakes?\b/i.test(source)) {
    add('Brake service')
  }

  if (/\bcoolant\s+(?:tank|reservoir)\b/i.test(source)) add('Replace coolant tank')
  if (/\bturn(?:ing)?\s+signal(?:\s+light)?\s+bulbs?\b/i.test(source)) add('Replace turn signal light bulbs')
  if (/\bthermostat\b/i.test(source)) add('Replace thermostat')
  if (/\balternator\b/i.test(source)) add('Replace alternator')
  if (/\bstarter\b/i.test(source)) add('Replace starter')
  if (/\bwater\s+pump\b/i.test(source)) add('Replace water pump')
  if (/\boil\s+change\b/i.test(source)) add('Oil change service')
  if (/\blower\s+control\s+arms?\b/i.test(source)) add('Replace lower control arms')
  if (/\bupper\s+control\s+arms?\b/i.test(source)) add('Replace upper control arms')
  if (/\bstruts?\b/i.test(source)) add('Replace struts')
  if (/\bshocks?\b/i.test(source)) add('Replace shocks')
  if (/\bsway\s+bar\s+links?\b/i.test(source)) add('Replace sway bar links')

  return items
}

function normalizeKnownServiceName(value: string): string {
  const cleaned = value
    .replace(/\b(customer\s+supplied|customer\s+supplying|flat\s+rate|parts\s+and\s+labor|labor\s+flat\s+rate)\b/gi, '')
    .replace(/\$?\s*[0-9][0-9,]*(?:\.\d{1,2})?/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const lower = cleaned.toLowerCase()
  if (!cleaned) return ''
  if (/\b(?:4|four|all\s+4|all four)\b.*\bbrakes?\b|\bbrakes?\b.*\b(?:4|four|all\s+4|all four)\b/i.test(lower)) return 'Four wheel brake service'
  if (/\bbrakes?\b/i.test(lower)) return 'Brake service'
  if (/\bcoolant\s+(?:tank|reservoir)\b/i.test(lower)) return 'Replace coolant tank'
  if (/\bturn(?:ing)?\s+signal(?:\s+light)?\s+bulbs?\b/i.test(lower)) return 'Replace turn signal light bulbs'
  if (/\bthermostat\b/i.test(lower)) return 'Replace thermostat'
  if (/\blower\s+control\s+arms?\b/i.test(lower)) return 'Replace lower control arms'
  if (/\bupper\s+control\s+arms?\b/i.test(lower)) return 'Replace upper control arms'

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function splitCompoundLine(value: string): string[] {
  return value
    .replace(/\s+-\s+.*$/g, '')
    .split(/\s*(?:,|;|\+|&|\band\b)\s*/i)
    .map(normalizeKnownServiceName)
    .filter(Boolean)
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function lineName(line: DraftLine, fallback: string): string {
  const value = line.operation ?? line.name ?? line.description
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeParts(parts: unknown): DraftLine[] {
  if (!Array.isArray(parts)) return []
  return parts.map((part) => {
    const line = (part && typeof part === 'object' ? part : {}) as DraftLine
    return {
      ...line,
      name: lineName(line, 'Part'),
      qty: Number(line.qty) || 1,
      unitPrice: moneyFromUnknown(line.unitPrice) ?? 0,
    }
  })
}

function normalizeLabors(labors: unknown): DraftLine[] {
  if (!Array.isArray(labors)) return []
  return labors.map((labor) => {
    const line = (labor && typeof labor === 'object' ? labor : {}) as DraftLine
    const flatAmount = getLaborFlatAmount(line)
    if (flatAmount !== null) {
      return {
        ...line,
        operation: lineName(line, 'Labor'),
        amount: flatAmount,
        pricing: 'flat',
      }
    }

    return {
      ...line,
      operation: lineName(line, 'Labor'),
      hours: Number(line.hours) || 0,
      rate: moneyFromUnknown(line.rate) ?? 120,
    }
  })
}

function draftTotal(parts: DraftLine[], labors: DraftLine[], draft: Record<string, unknown>): number {
  const partsTotal = parts.reduce((sum, part) => sum + partLineTotal(part), 0)
  const laborTotal = labors.reduce((sum, labor) => sum + laborLineTotal(labor), 0)
  const applyTax = draft.apply_tax !== undefined ? draft.apply_tax !== false : true
  const taxRate = moneyFromUnknown(draft.tax_rate) ?? 8.25
  const tax = applyTax ? partsTotal * (taxRate / 100) : 0
  return roundMoney(partsTotal + laborTotal + tax)
}

function deriveServiceNames(userText: string, parts: DraftLine[], labors: DraftLine[]): string[] {
  const fromUser = extractServiceItems(userText)
  if (fromUser.length > 0) return fromUser

  const parsedNames = [
    ...labors.map((line) => lineName(line, 'Labor')),
    ...parts.map((line) => lineName(line, 'Part')),
  ]

  const splitNames = parsedNames.flatMap(splitCompoundLine)
  return unique(splitNames.length > 0 ? splitNames : parsedNames.map(normalizeKnownServiceName).filter(Boolean))
}

function appendFlatTotalNote(notes: unknown, amount: number): string {
  const current = typeof notes === 'string' ? notes.trim() : ''
  const flatNote = `Flat total: $${amount.toFixed(2)}. No tax.`
  if (!current) return flatNote
  if (/flat\s+total|no\s+tax|flat\s+rate/i.test(current)) return current
  return `${current}\n${flatNote}`
}

export function normalizeDocumentDraft<T extends Record<string, unknown>>(draft: T, context: NormalizeContext = {}): T {
  const parts = normalizeParts(draft.parts)
  const labors = normalizeLabors(draft.labors)
  const userText = context.userText || ''
  const hardTotal = extractHardTotal(userText, draft)
  const currentTotal = draftTotal(parts, labors, draft)
  const notesText = typeof draft.notes === 'string' ? draft.notes : ''
  const forceFlat =
    /\b(flat|for\s+everything|everything\s+for|all\s+in|out\s+the\s+door|parts\s+and\s+labor|customer\s+supplied|customer\s+supplying|make\s+(?:the\s+)?(?:total|price)|price\s+to\s+be)\b/i.test(
      `${userText} ${notesText}`
    )
  const hasPositiveLine = [...parts, ...labors].some((line) => partLineTotal(line) > 0 || laborLineTotal(line) > 0)

  if (hardTotal !== null && (forceFlat || !hasPositiveLine || Math.abs(currentTotal - hardTotal) >= 0.01)) {
    const serviceNames = deriveServiceNames(userText, parts, labors)
    const names = serviceNames.length > 0 ? serviceNames : ['Flat labor/service total']
    const amounts = allocateAmounts(hardTotal, names.length)

    return {
      ...draft,
      parts: [],
      labors: names.map((operation, index) => ({
        operation,
        amount: amounts[index],
        pricing: 'flat',
      })),
      target_total: hardTotal,
      apply_tax: false,
      tax_rate: 0,
      notes: appendFlatTotalNote(draft.notes, hardTotal),
    }
  }

  return {
    ...draft,
    parts,
    labors,
    ...(hardTotal !== null ? { target_total: hardTotal } : {}),
    ...(forceFlat ? { apply_tax: false, tax_rate: 0 } : {}),
  }
}
