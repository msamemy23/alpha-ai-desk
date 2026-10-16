/**
 * What every assistant action is, in plain words, and how risky it is.
 *
 * One table drives four things so they can never disagree:
 *   - the review card ("Needs your OK") says what will happen and whether it
 *     can be undone BEFORE the owner approves;
 *   - the shop rules (see shop-rules.ts) gate actions by permission class;
 *   - the Activity screen labels each entry and decides if Undo applies;
 *   - the server (ai-action) records the class with each audit entry.
 *
 * Pure module: no imports from '@/' so node:test can load it directly.
 */

/** read < draft < save < send < charge, in order of how much they can hurt. */
export type PermissionClass = 'read' | 'draft' | 'save' | 'send' | 'charge'

/**
 * undoable    : Alpha can put it back with a compensating action (Activity -> Undo).
 * manual      : It can be changed back, but by hand on another page.
 * irreversible: Once approved it cannot be taken back (a sent message, a deletion).
 * none        : Nothing is changed (a look-up or a draft that is not saved).
 */
export type Reversibility = 'undoable' | 'manual' | 'irreversible' | 'none'

export type ActionInfo = {
  id: string
  title: string
  past: string
  permission: PermissionClass
  reversibility: Reversibility
  /** Reaches a customer or a third party when it runs. */
  customerFacing: boolean
  /** Removes, voids or deactivates something. Styles the approve button red. */
  danger: boolean
  area: string
  /** One plain sentence about undo, shown on the review card. */
  undoNote: string
}

type Extra = Partial<Pick<ActionInfo, 'customerFacing' | 'danger' | 'undoNote'>>

function entry(id: string, title: string, past: string, permission: PermissionClass, reversibility: Reversibility, area: string, extra: Extra = {}): ActionInfo {
  return {
    id, title, past, permission, reversibility, area,
    customerFacing: extra.customerFacing ?? false,
    danger: extra.danger ?? false,
    undoNote: extra.undoNote ?? '',
  }
}

const READS: [string, string, string, string][] = [
  ['searchCustomers', 'Search customers', 'Searched customers', 'Customers'],
  ['getCustomerHistory', 'Look up a customer history', 'Looked up a customer history', 'Customers'],
  ['getShopStats', 'Look up shop totals', 'Looked up shop totals', 'Reports'],
  ['listStaff', 'List staff', 'Listed staff', 'Team'],
  ['getInventory', 'Look up inventory', 'Looked up inventory', 'Inventory'],
  ['getTimeclockReport', 'Look up the time clock', 'Looked up the time clock', 'Team'],
  ['searchWeb', 'Search the web', 'Searched the web', 'Research'],
  ['webSearch', 'Search the web', 'Searched the web', 'Research'],
  ['lookupParts', 'Look up parts and labor', 'Looked up parts and labor', 'Parts'],
  ['repairSearch', 'Search repair information', 'Searched repair information', 'Research'],
  ['browse', 'Read a web page', 'Read a web page', 'Research'],
  ['navigate', 'Open a screen', 'Opened a screen', 'App'],
  ['posts', 'Look at repair posts', 'Looked at repair posts', 'Posts'],
]

