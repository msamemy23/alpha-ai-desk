export type AgentId =
  | 'router'
  | 'shop_ops'
  | 'parts'
  | 'repair'
  | 'desktop'
  | 'browser'
  | 'communications'
  | 'reports'
  | 'safety'

export type PermissionLevel = 'read' | 'write' | 'external' | 'destructive' | 'sensitive'

export interface AgentDefinition {
  id: AgentId
  name: string
  purpose: string
  owns: string[]
  handoffWhen: string[]
  defaultSkillIds: string[]
}

export interface ToolDefinition {
  name: string
  agentId: AgentId
  description: string
  permission: PermissionLevel
  timeoutMs: number
  retry: { attempts: number; backoffMs: number }
  audit: boolean
  requiresConfirmation: boolean
  inputSchema: Record<string, string>
  resultShape: Record<string, string>
}

export interface SkillDefinition {
  id: string
  name: string
  ownerAgentId: AgentId
  description: string
  requiredTools: string[]
  successCriteria: string[]
  failureBehavior: string
  examples: string[]
}

export const AGENTS: AgentDefinition[] = [
  {
    id: 'router',
    name: 'Router Agent',
    purpose: 'Classifies the request, chooses the specialist, and refuses to answer before required tool results exist.',
    owns: ['intent classification', 'handoffs', 'tool result gating'],
    handoffWhen: ['Always hand off when a specialist owns the requested action.'],
    defaultSkillIds: [],
  },
  {
    id: 'shop_ops',
    name: 'Shop Ops Agent',
    purpose: 'Customers, vehicles, jobs, appointments, estimates, invoices, canned jobs, and shop board work.',
    owns: ['customers', 'vehicles', 'jobs', 'documents', 'appointments', 'inventory'],
    handoffWhen: ['The user mentions a customer, vehicle, job, estimate, invoice, appointment, or shop workflow.'],
    defaultSkillIds: ['customer_lookup_context', 'invoice_estimate_send'],
  },
  {
    id: 'parts',
    name: 'Parts Agent',
    purpose: 'Verified parts search, pricing, source links, labor references, and estimate handoff.',
    owns: ['parts lookup', 'pricing', 'store links', 'labor references'],
    handoffWhen: ['The request contains a vehicle and a part/service to price or source.'],
    defaultSkillIds: ['verified_parts_search', 'build_estimate_from_verified_parts'],
  },
  {
    id: 'repair',
    name: 'Repair Agent',
    purpose: 'Source-backed repair research, manuals, procedures, TSBs, recalls, diagrams, specs, and shop-reviewed draft cards.',
    owns: ['repair manuals', 'procedures', 'DTC research', 'TSBs', 'recalls', 'wiring/source links', 'shop repair drafts'],
    handoffWhen: ['The user asks for a repair procedure, manual, torque spec, wiring diagram, TSB, recall, DTC, or step-by-step workflow.'],
    defaultSkillIds: ['source_backed_repair_research'],
  },
  {
    id: 'desktop',
    name: 'Desktop Agent',
    purpose: 'Safe local desktop actions through the Electron bridge and Windows-MCP.',
    owns: ['Chrome', 'Comet', 'files', 'screenshots', 'Windows-MCP'],
    handoffWhen: ['The request asks to open an app, save/open a file, capture the screen, or inspect/control Windows.'],
    defaultSkillIds: ['desktop_file_workflow'],
  },
  {
    id: 'browser',
    name: 'Browser Agent',
    purpose: 'Kapture-powered browser tab inspection and browser automation when a tab is connected.',
    owns: ['Kapture', 'connected tabs', 'DOM inspection', 'browser clicks/forms'],
    handoffWhen: ['The request asks to inspect or operate an existing browser tab.'],
    defaultSkillIds: ['browser_tab_inspection_kapture'],
  },
  {
    id: 'communications',
    name: 'Communications Agent',
    purpose: 'Calls, SMS, email, voicemail, call summaries, and follow-up messaging.',
    owns: ['SMS', 'email', 'calls', 'voicemail', 'follow-ups'],
    handoffWhen: ['The request sends, calls, replies, summarizes a call, or schedules contact.'],
    defaultSkillIds: ['call_summary_followup', 'missed_call_recovery', 'invoice_estimate_send'],
  },
  {
    id: 'reports',
    name: 'Reports Agent',
    purpose: 'Revenue, conversion, jobs, reminders, growth, and operational reporting.',
    owns: ['reports', 'stats', 'campaign performance', 'reminders'],
    handoffWhen: ['The user asks for numbers, trends, revenue, conversion, reminders, or performance.'],
    defaultSkillIds: ['review_request_campaign', 'service_reminder_campaign'],
  },
  {
    id: 'safety',
    name: 'Safety Agent',
    purpose: 'Approvals, destructive action checks, permission gates, tenant boundaries, and audit policy.',
    owns: ['approvals', 'risk checks', 'permission gates', 'audit policy'],
    handoffWhen: ['Any action is destructive, external, sensitive, or changes customer/shop data.'],
    defaultSkillIds: [],
  },
]

