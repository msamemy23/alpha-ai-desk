import type { MetadataRoute } from 'next'

/**
 * What a phone reads when someone adds Alpha Desk to the home screen. It opens full screen on Today, with the
 * repair-order tag icon on a graphite tile. Nothing private is in here: it is served without signing in.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Alpha Desk',
    short_name: 'Alpha Desk',
    description: 'The office manager for independent auto repair shops: customers, estimates, invoices, texts, calls and an AI that handles the paperwork.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#13161a',
    theme_color: '#13161a',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Today', url: '/dashboard', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Inbox', url: '/messages', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Work', url: '/work', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Ask Alpha', url: '/ai', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
  }
}
