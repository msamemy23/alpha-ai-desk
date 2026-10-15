// How a document's status looks everywhere in the app: a lamp colour plus a plain label.

export type DocLamp = 'green' | 'amber' | 'red' | 'blue' | 'off'

export function docLamp(type: string, status: string): DocLamp {
  switch (status) {
    case 'Paid': return 'green'
    case 'Approved': return 'green'
    case 'Partial': return 'amber'
    case 'Unpaid': return 'red'
    case 'Sent': return 'blue'
    default: return 'off'
  }
}

export function docStatusLabel(type: string, status: string): string {
  if (type === 'Estimate') {
    if (status === 'Draft') return 'Not sent'
    if (status === 'Sent') return 'Waiting on customer'
    if (status === 'Approved') return 'Approved'
    return status
  }
  if (status === 'Draft') return 'Not sent'
  if (status === 'Sent') return 'Sent, unpaid'
  if (status === 'Partial') return 'Part paid'
  return status
}

export function docTypeLabel(type: string): string {
  return type === 'Estimate' ? 'Estimate' : type === 'Receipt' ? 'Receipt' : 'Invoice'
}
