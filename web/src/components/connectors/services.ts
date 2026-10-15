export interface Connector {
  id: string
  service: string
  enabled: boolean
  page_id: string | null
  metadata: Record<string, unknown>
  updated_at: string
}

export interface ServiceInfo {
  icon: string
  name: string
  short: string
  description: string
  note: string
  oauthPath: string
}

export const SERVICE_INFO: Record<string, ServiceInfo> = {
  facebook: {
    icon: 'globe',
    name: 'Facebook Pages',
    short: 'Facebook',
    description: 'Post updates, reply to comments and manage messages.',
    note: 'Connecting Facebook also connects Instagram when your page is linked to it.',
    oauthPath: '/api/auth/facebook',
  },
  instagram: {
    icon: 'camera',
    name: 'Instagram Business',
    short: 'Instagram',
    description: 'Post photos and reply to comments and messages.',
    note: 'Instagram signs in through Facebook, so you will see the Facebook sign-in.',
    oauthPath: '/api/auth/facebook', // Instagram shares the Facebook OAuth flow
  },
  google_business: {
    icon: 'map',
    name: 'Google Business Profile',
    short: 'Google Business',
    description: 'Post updates, reply to reviews and see your ratings.',
    note: 'Connecting Google Business also connects Google Calendar.',
    oauthPath: '/api/auth/google',
  },
  google_calendar: {
    icon: 'calendar',
    name: 'Google Calendar',
    short: 'Google Calendar',
    description: 'Schedule appointments and manage bookings.',
    note: 'Google Calendar signs in through Google, together with Google Business.',
    oauthPath: '/api/auth/google',
  },
}

export const SERVICE_ORDER = ['facebook', 'instagram', 'google_business', 'google_calendar']

/** The name of the connected account, when the app told us one. Never an internal ID dressed up as a name. */
export function accountLabel(connector: Connector): { name: string | null; id: string | null } {
  const meta = connector.metadata || {}
  for (const key of ['page_name', 'account_name', 'profile_name', 'location_name']) {
    if (typeof meta[key] === 'string' && meta[key]) return { name: meta[key] as string, id: null }
  }
  return { name: null, id: connector.page_id }
}