const WRITES: ActionInfo[] = [
  entry('createCustomer', 'Add a customer', 'Added a customer', 'save', 'undoable', 'Customers', { undoNote: 'Undo removes the new customer, as long as no job or document has been added to them.' }),
  entry('updateCustomer', 'Change a customer', 'Changed a customer', 'save', 'undoable', 'Customers', { undoNote: 'Undo puts the old details back, as long as the customer has not been changed again.' }),
  entry('createJob', 'Open a job', 'Opened a job', 'save', 'undoable', 'Jobs', { undoNote: 'Undo removes the new job, as long as nothing has been added to it.' }),
  entry('updateJobStatus', 'Change a job status', 'Changed a job status', 'save', 'undoable', 'Jobs', { undoNote: 'Undo puts the old status back, as long as the job has not been changed again.' }),
  entry('createInvoice', 'Save a draft document', 'Saved a draft document', 'save', 'undoable', 'Documents', { undoNote: 'Undo voids the draft. Its number stays on record.' }),
  entry('updateDocument', 'Change a document', 'Changed a document', 'save', 'undoable', 'Documents', { undoNote: 'Undo puts the old details back, as long as the document has not been changed again.' }),
  entry('voidDocument', 'Void a document', 'Voided a document', 'save', 'undoable', 'Documents', { danger: true, undoNote: 'Undo puts the old status back. A paid document cannot be restored this way.' }),
  entry('convertEstimateToInvoice', 'Turn an estimate into an invoice', 'Turned an estimate into an invoice', 'save', 'undoable', 'Documents', { undoNote: 'Undo voids the new draft invoice. The estimate is not touched.' }),
  entry('deleteRecord', 'Delete a record', 'Deleted a record', 'save', 'irreversible', 'Records', { danger: true, undoNote: 'The record and anything attached to it are gone for good.' }),
  entry('scheduleFollowUp', 'Schedule a follow-up', 'Scheduled a follow-up', 'send', 'undoable', 'Messages', { customerFacing: true, undoNote: 'Undo cancels it while it is still waiting. Once it has gone out it cannot be taken back.' }),
  entry('sendEstimateEmail', 'Email a document', 'Emailed a document', 'send', 'irreversible', 'Documents', { customerFacing: true, undoNote: 'An email cannot be taken back once it is sent.' }),
  entry('addStaff', 'Add a staff member', 'Added a staff member', 'save', 'undoable', 'Team', { undoNote: 'Undo marks them inactive again.' }),
  entry('removeStaff', 'Deactivate a staff member', 'Deactivated a staff member', 'save', 'undoable', 'Team', { danger: true, undoNote: 'Undo makes them active again. Their history is never removed.' }),
  entry('createAppointment', 'Book an appointment', 'Booked an appointment', 'save', 'undoable', 'Schedule', { undoNote: 'Undo removes the appointment, as long as it has not been changed again.' }),
  entry('updateAppointment', 'Change an appointment', 'Changed an appointment', 'save', 'undoable', 'Schedule', { undoNote: 'Undo puts the old details back, as long as it has not been changed again.' }),
  entry('deleteAppointment', 'Delete an appointment', 'Deleted an appointment', 'save', 'undoable', 'Schedule', { danger: true, undoNote: 'Undo puts the appointment back from a saved copy.' }),
  entry('updateInventory', 'Update inventory', 'Updated inventory', 'save', 'undoable', 'Inventory', { undoNote: 'Undo puts the old values back, as long as the item has not been changed again.' }),
  entry('message.sms', 'Text a customer', 'Texted a customer', 'send', 'irreversible', 'Messages', { customerFacing: true, undoNote: 'A text cannot be taken back once it is sent.' }),
  entry('message.email', 'Email a customer', 'Emailed a customer', 'send', 'irreversible', 'Messages', { customerFacing: true, undoNote: 'An email cannot be taken back once it is sent.' }),
  entry('call', 'Place a phone call', 'Placed a phone call', 'send', 'irreversible', 'Calls', { customerFacing: true, undoNote: 'A call cannot be taken back once it starts.' }),
  entry('aiVoiceCall', 'Start an assistant phone call', 'Started an assistant phone call', 'send', 'irreversible', 'Calls', { customerFacing: true, undoNote: 'A call cannot be taken back once it starts.' }),
  entry('connector.post', 'Send through a connected app', 'Sent through a connected app', 'send', 'irreversible', 'Connected apps', { customerFacing: true, undoNote: 'Anything posted or sent through another app stays there until you remove it in that app.' }),
  entry('posts.prepare', 'Make a post draft', 'Made a post draft', 'save', 'manual', 'Posts', { undoNote: 'To undo, skip the draft on the Posts screen. Nothing was posted.' }),
  entry('posts.skip', 'Skip a post', 'Skipped a post', 'save', 'manual', 'Posts', { undoNote: 'The post stays in the log on the Posts screen. Nothing was posted or deleted.' }),
  entry('posts.mode', 'Change repair posting', 'Changed repair posting', 'save', 'manual', 'Posts', { undoNote: 'To undo, change it back on the Posts screen.' }),
  entry('posts.customerOkOff', 'Take away a customer yes', 'Took away a customer yes', 'save', 'manual', 'Posts', { undoNote: 'To undo, turn Customer OK back on, on the job.' }),
  entry('posts.approve', 'Post a repair to the public', 'Posted a repair to the public', 'send', 'irreversible', 'Posts', { customerFacing: true, undoNote: 'Once it is public it stays there until you remove it in that app.' }),
  entry('scheduleTask', 'Schedule an automation', 'Scheduled an automation', 'save', 'manual', 'Automations', { undoNote: 'To undo, turn it off on the Automations page.' }),
  entry('automationControl', 'Change an automation', 'Changed an automation', 'save', 'manual', 'Automations', { undoNote: 'To undo, change it back on the Automations page.' }),
  entry('webAutomation', 'Use a website for you', 'Used a website for you', 'send', 'irreversible', 'Browser', { customerFacing: true, undoNote: 'What happens on another website cannot be taken back from here.' }),
  entry('desktop', 'Run something on your computer', 'Ran something on your computer', 'save', 'irreversible', 'Computer', { undoNote: 'Changes on your computer cannot be taken back from here.' }),
  entry('payment', 'Take a payment', 'Took a payment', 'charge', 'irreversible', 'Payments', { customerFacing: true, undoNote: 'Refunds are handled on the payment itself, not here.' }),
]

