import { blastTemplate, firstWord } from '@/lib/automation-text'
import type { ShopFacts } from './types'

export interface Field {
  key: string
  label: string
  hint: string
  type: 'int' | 'select' | 'text' | 'textarea'
  min?: number
  max?: number
  options?: { value: string; label: string }[]
  /** Read this key when the main one has not been saved yet. */
  fallbackKey?: string
  default: string | number
}

export type Kind = 'text' | 'email' | 'draft' | 'search' | 'unavailable'

export interface AutoCopy {
  name: string
  icon: string
  kind: Kind
  /** True when it reaches real people, so turning it on or running it shows a preview first. */
  contacts: boolean
  /** What it does, in one honest sentence or two. */
  does: string
  /** Who it reaches. */
  who: string
  /** Extra points to read before it goes out, in order. `warn` ones are shown in amber. */
  notes: { warn: boolean; text: string }[]
  /** The settings that change what it does. Anything else the server lists is ignored by the server, so it is not shown. */
  fields: Field[]
}

const NO_OPT_OUT = 'This text does not tell people how to opt out. Anyone who has already replied STOP is skipped.'

export const CATEGORIES = [
  { id: 'retention', label: 'Keep customers coming back', icon: 'repeat' },
  { id: 'operations', label: 'Run the shop', icon: 'wrench' },
  { id: 'growth', label: 'Find new customers', icon: 'growth' },
  { id: 'marketing', label: 'Get the word out', icon: 'send' },
]

export const SCAN_LABEL: Record<string, string> = {
  both: 'Both kinds',
  competitors: 'Unhappy customers of other repair shops',
  alpha_ai: 'Businesses with vehicle fleets',
}

export const COPY: Record<string, AutoCopy> = {
  review_requests: {
    name: 'Review requests',
    icon: 'star',
    kind: 'text',
    contacts: true,
    does: 'Texts customers who had an invoice in the last 7 days and asks for a Google review. A customer is asked at most once a week.',
    who: 'Customers with an invoice from the last 7 days.',
    notes: [
      { warn: true, text: NO_OPT_OUT },
      { warn: false, text: 'The link in the text is the Google review link saved in Settings.' },
    ],
    fields: [],
  },
  estimate_followups: {
    name: 'Estimate follow-ups',
    icon: 'doc',
    kind: 'text',
    contacts: true,
    does: 'Follows up once on an estimate that has not been booked. It texts the customer, or emails them when there is no phone number to text.',
    who: 'Customers with an open estimate, sent between the wait time and 14 days ago.',
    notes: [
      { warn: true, text: NO_OPT_OUT },
      { warn: false, text: 'The email goes out only if email sending is set up for your shop.' },
    ],
    fields: [
      { key: 'followup_hours', label: 'Hours to wait after an estimate', hint: 'Between 1 and 720. A follow-up goes out once an estimate is this old.', type: 'int', min: 1, max: 720, default: 48 },
    ],
  },
  re_engagement: {
    name: 'Win-back texts',
    icon: 'repeat',
    kind: 'text',
    contacts: true,
    does: 'Texts customers who have not been in for a while. Alpha writes each text with AI, and nobody is texted twice in 30 days.',
    who: 'Customers whose last invoice is older than the number of months you choose.',
    notes: [
      { warn: false, text: 'To read every text before it goes out, send them from Get more customers instead.' },
      { warn: true, text: NO_OPT_OUT },
      { warn: false, text: 'It texts everyone who qualifies in one run. There is no limit.' },
    ],
    fields: [
      { key: 'months_threshold', label: 'Months since their last visit', hint: 'Between 1 and 60. Customers whose last invoice is older than this get a text.', type: 'int', min: 1, max: 60, default: 3 },
    ],
  },
  service_reminders: {
    name: 'Oil change reminders',
    icon: 'wrench',
    kind: 'text',
    contacts: true,
    does: 'Texts a customer when more than 85 days or 2,500 miles have passed since the last oil change on their vehicle. A vehicle is reminded at most once every 30 days.',
    who: 'Owners of vehicles with an oil change on an invoice.',
    notes: [
      { warn: true, text: NO_OPT_OUT },
      { warn: false, text: 'The 85 days and 2,500 miles are built in and cannot be changed here.' },
      { warn: false, text: 'Who is due depends on each vehicle’s history, so the number cannot be counted before it runs.' },
    ],
    fields: [],
  },
  appointment_reminders: {
    name: 'Appointment reminders',
    icon: 'calendar',
    kind: 'text',
    contacts: true,
    does: 'Texts customers the day before their appointment, once per appointment.',
    who: 'Customers with a scheduled or confirmed appointment tomorrow.',
    notes: [
      { warn: true, text: NO_OPT_OUT },
      { warn: false, text: 'It always goes out the day before, in your shop’s time zone.' },
    ],
    fields: [],
  },
  lead_discovery: {
    name: 'Lead search',
    icon: 'search',
    kind: 'search',
    contacts: false,
    does: 'Searches near your shop for new leads and saves them in Get more customers. It does not contact anyone.',
    who: 'Nobody. It only adds leads for you to look at.',
    notes: [],
    fields: [
      { key: 'scan_type', label: 'What to look for', hint: 'The kind of leads to find.', type: 'select', default: 'alpha_ai', options: Object.entries(SCAN_LABEL).map(([value, label]) => ({ value, label })) },
      { key: 'city', label: 'City to search', hint: 'Filled in from your shop’s profile. Change it to search a different city.', type: 'text', default: '' },
    ],
  },
  lead_outreach: {
    name: 'Automatic lead emails',
    icon: 'mail',
    kind: 'email',
    contacts: true,
    does: 'Emails your leads that have an email address and have not been contacted yet, oldest first. Alpha writes each email with AI.',
    who: 'Leads marked New that have an email address.',
    notes: [
      { warn: true, text: 'These emails have no unsubscribe link, and leads Alpha found on the web have not asked to hear from you. Email laws expect an easy way to opt out.' },
    ],
    fields: [
      { key: 'limit', label: 'Most emails each run', hint: 'Between 1 and 50.', type: 'int', min: 1, max: 50, default: 10, fallbackKey: 'daily_limit' },
    ],
  },
  sms_blast: {
    name: 'Promotional text',
    icon: 'send',
    kind: 'text',
    contacts: true,
    does: 'Sends the same promotional text to your customers, up to 100 at a time. The text is the one you write here.',
    who: 'Your 100 oldest customer records that have a phone number.',
    notes: [
      { warn: true, text: 'It is always the same 100 customers, the ones who were added first, not your whole list.' },
      { warn: true, text: 'The same number is not checked twice. Two customer records with one phone number both send.' },
    ],
    fields: [
      { key: 'message_template', label: 'The text', hint: 'Type {name} where the customer’s first name goes.', type: 'textarea', default: '' },
    ],
  },
  social_posts: {
    name: 'Daily post drafts',
    icon: 'image',
    kind: 'draft',
    contacts: false,
    does: 'Saves a draft post for you to review in Get more customers. Nothing is published, and no one is contacted.',
    who: 'Nobody.',
    notes: [
      { warn: false, text: 'The draft says the same thing each time. Edit it in Get more customers before you use it.' },
    ],
    fields: [],
  },
  review_responses: {
    name: 'Review replies',
    icon: 'thumbsUp',
    kind: 'unavailable',
    contacts: false,
    does: 'Not available yet. Alpha cannot read your Google reviews, so it has nothing to reply to.',
    who: 'Nobody.',
    notes: [],
    fields: [],
  },
}