export const TOOLS: ToolDefinition[] = [
  {
    name: 'partsLookup',
    agentId: 'parts',
    description: 'Find verified parts, pricing, source links, positions, and labor reference for a vehicle request.',
    permission: 'read',
    timeoutMs: 45000,
    retry: { attempts: 1, backoffMs: 0 },
    audit: true,
    requiresConfirmation: false,
    inputSchema: { query: 'string', stores: 'string[] optional' },
    resultShape: { ok: 'boolean', data: 'vehicle, positions, options, kits, source confidence' },
  },
  {
    name: 'repairSearch',
    agentId: 'repair',
    description: 'Find source-backed repair manuals, procedures, TSBs, recalls, diagrams, specs, and technician-review draft cards.',
    permission: 'read',
    timeoutMs: 60000,
    retry: { attempts: 1, backoffMs: 0 },
    audit: true,
    requiresConfirmation: false,
    inputSchema: { query: 'string', vehicle: 'vin/year/make/model/engine optional' },
    resultShape: { ok: 'boolean', data: 'normalized vehicle, source cards, counts, draft checklist, warnings' },
  },
  {
    name: 'openBrowser',
    agentId: 'desktop',
    description: 'Open Chrome or Comet to a safe http/https URL.',
    permission: 'external',
    timeoutMs: 15000,
    retry: { attempts: 1, backoffMs: 0 },
    audit: true,
    requiresConfirmation: false,
    inputSchema: { app: 'chrome | comet', url: 'http/https URL optional' },
    resultShape: { ok: 'boolean', app: 'string', path: 'string', url: 'string', error: 'string optional' },
  },
  {
    name: 'desktopDownloadImage',
    agentId: 'desktop',
    description: 'Search/download a safe public image to Desktop and optionally open it.',
    permission: 'external',
    timeoutMs: 45000,
    retry: { attempts: 1, backoffMs: 0 },
    audit: true,
    requiresConfirmation: false,
    inputSchema: { query: 'string optional', url: 'string optional', filename: 'string optional', open: 'boolean optional' },
    resultShape: { ok: 'boolean', path: 'string', url: 'string', opened: 'boolean', error: 'string optional' },
  },
  {
    name: 'desktopOpenFile',
    agentId: 'desktop',
    description: 'Open a file created or selected in the current desktop session.',
    permission: 'external',
    timeoutMs: 15000,
    retry: { attempts: 1, backoffMs: 0 },
    audit: true,
    requiresConfirmation: false,
    inputSchema: { path: 'session-approved local path' },
    resultShape: { ok: 'boolean', path: 'string', error: 'string optional' },
  },
  {
    name: 'mcpDiscover',
    agentId: 'desktop',
    description: 'Discover Windows-MCP and Kapture tools/resources/prompts.',
    permission: 'read',
    timeoutMs: 90000,
    retry: { attempts: 1, backoffMs: 0 },
    audit: true,
    requiresConfirmation: false,
    inputSchema: { server: 'windows | kapture optional' },
    resultShape: { ok: 'boolean', servers: 'MCP server status and tool list' },
  },
  {
    name: 'mcpCallTool',
    agentId: 'desktop',
    description: 'Call an allowlisted MCP tool. Action tools require confirmation.',
    permission: 'sensitive',
    timeoutMs: 120000,
    retry: { attempts: 0, backoffMs: 0 },
    audit: true,
    requiresConfirmation: true,
    inputSchema: { server: 'windows | kapture', name: 'exact tool name', args: 'object', approved: 'boolean optional' },
    resultShape: { ok: 'boolean', content: 'MCP content[]', structuredContent: 'object optional', error: 'string optional' },
  },
  {
    name: 'sendSms',
    agentId: 'communications',
    description: 'Send SMS after user confirmation.',
    permission: 'external',
    timeoutMs: 30000,
    retry: { attempts: 1, backoffMs: 1000 },
    audit: true,
    requiresConfirmation: true,
    inputSchema: { to: 'phone', body: 'message', customerId: 'string optional', idempotencyKey: 'string optional' },
    resultShape: { ok: 'boolean', messageId: 'string optional', error: 'string optional' },
  },
  {
    name: 'shopAction',
    agentId: 'shop_ops',
    description: 'Create/update/search shop records through /api/ai-action.',
    permission: 'write',
    timeoutMs: 30000,
    retry: { attempts: 0, backoffMs: 0 },
    audit: true,
    requiresConfirmation: false,
    inputSchema: { action: 'string', payload: 'object', idempotencyKey: 'string optional' },
    resultShape: { ok: 'boolean', data: 'object optional', error: 'string optional' },
  },
]

