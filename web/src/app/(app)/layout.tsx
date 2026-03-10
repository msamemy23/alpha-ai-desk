'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase, getUnreadCount } from '@/lib/supabase'

const NAV = [
  { href: '/dashboard', icon: '📊', label: 'Dashboard' },
  { href: '/customers', icon: '👤', label: 'Customers' },
  { href: '/jobs', icon: '🔧', label: 'Jobs' },
  { href: '/estimates', icon: '📄', label: 'Estimates' },
  { href: '/invoices', icon: '📋', label: 'Invoices' },
  { href: '/receipts', icon: '🧾', label: 'Receipts' },
  { href: '/messages', icon: '💬', label: 'Messages' },
  { href: '/ai', icon: '🤖', label: 'Alpha AI' },
  { href: '/settings', icon: '⚙️', label: 'Settings' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    getUnreadCount().then(setUnread)
    const channel = supabase
      .channel('messages_unread')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        getUnreadCount().then(setUnread)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 bg-bg-card border-r border-border flex flex-col shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
          <div className="w-9 h-9 rounded-lg bg-blue/20 flex items-center justify-center text-lg">🔧</div>
          <div>
            <div className="text-sm font-bold text-text-primary leading-tight">Alpha AI Desk</div>
            <div className="text-xs text-text-muted">Auto Center</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${pathname.startsWith(item.href) ? 'active' : ''}`}
            >
              <span>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.href === '/messages' && unread > 0 && (
                <span className="bg-red text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <div className="text-xs text-text-muted text-center">Alpha International Auto Center</div>
          <div className="text-xs text-text-muted text-center">(713) 663-6979</div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-bg-base">
        {children}
      </main>
    </div>
  )
}
