export const READ_ONLY_SHOP_ACTIONS = [
  'searchCustomers', 'getShopStats', 'getCustomerHistory', 'listStaff',
  'getInventory', 'getTimeclockReport', 'searchWeb',
] as const

// A model saying that it ran a lookup is not evidence of execution. Only
// successful responses from the tenant-authorized action endpoint count.
export function verifyReadClaims(
  request: string,
  answer: string,
  successfulReads: ReadonlySet<string>,
  alreadyRetried: boolean,
) {
  const requested = request.replace(/[`*_]/g, '')
  const claimed = answer.replace(/[`*_]/g, '')
  const required = new Set<string>()
  for (const action of READ_ONLY_SHOP_ACTIONS) {
    if (new RegExp(`\\b(?:use|run|call|execute)\\s+(?:the\\s+)?${action}\\b`, 'i').test(requested)
      || new RegExp(`\\b(?:ran|called|used|executed)\\s+(?:the\\s+)?${action}\\b`, 'i').test(claimed)) {
      required.add(action)
    }
  }
  const asksAboutInventory = /\b(?:inventory|stock)\b/i.test(requested)
    && /\b(?:how many|count|check|show|list|look up|search|find|on hand|in stock|have|returned|available)\b/i.test(requested)
    && !/\b(?:explain|how (?:does|do|to)|what (?:is|does))\b/i.test(requested)
  if (asksAboutInventory) required.add('getInventory')
  const missing = [...required].filter(action => !successfulReads.has(action))
  return {
    missing,
    decision: missing.length ? (alreadyRetried ? 'block' : 'retry') : 'allow',
  } as const
}

export function unverifiedReadMessage(actions: readonly string[]) {
  return `I could not verify the live shop lookup (${actions.join(', ')}), so I cannot report its result. Check the tool activity or try again. No result has been marked as verified.`
}
