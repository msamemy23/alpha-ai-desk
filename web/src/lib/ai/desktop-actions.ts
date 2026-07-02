export type BrowserApp = 'chrome' | 'comet'

export interface DesktopImageRequest {
  query: string
  filename: string
  open: boolean
}

export interface BrowserRequest {
  app: BrowserApp
  url: string
  query: string
}

export interface DesktopOpenResult {
  ok?: boolean
  verified?: boolean
  app?: string
  path?: string
  url?: string
  pid?: number
  processRunning?: boolean
  error?: string
}

export interface DesktopDownloadResult {
  ok?: boolean
  verified?: boolean
  path?: string
  url?: string
  bytes?: number
  fileExists?: boolean
  opened?: boolean
  openError?: string
  error?: string
}

const IMAGE_WORDS = /\b(image|picture|photo|png|jpe?g|webp|gif)\b/i
const FETCH_WORDS = /\b(download|save|grab|get|find|search|look\s+up|look\s+online)\b/i
const BROWSER_OPEN_RE = /\b(open|launch|start)\s+(?:(google)\s+)?(chrome|comet)(?:\s+browser)?\b/i
const PART_TERMS = /\b(brake|brakes|rotor|rotors|pad|pads|control\s+arm|control\s+arms|strut|struts|shock|shocks|bearing|hub|alternator|starter|water\s+pump|thermostat|timing\s+belt|a\/c|ac\s+compressor|tie\s+rod|ball\s+joint|axle|cv\s+axle|caliper|muffler|catalytic|spark\s+plug|coil|fuel\s+pump|radiator|belt|hose|filter|battery|part|parts)\b/i
const VEHICLE_TERMS = /\b(?:19|20)?\d{2}\b|\b(civic|accord|camry|corolla|altima|sentra|silverado|sierra|f-?150|escape|explorer|tacoma|tundra|pilot|cr-v|rav4|malibu|impala|charger|ram)\b/i

function expandTwoDigitVehicleYear(year: string) {
  const value = Number(year)
  return value >= 80 ? `19${year.padStart(2, '0')}` : `20${year.padStart(2, '0')}`
}

function normalizeVehicleYearText(text: string) {
  return text
    .replace(/\b(\d{2})\s+(civic|accord)\b/gi, (_match, year, model) => `${expandTwoDigitVehicleYear(year)} Honda ${model}`)
    .replace(/\b(\d{4})\s+(civic|accord)\b/gi, (_match, year, model) => `${year} Honda ${model}`)
    .replace(/\b04\s+honda\b/gi, '2004 Honda')
    .replace(/\b05\s+honda\b/gi, '2005 Honda')
}