export const ACTIONS: Record<string, ActionInfo> = Object.fromEntries([
  ...READS.map(([id, title, past, area]) => [id, entry(id, title, past, 'read', 'none', area)] as const),
  ['proposeDocument', entry('proposeDocument', 'Show a draft', 'Showed a draft', 'draft', 'none', 'Documents', { undoNote: 'Nothing is saved until you approve it.' })] as const,
  ...WRITES.map(info => [info.id, info] as const),
])

/** Ids whose names carry a suffix after a dot, such as automationControl.pause. */
const PREFIX_FAMILIES = ['automationControl', 'webAutomation', 'desktop', 'payment']

function familyOf(id: string): string {
  const head = id.split('.')[0]
  if (head.startsWith('desktop')) return 'desktop'
  return head
}

/**
 * Look an action up by its id. An unknown action is treated as the riskiest
 * kind it could be (a change that cannot be undone) so it is always asked
 * about, never waved through.
 */
export function getActionInfo(id: string): ActionInfo {
  const exact = ACTIONS[id]
  if (exact) return exact
  const family = familyOf(id)
  if (family === 'message') return /email/i.test(id) ? ACTIONS['message.email'] : ACTIONS['message.sms']
  if (family === 'connector' || family === 'connectors') return { ...ACTIONS['connector.post'], id }
  if (ACTIONS[family] && PREFIX_FAMILIES.includes(family)) return { ...ACTIONS[family], id }
  if (/^(?:record)?payment|^charge|^refund/i.test(id)) return { ...ACTIONS.payment, id }
  // The connector tools are named "<connector>.<action>". Anything with a dot
  // that we do not know reaches another service.
  if (id.includes('.')) return { ...ACTIONS['connector.post'], id }
  if (/^(?:get|list|search|lookup|read|find|fetch)/i.test(id)) return entry(id, id, id, 'read', 'none', 'Other')
  return entry(id, humanize(id), humanize(id), 'save', 'irreversible', 'Other', { undoNote: 'This cannot be taken back from here.' })
}

export function permissionClassOf(id: string): PermissionClass {
  return getActionInfo(id).permission
}

export function humanize(id: string): string {
  const words = id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Action'
}

export const PERMISSION_LABELS: Record<PermissionClass, { name: string; help: string }> = {
  read: { name: 'Look things up', help: 'Search customers, jobs, documents, inventory and the web. Nothing changes.' },
  draft: { name: 'Prepare drafts', help: 'Write estimates, invoices and messages for you to review. Nothing is saved or sent.' },
  save: { name: 'Change shop records', help: 'Add or change customers, jobs, documents, appointments, staff and inventory.' },
  send: { name: 'Contact customers', help: 'Send texts and emails, schedule follow-ups, place calls. These reach people outside your shop.' },
  charge: { name: 'Take payments', help: 'Charge cards or record payments. The assistant can never do this.' },
}

export const PERMISSION_ORDER: PermissionClass[] = ['read', 'draft', 'save', 'send', 'charge']

export type ReviewTag = { text: string; tone: 'gray' | 'red' | 'green' | 'amber' | 'blue' }

/** The pills shown on a review card, in the order they are read. */
export function reviewTags(info: ActionInfo): ReviewTag[] {
  const tags: ReviewTag[] = []
  if (info.customerFacing) tags.push({ text: info.permission === 'charge' ? 'Charges a customer' : 'Reaches a customer', tone: 'gray' })
  if (info.reversibility === 'irreversible') tags.push({ text: 'Cannot be undone', tone: 'red' })
  else if (info.reversibility === 'undoable') tags.push({ text: 'Can be undone', tone: 'green' })
  else if (info.reversibility === 'manual') tags.push({ text: 'Undo by hand', tone: 'amber' })
  return tags
}

/** The sentence that sits on the review card before anything is approved. */
export function undoSentence(info: ActionInfo): string {
  if (info.reversibility === 'none') return info.undoNote || 'Nothing is changed.'
  if (info.reversibility === 'irreversible') return `Cannot be undone. ${info.undoNote}`.trim()
  if (info.reversibility === 'manual') return info.undoNote
  return `You can undo this later from Activity. ${info.undoNote}`.trim()
}
