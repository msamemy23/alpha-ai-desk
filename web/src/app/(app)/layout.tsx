'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, getUnreadCount, getShopProfile, getShopId } from '@/lib/supabase'
import PhoneWidget from '@/components/PhoneWidget'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import SearchPanel from '@/components/shell/SearchPanel'
import { PRIMARY, MORE_GROUPS, matches } from '@/components/shell/nav'

interface Notice { id: string; kind: 'text' | 'call'; title: string; body: string; when: string; href: string }
interface ShopProfile { id?: string; shop_name: string; phone: string; address: string; city_state_zip: string }

const timeLabel = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)
  const [shop, setShop] = useState<ShopProfile | null>(null)
  const [dark, setDark] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [notices, setNotices] = useState<Notice[]>([])
  const [noticeState, setNoticeState] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    getUnreadCount().then(setUnread).catch(() => {})
    getShopProfile().then(p => { if (p) setShop(p) }).catch(() => {})
    const channel = supabase
      .channel('shell_unread')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        getUnreadCount().then(setUnread).catch(() => {})
      })
      .subscribe()
    const c = document.documentElement.classList
    setDark(c.contains('dark') || (!c.contains('light') && window.matchMedia('(prefers-color-scheme: dark)').matches))
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Close any open sheet when the page changes.
  useEffect(() => { setMenuOpen(false); setSearchOpen(false); setNoticeOpen(false) }, [pathname])

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    const c = document.documentElement.classList
    c.toggle('dark', next)
    c.toggle('light', !next)
    try { localStorage.setItem('alpha_theme', next ? 'dark' : 'light') } catch { /* private mode */ }
  }

  const signOut = async () => {
    try { await supabase.auth.signOut() } catch { /* the cookie is cleared below either way */ }
    document.cookie = 'alpha_authed=; max-age=0; path=/'
    window.location.href = '/login'
  }

  const loadNotices = useCallback(async () => {
    setNoticeState('loading')
    try {
      const shopId = await getShopId()
      if (!shopId) { setNotices([]); setNoticeState('idle'); return }
      const [msgs, calls] = await Promise.all([
        supabase.from('messages').select('id,body,from_address,created_at').eq('shop_id', shopId).eq('direction', 'inbound').eq('read', false).order('created_at', { ascending: false }).limit(6),
        supabase.from('call_history').select('id,from_number,start_time,duration_secs,status').eq('shop_id', shopId).eq('direction', 'inbound').lt('duration_secs', 15).order('start_time', { ascending: false }).limit(6),
      ])
      if (msgs.error && calls.error) throw msgs.error
      const items: Notice[] = [
        ...(msgs.data || []).map((m: Record<string, unknown>) => ({
          id: `m-${m.id}`, kind: 'text' as const, title: `Text from ${m.from_address || 'unknown number'}`,
          body: String(m.body || '').slice(0, 90), when: String(m.created_at), href: '/messages',
        })),
        ...(calls.data || []).map((c: Record<string, unknown>) => ({
          id: `c-${c.id}`, kind: 'call' as const, title: `Missed call from ${c.from_number || 'unknown number'}`,
          body: 'Call them back', when: String(c.start_time), href: '/messages',
        })),
      ].sort((a, b) => b.when.localeCompare(a.when))
      setNotices(items)
      setNoticeState('idle')
    } catch {
      setNoticeState('error')
    }
  }, [])

  const openNotices = () => { setNoticeOpen(true); loadNotices() }

  const shopName = shop?.shop_name || 'Your shop'
  const isChat = pathname === '/ai'
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])
  const closeNotices = useCallback(() => setNoticeOpen(false), [])

  return (
    <div className="flex h-dvh overflow-hidden bg-bg-base text-text-primary">
      <a href="#main" className="skip-link">Skip to content</a>

      {/* ---------- Desktop rail ---------- */}
      <aside className="shell-rail no-print hidden w-[15.5rem] shrink-0 flex-col lg:flex" aria-label="Main">
        <div className="px-5 pb-4 pt-5">
          <Link href="/dashboard" className="flex items-center gap-2.5 no-underline">
            <span className="lamp lamp-green" aria-hidden="true" />
            <span className="display text-[1.25rem] font-bold leading-none">Alpha Desk</span>
          </Link>
          <p className="mt-2 truncate text-[0.875rem] text-text-secondary" title={shopName}>{shopName}</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Shop navigation">
          <ul className="space-y-0.5">
            {PRIMARY.map(item => (
              <li key={item.href}>
                <Link href={item.href} className="rail-link" aria-current={matches(pathname, item) ? 'page' : undefined}>
                  <Icon name={item.icon} className="h-5 w-5 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.href === '/messages' && unread > 0 && (
                    <span className="rounded-full bg-[rgb(var(--lamp-red))] px-1.5 text-[0.75rem] font-bold leading-5 text-white">{unread > 99 ? '99+' : unread}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {MORE_GROUPS.map(group => (
            <div key={group.label} className="mt-5">
              <p className="rail-group">{group.label}</p>
              <ul className="space-y-0.5">
                {group.items.map(item => (
                  <li key={item.href}>
                    <Link href={item.href} className="rail-link" aria-current={pathname === item.href || pathname.startsWith(item.href + '/') ? 'page' : undefined}>
                      <Icon name={item.icon} className="h-5 w-5 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-border px-3 py-3">
          <div className="flex items-center gap-1">
            <button type="button" className="rail-link flex-1 border-0 bg-transparent text-left" onClick={toggleTheme}>
              <Icon name={dark ? 'sun' : 'moon'} className="h-5 w-5 shrink-0" />
              {dark ? 'Light mode' : 'Dark mode'}
            </button>
            <button type="button" className="btn-icon" onClick={signOut} aria-label="Sign out" title="Sign out">
              <Icon name="signout" className="h-5 w-5" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* ---------- Top bar ---------- */}
        <header className="shell-top no-print flex h-14 shrink-0 items-center gap-2 border-b border-border bg-bg-chrome px-3 sm:px-5 lg:h-16">
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2.5 no-underline lg:hidden">
            <span className="lamp lamp-green" aria-hidden="true" />
            <span className="display truncate text-[1.125rem] font-bold">{shopName}</span>
          </Link>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="hidden h-10 w-full max-w-md items-center gap-2 rounded-md border border-line bg-bg-input px-3 text-left text-[0.9375rem] text-text-muted hover:bg-bg-hover lg:flex"
          >
            <Icon name="search" className="h-5 w-5" />
            <span className="flex-1">Search customers and paperwork</span>
          </button>
          <div className="hidden flex-1 lg:block" />

          <Link href="/ai" className="btn btn-secondary btn-sm hidden lg:inline-flex">
            <Icon name="alpha" className="h-4 w-4" />
            Ask Alpha
          </Link>
          <button type="button" className="btn-icon lg:hidden" onClick={() => setSearchOpen(true)} aria-label="Search">
            <Icon name="search" className="h-5 w-5" />
          </button>
          <button type="button" className="btn-icon relative" onClick={openNotices} aria-label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}>
            <Icon name="bell" className="h-5 w-5" />
            {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-[rgb(var(--lamp-red))] ring-2 ring-[rgb(var(--c-chrome))]" />}
          </button>
          <button type="button" className="btn-icon lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Icon name="menu" className="h-5 w-5" />
          </button>
        </header>

        <main id="main" className={`min-h-0 flex-1 ${isChat ? 'overflow-hidden' : 'overflow-y-auto'} ${isChat ? '' : 'app-main-pad'}`}>
          {children}
          <PhoneWidget />
        </main>
      </div>

      {/* ---------- Phone tab bar ---------- */}
      <nav className="tabbar no-print lg:hidden" aria-label="Main">
        {PRIMARY.map(item => (
          <Link key={item.href} href={item.href} className="tab" aria-current={matches(pathname, item) ? 'page' : undefined}>
            <Icon name={item.icon} className="h-6 w-6" />
            <span>{item.label}</span>
            {item.href === '/messages' && unread > 0 && <span className="tab-badge">{unread > 99 ? '99+' : unread}</span>}
          </Link>
        ))}
      </nav>

      {/* ---------- Sheets ---------- */}
      <Sheet open={menuOpen} onClose={closeMenu} title={shopName}>
        <p className="-mt-2 mb-4 text-[0.9375rem] text-text-secondary">{shop?.phone || 'Everything else in Alpha Desk'}</p>
        {MORE_GROUPS.map(group => (
          <section key={group.label} className="mb-5">
            <h3 className="mb-2 text-[0.8125rem] font-bold text-text-secondary">{group.label}</h3>
            <ul className="grid grid-cols-2 gap-2">
              {group.items.map(item => (
                <li key={item.href}>
                  <Link href={item.href} className="flex min-h-[52px] items-center gap-2.5 rounded-md border border-border bg-bg-base px-3 text-[0.9375rem] font-bold no-underline hover:bg-bg-hover">
                    <Icon name={item.icon} className="h-5 w-5 shrink-0 text-text-secondary" />
                    <span className="leading-tight">{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div className="flex gap-2 border-t border-border pt-4">
          <button type="button" className="btn btn-secondary flex-1" onClick={toggleTheme}>
            <Icon name={dark ? 'sun' : 'moon'} className="h-5 w-5" />
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
          <button type="button" className="btn btn-secondary flex-1" onClick={signOut}>
            <Icon name="signout" className="h-5 w-5" />
            Sign out
          </button>
        </div>
      </Sheet>

      <Sheet open={searchOpen} onClose={closeSearch} title="Search" hideTitle>
        <SearchPanel autoFocus onNavigate={closeSearch} />
      </Sheet>

      <Sheet open={noticeOpen} onClose={closeNotices} title="Alerts">
        {noticeState === 'loading' && <p className="py-4 text-text-secondary">Checking for new texts and missed calls…</p>}
        {noticeState === 'error' && (
          <div className="py-2">
            <p className="text-red">Alerts could not be loaded.</p>
            <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={loadNotices}>Try again</button>
          </div>
        )}
        {noticeState === 'idle' && notices.length === 0 && (
          <p className="py-4 text-text-secondary">No unread texts or missed calls. You are caught up.</p>
        )}
        {noticeState === 'idle' && notices.length > 0 && (
          <ul className="ledger">
            {notices.map(n => (
              <li key={n.id}>
                <Link href={n.href} className="ledger-row" onClick={closeNotices}>
                  <span className={`lamp ${n.kind === 'call' ? 'lamp-red' : 'lamp-blue'}`} aria-hidden="true" />
                  <span className="ledger-main">
                    <span className="ledger-title block">{n.title}</span>
                    <span className="ledger-sub block">{n.body}</span>
                  </span>
                  <span className="text-[0.8125rem] text-text-muted">{timeLabel(n.when)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  )
}