export function cleanDesktopQuery(value: string) {
  return normalizeVehicleYearText(value)
    .replace(/\b(open|launch|start)\s+(?:(?:google)\s+)?(?:chrome|comet)(?:\s+browser)?\b/gi, ' ')
    .replace(/\b(search|look\s+up|look\s+online\s+for|find|get|grab|download|save|go\s+to\s+google)\b/gi, ' ')
    .replace(/\b(a|an|the|picture|image|photo|png|jpg|jpeg|webp|gif|of|online|onto|on|to|my|desktop|file|please|now|do\s+it)\b/gi, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'downloaded-image'
}

function wantsOpenDownloadedFile(text: string) {
  return /\b(?:and|then)\s+(?:open|show|view)\s+(?:it|the\s+(?:file|download|image|picture|photo))\b/i.test(text) ||
    /^(?:open|show|view|launch)\s+(?:the\s+)?(?:file|download|image|picture|photo|it)\s*$/i.test(text.trim()) ||
    /\b(?:open|show|view)\s+(?:the\s+)?(?:downloaded|saved)\s+(?:file|image|picture|photo)\b/i.test(text)
}

export function parseDesktopImageRequest(text: string): DesktopImageRequest | null {
  if (!IMAGE_WORDS.test(text) || !FETCH_WORDS.test(text)) return null

  const directMatch =
    text.match(/\b(?:picture|image|photo)\s+of\s+(.+?)(?:[.!?]|$)/i) ||
    text.match(/\b(?:search|find|get|download|save|grab).*?\b(?:for|of)\s+(.+?)(?:[.!?]|$)/i)
  const query = cleanDesktopQuery(directMatch?.[1] || text)
  if (!query) return null

  return { query, filename: `${slug(query)}.png`, open: wantsOpenDownloadedFile(text) }
}

function extractBrowserSearchQuery(text: string) {
  const withoutUrl = text.replace(/\bhttps?:\/\/[^\s]+/gi, ' ')
  const searchMatch =
    withoutUrl.match(/\b(?:search|find|look\s+up|look\s+online\s+for)\s+(?:for\s+)?([\s\S]+)$/i) ||
    withoutUrl.match(/\bgo\s+to\s+google\s+and\s+search\s+(?:for\s+)?([\s\S]+)$/i)
  const source = searchMatch?.[1] || withoutUrl
  return cleanDesktopQuery(source)
}

export function parseBrowserRequest(text: string): BrowserRequest | null {
  const browserMatch = text.match(BROWSER_OPEN_RE)
  if (!browserMatch) return null
  const app: BrowserApp = browserMatch[3].toLowerCase() === 'comet' ? 'comet' : 'chrome'
  const urlMatch = text.match(/\bhttps?:\/\/[^\s]+/i)
  const query = urlMatch ? '' : extractBrowserSearchQuery(text)
  return {
    app,
    url: urlMatch?.[0] || (query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : ''),
    query,
  }
}

export function wantsOpenPreviousDesktopFile(text: string) {
  return /^(?:open|show|view|launch)\s+(?:the\s+)?(?:last\s+)?(?:file|download|image|picture|photo|it)\s*$/i.test(text.trim())
}

export function wantsKaptureSetup(text: string) {
  return /\bkapture\b/i.test(text) && /\b(set\s*up|install|connect|extension|chrome)\b/i.test(text)
}

export function looksLikePartsRequest(text: string) {
  return PART_TERMS.test(text) && VEHICLE_TERMS.test(text) && /\b(find|search|look\s+up|look\s+online|price|prices|cost|how\s+much|get|need|quote)\b/i.test(text)
}

function normalizeBrakeScope(query: string) {
  if (/\b(?:all\s*(?:4|four)|(?:4|four)\s*(?:wheel|wheels|brakes?))\b/i.test(query) && /\bbrakes?\b/i.test(query)) {
    return query
      .replace(/\b(?:all\s*(?:4|four)|(?:4|four)\s*(?:wheel|wheels|brakes?))\s*brakes?\b/gi, 'front and rear brake pads and rotors')
      .replace(/\bbrakes?\s+(?:all\s*(?:4|four)|(?:4|four)\s*(?:wheel|wheels))\b/gi, 'front and rear brake pads and rotors')
  }
  if (/\bfront\s+brakes?\b/i.test(query) && !/\b(pads?|rotors?|calipers?)\b/i.test(query)) {
    return query.replace(/\bfront\s+brakes?\b/gi, 'front brake pads and rotors')
  }
  if (/\brear\s+brakes?\b/i.test(query) && !/\b(pads?|rotors?|calipers?)\b/i.test(query)) {
    return query.replace(/\brear\s+brakes?\b/gi, 'rear brake pads and rotors')
  }
  return query
}

export function normalizePartsQuery(text: string) {
  let query = normalizeVehicleYearText(text)
    .replace(BROWSER_OPEN_RE, ' ')
    .replace(/\bgo\s+to\s+(autozone|auto\s*zone|oreilly|o'reilly|napa|advance|advance\s+auto|rockauto|pepboys|pep\s+boys)\b/gi, '$1')
    .replace(/\b(find|search|look\s+up|look\s+online\s+for|get|need|me|please|now|do\s+it)\b/gi, ' ')
    .replace(/\bfront\s+ones\s+both\s+sides\b/gi, 'front left and front right')
    .replace(/\bboth\s+sides\b/gi, 'left and right')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  query = normalizeBrakeScope(query)
  return query.replace(/\s+/g, ' ').trim() || text
}

export function isVerifiedBrowserOpen(result: DesktopOpenResult | null | undefined) {
  return !!(result?.ok && result.verified === true && result.path && result.processRunning !== false)
}

export function isVerifiedDownloadResult(result: DesktopDownloadResult | null | undefined) {
  return !!(result?.ok && result.verified === true && result.fileExists === true && Number(result.bytes || 0) > 0 && result.path)
}

export function formatBrowserOpenResult(result: DesktopOpenResult | null | undefined, request: BrowserRequest) {
  const label = request.app === 'comet' ? 'Comet' : 'Chrome'
  if (!isVerifiedBrowserOpen(result)) {
    return `${label} did not open with verified control: ${result?.error || 'launch was not verified'}.`
  }

  const searchText = request.query ? ` to a Google search for "${request.query}"` : ''
  return `${label} opened${searchText}. I verified the local browser process started. I did not claim tab control; connect Kapture if you want me to inspect, click, type, or submit inside that tab.`
}

export function formatDownloadResult(result: DesktopDownloadResult | null | undefined, query: string) {
  if (!isVerifiedDownloadResult(result)) {
    return `Image download failed verification: ${result?.error || 'file was not written and verified'}.`
  }

  const verified = result as DesktopDownloadResult
  const opened = verified.opened ? ' I also opened it.' : verified.openError ? ` The file saved, but opening it failed: ${verified.openError}.` : ''
  return `Downloaded ${query} to ${verified.path}. Verified the file exists on Desktop (${verified.bytes} bytes).${opened}`
}