export const copyFor = (id: string, fallbackName: string): AutoCopy => COPY[id] || {
  name: fallbackName, icon: 'clock', kind: 'text', contacts: false, does: '', who: '', notes: [], fields: [],
}

export interface Sample {
  /** `exact` is the real text. `written` is the text Alpha writes with AI, so only a guide can be shown. */
  how: 'exact' | 'written' | 'none'
  subject?: string
  body: string
}

/**
 * What the text or email says, taken from the server's own wording with this shop's details filled in.
 * Names that change per person stay in [brackets].
 */
export function sampleFor(id: string, shop: ShopFacts, config: Record<string, unknown>, person?: { name?: string; service?: string; time?: string }): Sample {
  const shopName = shop.name || 'our shop'
  const name = person?.name || '[full name]'
  switch (id) {
    case 'review_requests':
      return { how: 'exact', body: `Hi ${name}! Thank you for choosing ${shopName}. If you had a great experience, we'd love a Google review!${shop.reviewUrl ? ` ${shop.reviewUrl}` : ''} It means the world to us!` }
    case 'estimate_followups': {
      const contact = shop.phone ? `Call us at ${shop.phone} or reply here.` : 'Reply here to schedule.'
      return {
        how: 'exact',
        body: `Hi ${name}! Just checking in — we sent you an estimate for [estimate total] for your vehicle. We'd love to help you get it done. ${contact} ${shopName}`,
        subject: `Following up on your estimate — ${shopName}`,
      }
    }
    case 'service_reminders':
      return { how: 'exact', body: `Hi ${name}! Your [year make model] is due for an oil change. ${shopName} is ready for you${shop.phone ? ` — call ${shop.phone}` : ''} or just reply to this text!` }
    case 'appointment_reminders': {
      const service = person?.service ? ` for ${person.service}` : ' for [service]'
      const time = person?.time ? ` at ${person.time}` : ' at [time]'
      return { how: 'exact', body: `Hi ${name}! Reminder: you have an appointment${service} at ${shopName} tomorrow${time}.${shop.phone ? ` Call ${shop.phone}` : ''} if you need to reschedule. See you then!` }
    }
    case 'sms_blast':
      return { how: 'exact', body: blastTemplate(config.message_template).replace(/\{name\}/gi, person?.name ? firstWord(person.name) : '[first name]') }
    case 're_engagement':
      return { how: 'written', body: 'Alpha writes a short, friendly text for each customer, under 160 characters, using their name and last service.' }
    case 'lead_outreach':
      return { how: 'written', body: 'Alpha writes a short email for each lead, using what you know about them. Your shop name, phone and address are added at the bottom.' }
    case 'social_posts':
      return { how: 'exact', body: `${shopName}: Keep your vehicle running safely with trusted local auto repair. Message us to schedule service.` }
    default:
      return { how: 'none', body: '' }
  }
}
