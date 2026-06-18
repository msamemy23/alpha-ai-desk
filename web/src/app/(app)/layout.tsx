'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, getUnreadCount, getShopProfile } from '@/lib/supabase'
import PhoneWidget from '@/components/PhoneWidget'

const NAV = [
  { href: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
  { href: '/briefing', icon: 'briefing', label: 'Daily Briefing' },
  { href: '/appointments', icon: 'calendar', label: 'Appointments' },
  { href: '/customers', icon: 'customer', label: 'Customers' },
  { href: '/vehicles', icon: 'vehicle', label: 'Vehicles' },
  { href: '/jobs', icon: 'wrench', label: 'Jobs' },
  { href: '/shopboard', icon: 'board', label: 'Shop Board' },
  { href: '/estimates', icon: 'doc', label: 'Estimates' },
  { href: '/invoices', icon: 'invoice', label: 'Invoices' },
  { href: '/canned-jobs', icon: 'bolt', label: 'Canned Jobs' },
  { href: '/insurance', icon: 'shield', label: 'Insurance' },
  { href: '/parts', icon: 'parts', label: 'Parts Lookup' },
  { href: '/inventory', icon: 'box', label: 'Inventory' },
  { href: '/dvi', icon: 'inspect', label: 'Inspections (DVI)' },
  { href: '/messages', icon: 'message', label: 'Calls & Messages' },
  { href: '/voicemail', icon: 'phone', label: 'AI Voicemail' },
  { href: '/ai', icon: 'spark', label: 'Alpha AI' },
  { href: '/growth', icon: 'growth', label: 'Growth' },
  { href: '/automations', icon: 'clock', label: 'Automations' },
  { href: '/reports', icon: 'reports', label: 'Reports' },
  { href: '/onboarding', icon: 'rocket', label: 'Onboarding' },
  { href: '/settings', icon: 'settings', label: 'Settings' },
]

const PAGE_TITLES: Record<string, string> = Object.fromEntries(NAV.map(item => [item.href, item.label]))

interface Notification { id: string; type: string; title: string; body: string; time: string }

interface ShopProfile {
  shop_name: string
  phone: string
  address: string
  city_state_zip: string
}

function Icon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'dashboard':
      return <svg className={className} viewBox="0 0 24 24" {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></svg>
    case 'briefing':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M8 2v4" /><path d="M16 2v4" /><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18" /><path d="M8 15h5" /><path d="M8 18h8" /></svg>
    case 'calendar':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M8 2v4" /><path d="M16 2v4" /><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>
    case 'customer':
      return <svg className={className} viewBox="0 0 24 24" {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
    case 'vehicle':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M5 12l2-5h10l2 5" /><path d="M3 12h18v6H3z" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></svg>
    case 'wrench':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-3-3z" /></svg>
    case 'board':
      return <svg className={className} viewBox="0 0 24 24" {...common}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 3h6v4H9z" /><path d="M8 12h8" /><path d="M8 16h6" /></svg>
    case 'doc':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h5" /></svg>
    case 'invoice':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6" /><path d="M9 12h6" /><path d="M9 16h4" /></svg>
    case 'bolt':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M13 2L4 14h7l-1 8 10-13h-7z" /></svg>
    case 'shield':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
    case 'parts':
      return <svg className={className} viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a8 8 0 0 0 .1-6l2.1-1.6-2-3.5-2.6 1a8 8 0 0 0-5.1-3L11.5 0h-4l-.4 2.9a8 8 0 0 0-5.1 3l-2.6-1-2 3.5L-0.5 10a8 8 0 0 0 .1 6l-2.1 1.6 2 3.5 2.6-1a8 8 0 0 0 5.1 3l.4 2.9h4l.4-2.9a8 8 0 0 0 5.1-3l2.6 1 2-3.5z" transform="translate(2 0) scale(.83)" /></svg>
    case 'box':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M21 8l-9-5-9 5 9 5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>
    case 'inspect':
      return <svg className={className} viewBox="0 0 24 24" {...common}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
    case 'message':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg>
    case 'phone':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7l.4 2.5a2 2 0 0 1-.6 1.8L8.7 10a16 16 0 0 0 5.3 5.3l1.1-1.2a2 2 0 0 1 1.8-.6l2.5.4a2 2 0 0 1 1.6 2z" /></svg>
    case 'spark':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" /><path d="M19 15l.8 2.7L22 18.5l-2.2.8L19 22l-.8-2.7-2.2-.8 2.2-.8z" /></svg>
    case 'growth':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M3 19h18" /><path d="M7 16l4-4 3 3 6-8" /><path d="M17 7h3v3" /></svg>
    case 'clock':
      return <svg className={className} viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></svg>
    case 'reports':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M4 19V5" /><path d="M4 19h16" /><rect x="7" y="11" width="3" height="5" rx="1" /><rect x="12" y="7" width="3" height="9" rx="1" /><rect x="17" y="3" width="3" height="13" rx="1" /></svg>
    case 'rocket':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M4.5 16.5c-1 1-1.5 3-1.5 4.5 1.5 0 3.5-.5 4.5-1.5" /><path d="M9 15l-3-3 4-6c2-3 5-4 10-4 0 5-1 8-4 10z" /><path d="M15 9h.01" /><path d="M9 15l-1 5 5-1" /></svg>
    case 'settings':
      return <svg className={className} viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z" /></svg>
    case 'menu':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg>
    case 'close':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
    case 'bell':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>
    case 'sun':
      return <svg className={className} viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="M4.9 4.9l1.4 1.4" /><path d="M17.7 17.7l1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="M4.9 19.1l1.4-1.4" /><path d="M17.7 6.3l1.4-1.4" /></svg>
    case 'moon':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z" /></svg>
    case 'signout':
      return <svg className={className} viewBox="0 0 24 24" {...common}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
    default:
      return <span className={className} />
  }
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [notifLoading, setNotifLoading] = useState(false)
  const [location, setLocation] = useState('main')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [lightMode, setLightMode] = useState(false)
  const [shopProfile, setShopProfile] = useState<ShopProfile | null>(null)

  useEffect(() => {
    getUnreadCount().then(setUnread)
    getShopProfile().then(p => { if (p) setShopProfile(p) })
    const channel = supabase
      .channel('messages_unread')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        getUnreadCount().then(setUnread)
      })
      .subscribe()
    const saved = localStorage.getItem('alpha_location')
    if (saved) setLocation(saved)
    const savedMode = localStorage.getItem('alpha_light_mode')
    if (savedMode === 'true') {
      setLightMode(true)
      document.documentElement.classList.add('light')
    }
    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => { setSidebarOpen(false) }, [pathname])

  const pageTitle = useMemo(() => {
    const match = NAV.find(item => pathname.startsWith(item.href))
    return match ? PAGE_TITLES[match.href] : 'Alpha AI Desk'
  }, [pathname])

  const toggleLightMode = () => {
    const next = !lightMode
    setLightMode(next)
    localStorage.setItem('alpha_light_mode', String(next))
    document.documentElement.classList.toggle('light', next)
  }

  const loadNotifications = async () => {
    setNotifLoading(true)
    try {
      const [{ data: msgs }, { data: calls }] = await Promise.all([
        supabase.from('messages').select('id,body,from_address,created_at').eq('direction','inbound').eq('read',false).order('created_at',{ascending:false}).limit(5),
        supabase.from('calls').select('id,from_number,start_time').eq('direction','inbound').lt('duration_secs',15).order('start_time',{ascending:false}).limit(5)
      ])
      const items: Notification[] = []
      for (const m of (msgs||[])) {
        items.push({ id: m.id, type:'sms', title:'New SMS from ' + (m.from_address||'Unknown'), body: (m.body||'').slice(0,80), time: new Date(m.created_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) })
      }
      for (const c of (calls||[])) {
        items.push({ id: c.id, type:'call', title:'Missed call from ' + (c.from_number||'Unknown'), body: 'Short call - likely needs callback', time: new Date(c.start_time).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) })
      }
      setNotifications(items)
    } catch { setNotifications([]) }
    finally { setNotifLoading(false) }
  }

  const toggleNotif = () => {
    if (!notifOpen) loadNotifications()
    setNotifOpen(!notifOpen)
  }

  const switchLocation = (loc: string) => {
    setLocation(loc)
    localStorage.setItem('alpha_location', loc)
  }

  const shopName = shopProfile?.shop_name || 'My Shop'
  const shopPhone = shopProfile?.phone || '(713) 663-6979'

  return (
    <div className="flex h-screen overflow-hidden bg-bg-base text-text-primary">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/70 z-40 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 border-r border-white/10 flex flex-col shrink-0
        bg-[#111318]/98 backdrop-blur-xl shadow-2xl shadow-black/35
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:static lg:translate-x-0 lg:w-64
      `}>
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-blue text-sm font-black text-[#061114] shadow-lg shadow-blue/10">A</div>
            <div className="min-w-0">
              <div className="text-sm font-bold leading-tight truncate">Alpha AI Desk</div>
              <div className="text-xs text-text-secondary truncate">Shop command center</div>
            </div>
            <button className="ml-auto grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/10 lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
            <div className="text-[11px] font-bold uppercase text-text-muted">Desktop AI</div>
            <div className="flex items-center gap-2 text-[11px] font-bold text-green">
              <span className="h-1.5 w-1.5 rounded-full bg-green shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
              MCP ready
            </div>
          </div>
        </div>

        <div className="px-3 pt-3">
          <select className="form-select text-xs w-full bg-white/[0.04] border-white/10" value={location} onChange={e => switchLocation(e.target.value)}>
            <option value="main">{shopProfile?.address || 'Set address in Settings'}</option>
            <option value="south">South - Coming Soon</option>
            <option value="north">North - Coming Soon</option>
          </select>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map(item => {
            const active = pathname.startsWith(item.href)
            return (
              <Link key={item.href} href={item.href} className={`nav-item group ${active ? 'active' : ''}`}>
                <span className={`grid h-7 w-7 place-items-center rounded-md shrink-0 transition-colors ${active ? 'bg-blue/20 text-blue' : 'bg-white/[0.04] text-text-secondary group-hover:bg-white/[0.08] group-hover:text-text-primary'}`}>
                  <Icon name={item.icon} className="h-4 w-4" />
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.href === '/messages' && unread > 0 && (
                  <span className="bg-red text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold truncate">{shopName}</div>
              <span className="rounded-full border border-green/30 bg-green/10 px-2 py-0.5 text-[10px] font-bold text-green">Open</span>
            </div>
            <div className="text-xs text-text-secondary mt-1 truncate">{shopPhone}</div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden w-full">
        <div className="h-16 border-b border-border/80 flex items-center justify-between px-3 sm:px-5 shrink-0 bg-bg-card/90 backdrop-blur">
          <div className="flex items-center gap-3 min-w-0">
            <button className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-bg-hover/60 hover:border-blue/40 transition-colors lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <Icon name="menu" className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="text-base font-black truncate">{pageTitle}</div>
              <div className="hidden sm:block text-xs text-text-muted truncate">{shopName}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/ai"
              className="hidden sm:inline-flex min-h-9 items-center gap-2 rounded-lg border border-blue/25 bg-blue/10 px-3 text-xs font-bold text-blue transition-colors hover:bg-blue/15"
            >
              <Icon name="spark" className="h-4 w-4" />
              Ask Alpha
            </Link>
            <button
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-bg-hover/60 text-text-secondary hover:text-text-primary hover:border-blue/40 transition-colors"
              onClick={toggleLightMode}
              title={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}
              aria-label={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              <Icon name={lightMode ? 'moon' : 'sun'} className="h-4 w-4" />
            </button>

            <div className="relative">
              <button
                className="relative grid h-9 w-9 place-items-center rounded-lg border border-border bg-bg-hover/60 text-text-secondary hover:text-text-primary hover:border-blue/40 transition-colors"
                onClick={toggleNotif}
                aria-label="Notifications"
              >
                <Icon name="bell" className="h-4 w-4" />
                {notifications.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {notifications.length > 9 ? '9+' : notifications.length}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-bg-card border border-border rounded-lg shadow-xl shadow-black/30 z-50 max-h-96 overflow-y-auto">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <span className="text-sm font-bold">Notifications</span>
                    <button className="text-xs text-text-muted hover:text-text-primary" onClick={() => setNotifOpen(false)}>Close</button>
                  </div>
                  {notifLoading ? (
                    <div className="p-4 text-sm text-text-muted text-center">Loading...</div>
                  ) : notifications.length === 0 ? (
                    <div className="p-4 text-sm text-text-muted text-center">All caught up.</div>
                  ) : (
                    notifications.map(n => (
                      <div key={n.id} className="px-4 py-3 border-b border-border last:border-0 hover:bg-bg-hover">
                        <div className="text-sm font-medium">{n.title}</div>
                        <div className="text-xs text-text-muted mt-0.5">{n.body}</div>
                        <div className="text-xs text-text-muted mt-1 opacity-60">{n.time}</div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <button
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-bg-hover/60 text-text-secondary hover:text-red hover:border-red/40 transition-colors"
              title="Sign out"
              aria-label="Sign out"
              onClick={async () => {
                try { await supabase.auth.signOut() } catch {}
                document.cookie = 'alpha_authed=; max-age=0; path=/'
                window.location.href = '/login'
              }}
            >
              <Icon name="signout" className="h-4 w-4" />
            </button>
          </div>
        </div>
        <main className="flex-1 overflow-y-auto bg-bg-base">
          {children}
          <PhoneWidget />
        </main>
      </div>
    </div>
  )
}