export const SKILLS: SkillDefinition[] = [
  {
    id: 'verified_parts_search',
    name: 'Verified Parts Search',
    ownerAgentId: 'parts',
    description: 'Normalize vehicle shorthand, decompose positions, search sources, and return only verified prices or source links.',
    requiredTools: ['partsLookup', 'openBrowser'],
    successCriteria: ['Vehicle is normalized', 'positions are listed', 'prices have exact sources or are marked unavailable'],
    failureBehavior: 'Say exact prices could not be verified and show real source links only.',
    examples: ['open Comet and find front brakes for a 04 Civic', 'find both front lower control arms for a 2005 Civic'],
  },
  {
    id: 'build_estimate_from_verified_parts',
    name: 'Build Estimate From Verified Parts',
    ownerAgentId: 'parts',
    description: 'Convert verified part options into a draft estimate with labor and tax.',
    requiredTools: ['partsLookup', 'shopAction'],
    successCriteria: ['Uses only verified parts/prices', 'includes labor reference', 'creates preview before saving'],
    failureBehavior: 'Ask user to choose verified parts before building an estimate.',
    examples: ['build an estimate with the mid option', 'quote that with labor'],
  },
  {
    id: 'source_backed_repair_research',
    name: 'Source-Backed Repair Research',
    ownerAgentId: 'repair',
    description: 'Search free public manuals, NHTSA data, OEM indexes, and shop notes while refusing to invent specs or copyrighted procedure text.',
    requiredTools: ['repairSearch'],
    successCriteria: ['Vehicle is normalized', 'source links are returned', 'draft procedure is marked technician-review required', 'no unsupported specs are invented'],
    failureBehavior: 'Show source links and explain what could not be verified.',
    examples: ['find the repair procedure for 2018 Jeep Wrangler coolant tank', 'show torque specs for 2004 Civic front brakes', 'look up P0420 diagnostic procedure for 2012 Accord'],
  },
  {
    id: 'customer_lookup_context',
    name: 'Customer Lookup And Context',
    ownerAgentId: 'shop_ops',
    description: 'Search customer, jobs, docs, messages, and vehicles before acting.',
    requiredTools: ['shopAction'],
    successCriteria: ['All matching customers shown', 'vehicle context is carried forward'],
    failureBehavior: 'Ask one clarifying question if multiple ambiguous matches exist.',
    examples: ['look up Rufina', 'what does John owe'],
  },
  {
    id: 'browser_tab_inspection_kapture',
    name: 'Browser Tab Inspection With Kapture',
    ownerAgentId: 'browser',
    description: 'Use Kapture connected tabs for DOM, screenshots, console, and network inspection.',
    requiredTools: ['mcpDiscover', 'mcpCallTool'],
    successCriteria: ['Connected tab exists', 'read-only inspection happens before action tools'],
    failureBehavior: 'Report no connected tabs and give exact extension connection steps.',
    examples: ['inspect this Chrome tab', 'check console errors on this page'],
  },
  {
    id: 'desktop_file_workflow',
    name: 'Desktop File Workflow',
    ownerAgentId: 'desktop',
    description: 'Save, download, open, reveal, screenshot, and print through the safe desktop bridge.',
    requiredTools: ['desktopDownloadImage', 'desktopOpenFile'],
    successCriteria: ['Only session-approved file paths are opened', 'success is claimed only after ok:true'],
    failureBehavior: 'Return exact desktop bridge error.',
    examples: ['download a picture of Pikachu', 'open the file'],
  },
  {
    id: 'call_summary_followup',
    name: 'Call Summary And Follow-Up',
    ownerAgentId: 'communications',
    description: 'Summarize calls and create follow-up actions.',
    requiredTools: ['shopAction', 'sendSms'],
    successCriteria: ['Summary is attached to customer/call', 'follow-up send is confirmed'],
    failureBehavior: 'Save draft follow-up and ask for confirmation.',
    examples: ['summarize that call and text them', 'schedule a follow-up tomorrow'],
  },
  {
    id: 'missed_call_recovery',
    name: 'Missed Call Recovery',
    ownerAgentId: 'communications',
    description: 'Find missed calls, identify customer, draft callback SMS, and schedule reminder.',
    requiredTools: ['shopAction', 'sendSms'],
    successCriteria: ['Customer/call linked', 'message requires confirmation'],
    failureBehavior: 'Show missed call and draft only.',
    examples: ['follow up missed calls', 'text missed callers'],
  },
  {
    id: 'review_request_campaign',
    name: 'Review Request Campaign',
    ownerAgentId: 'reports',
    description: 'Find eligible customers and prepare review request outreach.',
    requiredTools: ['shopAction', 'sendSms'],
    successCriteria: ['Audience is scoped to shop', 'send requires confirmation'],
    failureBehavior: 'Show draft campaign and missing settings.',
    examples: ['send review requests', 'turn on review follow-up'],
  },
  {
    id: 'service_reminder_campaign',
    name: 'Service Reminder Campaign',
    ownerAgentId: 'reports',
    description: 'Find due customers and draft reminders.',
    requiredTools: ['shopAction', 'sendSms'],
    successCriteria: ['Audience is scoped to shop', 'send requires confirmation'],
    failureBehavior: 'Show due list and draft message only.',
    examples: ['send service reminders', 'who is due this month'],
  },
  {
    id: 'invoice_estimate_send',
    name: 'Invoice/Estimate Send Flow',
    ownerAgentId: 'shop_ops',
    description: 'Resolve document/customer, verify recipient, and send after confirmation.',
    requiredTools: ['shopAction'],
    successCriteria: ['Document exists', 'recipient exists', 'send action is logged'],
    failureBehavior: 'Ask for missing document or recipient.',
    examples: ['send that estimate', 'email invoice INV-2026-0004'],
  },
]

export function getCapabilitySnapshot() {
  return {
    agents: AGENTS,
    tools: TOOLS,
    skills: SKILLS,
    generatedAt: new Date().toISOString(),
  }
}
