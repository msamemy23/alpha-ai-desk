import type { AgentId } from './capabilities'

export type IntentId =
  | 'parts_lookup'
  | 'desktop_file'
  | 'desktop_browser'
  | 'browser_kapture'
  | 'communications'
  | 'shop_ops'
  | 'reports'
  | 'mcp_status'
  | 'general'

export interface RouteDecision {
  intent: IntentId
  agentId: AgentId
  skillIds: string[]
  confidence: number
  requiresToolResult: boolean
  requiresConfirmation: boolean
  reasons: string[]
}

const PART_TERMS = /\b(brake|brakes|rotor|rotors|pad|pads|control\s+arm|control\s+arms|strut|struts|shock|shocks|bearing|hub|alternator|starter|water\s+pump|thermostat|timing\s+belt|a\/c|ac\s+compressor|tie\s+rod|ball\s+joint|axle|cv\s+axle|caliper|muffler|catalytic|spark\s+plug|coil|fuel\s+pump|radiator|belt|hose|filter|battery|part|parts)\b/i
const VEHICLE_TERMS = /\b(?:19|20)?\d{2}\b|\b(civic|accord|camry|corolla|altima|sentra|silverado|sierra|f-?150|escape|explorer|tacoma|tundra|pilot|cr-v|rav4|malibu|impala|charger|ram)\b/i
const SEND_TERMS = /\b(send|text|sms|email|call|dial|voicemail|message|reply)\b/i
const SHOP_TERMS = /\b(customer|vehicle|job|estimate|invoice|receipt|appointment|inventory|staff|timeclock|shop board|work order)\b/i
const REPORT_TERMS = /\b(report|revenue|sales|stats|how much|conversion|growth|reminder|campaign|follow-?up|review request)\b/i
const BROWSER_TERMS = /\b(open|launch|start)\s+(?:(?:google)\s+)?(?:chrome|comet)(?:\s+browser)?\b/i
const FILE_TERMS = /\b(download|save|open|show|view)\b.*\b(file|image|picture|photo|pdf|desktop)\b/i
const KAPTURE_TERMS = /\b(kapture|connected tab|dom|console|network|inspect tab|browser automation)\b/i
const MCP_TERMS = /\b(mcp|mcps|windows-mcp|tools?|skills?|agents?)\b/i
const DESTRUCTIVE_TERMS = /\b(delete|remove|void|cancel|send|post|call|dial|payment|charge|checkout|submit|enable|disable|turn on|turn off)\b/i

export function classifyRequest(input: string): RouteDecision {
  const text = input.trim()
  const lower = text.toLowerCase()
  const reasons: string[] = []

  if (MCP_TERMS.test(text) && /\b(check|test|verify|status|working|available|list|show|what)\b/i.test(text)) {
    reasons.push('MCP/tool/skill status request')
    return {
      intent: 'mcp_status',
      agentId: 'desktop',
      skillIds: ['browser_tab_inspection_kapture'],
      confidence: 0.95,
      requiresToolResult: true,
      requiresConfirmation: false,
      reasons,
    }
  }

  if (PART_TERMS.test(text) && VEHICLE_TERMS.test(text)) {
    reasons.push('vehicle plus part/service terms')
    if (BROWSER_TERMS.test(text)) reasons.push('requested local browser open')
    return {
      intent: 'parts_lookup',
      agentId: 'parts',
      skillIds: ['verified_parts_search'],
      confidence: 0.94,
      requiresToolResult: true,
      requiresConfirmation: false,
      reasons,
    }
  }

  if (KAPTURE_TERMS.test(text)) {
    reasons.push('Kapture/browser automation request')
    return {
      intent: 'browser_kapture',
      agentId: 'browser',
      skillIds: ['browser_tab_inspection_kapture'],
      confidence: 0.9,
      requiresToolResult: true,
      requiresConfirmation: DESTRUCTIVE_TERMS.test(lower),
      reasons,
    }
  }

  if (FILE_TERMS.test(text)) {
    reasons.push('desktop file workflow request')
    return {
      intent: 'desktop_file',
      agentId: 'desktop',
      skillIds: ['desktop_file_workflow'],
      confidence: 0.88,
      requiresToolResult: true,
      requiresConfirmation: false,
      reasons,
    }
  }

  if (BROWSER_TERMS.test(text)) {
    reasons.push('local browser launch request')
    return {
      intent: 'desktop_browser',
      agentId: 'desktop',
      skillIds: [],
      confidence: 0.86,
      requiresToolResult: true,
      requiresConfirmation: false,
      reasons,
    }
  }

  if (SEND_TERMS.test(text)) {
    reasons.push('communications request')
    return {
      intent: 'communications',
      agentId: 'communications',
      skillIds: ['call_summary_followup'],
      confidence: 0.82,
      requiresToolResult: DESTRUCTIVE_TERMS.test(lower),
      requiresConfirmation: DESTRUCTIVE_TERMS.test(lower),
      reasons,
    }
  }

  if (REPORT_TERMS.test(text)) {
    reasons.push('reporting/growth request')
    return {
      intent: 'reports',
      agentId: 'reports',
      skillIds: [],
      confidence: 0.78,
      requiresToolResult: true,
      requiresConfirmation: false,
      reasons,
    }
  }

  if (SHOP_TERMS.test(text)) {
    reasons.push('shop operations request')
    return {
      intent: 'shop_ops',
      agentId: 'shop_ops',
      skillIds: ['customer_lookup_context'],
      confidence: 0.78,
      requiresToolResult: /create|update|add|schedule|mark|void|delete|remove/i.test(text),
      requiresConfirmation: /delete|remove|void/i.test(text),
      reasons,
    }
  }

  return {
    intent: 'general',
    agentId: 'router',
    skillIds: [],
    confidence: 0.35,
    requiresToolResult: false,
    requiresConfirmation: false,
    reasons: ['no deterministic specialist match'],
  }
}

export function normalizeVehicleYear(text: string) {
  return text
    .replace(/\b(\d{2})\s+(civic|accord)\b/gi, (_match, year, model) => `20${year} Honda ${model}`)
    .replace(/\b(\d{4})\s+(civic|accord)\b/gi, (_match, year, model) => `${year} Honda ${model}`)
}
