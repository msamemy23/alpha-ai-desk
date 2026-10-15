import type { PermissionLevel } from '@/lib/ai/capabilities'

export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue'

/**
 * Plain words for what the helpers are and do. The server list is written for developers,
 * so a shop owner sees these instead. Anything not listed here falls back to the server's own words.
 */
export const AGENT_PURPOSE: Record<string, string> = {
  router: 'Reads each request and passes it to the right helper. It will not answer until the helper has real results.',
  shop_ops: 'Looks after customers, vehicles, jobs, appointments, estimates, invoices, canned jobs and the shop board.',
  parts: 'Finds parts with verified prices and source links, adds labor references, and hands the result to an estimate.',
  repair: 'Researches repairs from manuals, procedures, service bulletins, recalls, diagrams and specs, and drafts cards for you to review.',
  desktop: 'Does safe things on this computer, such as opening Chrome and saving files, through the Alpha Desk desktop app.',
  browser: 'Reads and works in a Chrome tab you have connected.',
  communications: 'Handles calls, texts, email, voicemail, call summaries and follow-up messages.',
  reports: 'Reports on revenue, jobs, reminders, growth and campaigns.',
  safety: 'Checks approvals, risky actions and permissions, keeps each shop’s data apart, and keeps the log of what was done.',
}

export const TOOL_COPY: Record<string, { name: string; what: string }> = {
  partsLookup: { name: 'Find parts and prices', what: 'Finds verified parts, prices, source links and labor references for a vehicle.' },
  repairSearch: { name: 'Research a repair', what: 'Looks up manuals, procedures, bulletins, recalls, diagrams and specs for the exact vehicle, and drafts an estimate for you to review.' },
  openBrowser: { name: 'Open a web page', what: 'Opens a safe web address in Chrome or Comet on this computer.' },
  desktopDownloadImage: { name: 'Save a picture', what: 'Finds or downloads a public picture to your Desktop, and can open it.' },
  desktopOpenFile: { name: 'Open a file', what: 'Opens a file that was created or picked in this session.' },
  mcpDiscover: { name: 'List desktop tools', what: 'Checks which Windows and Chrome tools are available on this computer.' },
  mcpCallTool: { name: 'Run a desktop tool', what: 'Runs an approved tool on this computer. Tools that take action ask you first.' },
  sendSms: { name: 'Send a text', what: 'Sends a text message once you confirm it.' },
  shopAction: { name: 'Change shop records', what: 'Creates, updates and searches customers, jobs, estimates and other shop records.' },
}

export const SKILL_COPY: Record<string, { name: string; what: string }> = {
  verified_parts_search: { name: 'Verified parts search', what: 'Turns shorthand like “04 Civic” into the exact vehicle, lists each part position, and shows only prices and links that could be verified.' },
  build_estimate_from_verified_parts: { name: 'Build an estimate from verified parts', what: 'Turns the parts you pick into a draft estimate with labor and tax. You see a preview before anything is saved.' },
  source_backed_repair_research: { name: 'Source-backed repair research', what: 'Finds the exact vehicle, searches free public manuals, and ranks procedures, specs and diagrams. It prepares a draft estimate for a technician to review and never invents specs.' },
  customer_lookup_context: { name: 'Customer lookup', what: 'Searches customers, jobs, paperwork, messages and vehicles before Alpha acts.' },
  browser_tab_inspection_kapture: { name: 'Inspect a browser tab', what: 'Reads a connected Chrome tab: its page, screenshots, errors and network activity.' },
  desktop_file_workflow: { name: 'Desktop files', what: 'Saves, downloads, opens and screenshots files through the Alpha Desk desktop app.' },
  call_summary_followup: { name: 'Call summary and follow-up', what: 'Summarizes a call and creates follow-up actions.' },
  missed_call_recovery: { name: 'Missed call recovery', what: 'Finds missed calls, matches the customer, drafts a callback text and schedules a reminder.' },
  review_request_campaign: { name: 'Review request campaign', what: 'Finds eligible customers and prepares review requests.' },
  service_reminder_campaign: { name: 'Service reminder campaign', what: 'Finds customers who are due for service and drafts reminders.' },
  invoice_estimate_send: { name: 'Send an estimate or invoice', what: 'Finds the paperwork and the customer, checks the recipient, and sends it after you confirm.' },
}

export const PERMISSION_LABEL: Record<PermissionLevel, { label: string; tone: Tone }> = {
  read: { label: 'Reads only', tone: 'green' },
  write: { label: 'Changes data', tone: 'blue' },
  external: { label: 'Contacts others', tone: 'amber' },
  destructive: { label: 'Deletes data', tone: 'red' },
  sensitive: { label: 'Sensitive data', tone: 'amber' },
}

/** The desktop app's own names for its two connections, in words a shop owner would use. */
export const SERVER_NAME: Record<string, string> = {
  windows: 'Windows control',
  kapture: 'Chrome link',
  desktop: 'Desktop app',
}
