// The map of the app. Phone tab bar shows PRIMARY; everything else lives
// under the Menu sheet (phone) or the left rail (desktop).

export interface NavItem {
  href: string
  label: string
  icon: string
  /** Extra path prefixes that should light this item up. */
  also?: string[]
}

export const PRIMARY: NavItem[] = [
  { href: '/dashboard', label: 'Today', icon: 'today', also: ['/briefing'] },
  { href: '/customers', label: 'Customers', icon: 'customers', also: ['/vehicles'] },
  { href: '/work', label: 'Work', icon: 'work', also: ['/estimates', '/invoices', '/receipts', '/jobs', '/shopboard', '/dvi', '/canned-jobs', '/insurance'] },
  { href: '/messages', label: 'Inbox', icon: 'inbox', also: ['/voicemail'] },
  { href: '/ai', label: 'Ask Alpha', icon: 'alpha' },
]

export interface NavGroup { label: string; items: NavItem[] }

export const MORE_GROUPS: NavGroup[] = [
  {
    label: 'In the shop',
    items: [
      { href: '/appointments', label: 'Schedule', icon: 'calendar' },
      { href: '/shopboard', label: 'Shop board', icon: 'board' },
      { href: '/jobs', label: 'Jobs', icon: 'wrench' },
      { href: '/dvi', label: 'Inspections', icon: 'inspect' },
      { href: '/vehicles', label: 'Vehicles', icon: 'vehicle' },
      { href: '/inventory', label: 'Inventory', icon: 'box' },
      { href: '/parts', label: 'Parts lookup', icon: 'parts' },
      { href: '/repair', label: 'Repair info', icon: 'manual' },
    ],
  },
  {
    label: 'Money and paperwork',
    items: [
      { href: '/estimates', label: 'Estimates', icon: 'doc' },
      { href: '/invoices', label: 'Invoices', icon: 'invoice' },
      { href: '/canned-jobs', label: 'Canned jobs', icon: 'bolt' },
      { href: '/insurance', label: 'Insurance claims', icon: 'shield' },
      { href: '/reports', label: 'Reports', icon: 'reports' },
    ],
  },
  {
    label: 'Calls, texts and growth',
    items: [
      { href: '/growth', label: 'Get more customers', icon: 'growth' },
      { href: '/automations', label: 'Automations', icon: 'clock' },
    ],
  },
  {
    label: 'Your account',
    items: [
      { href: '/staff', label: 'Team', icon: 'staff' },
      { href: '/connectors', label: 'Connected apps', icon: 'plug' },
      { href: '/tools', label: 'Agents and tools', icon: 'tools' },
      { href: '/onboarding', label: 'Setup guide', icon: 'rocket' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

export const ALL_ITEMS: NavItem[] = [...PRIMARY, ...MORE_GROUPS.flatMap(g => g.items)]

export function matches(pathname: string, item: NavItem): boolean {
  const hit = (p: string) => pathname === p || pathname.startsWith(p + '/')
  return hit(item.href) || (item.also?.some(hit) ?? false)
}

/**
 * The one item that should look selected in the desktop rail, which lists every page. The most specific page wins, so
 * Vehicles lights up on /vehicles instead of Customers and Vehicles together. Pages with no item of their own fall back to
 * the item that lists them in `also`. The phone tab bar only shows PRIMARY, so it keeps using `matches`.
 */
export function activeHref(pathname: string): string | null {
  const own = (i: NavItem) => pathname === i.href || pathname.startsWith(i.href + '/')
  let best: NavItem | null = null
  for (const i of ALL_ITEMS) if (own(i) && (!best || i.href.length > best.href.length)) best = i
  if (best) return best.href
  return ALL_ITEMS.find(i => matches(pathname, i))?.href ?? null
}

/** Page name for the header. Most specific match wins. */
export function titleFor(pathname: string): string {
  const exact = ALL_ITEMS.find(i => pathname === i.href || pathname.startsWith(i.href + '/'))
  if (exact) return exact.label
  const loose = ALL_ITEMS.find(i => matches(pathname, i))
  return loose ? loose.label : 'Alpha Desk'
}
