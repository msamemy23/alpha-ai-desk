import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/overpass/wght.css'
import '@fontsource/atkinson-hyperlegible-next/400.css'
import '@fontsource/atkinson-hyperlegible-next/500.css'
import '@fontsource/atkinson-hyperlegible-next/700.css'
import './globals.css'
import InstallBridge from '@/components/InstallBridge'

export const metadata: Metadata = {
  title: { default: 'Alpha Desk', template: '%s · Alpha Desk' },
  description: 'The office manager for independent auto repair shops: customers, estimates, invoices, texts, calls and an AI that handles the paperwork.',
  // Added to a phone's home screen, it opens full screen under its own name and icon (the web app manifest is app/manifest.ts).
  applicationName: 'Alpha Desk',
  appleWebApp: { capable: true, title: 'Alpha Desk', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Let people pinch-zoom; never trap them on small text.
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e2e4df' },
    { media: '(prefers-color-scheme: dark)', color: '#13161a' },
  ],
}

// Runs before first paint so the page never flashes the wrong theme.
// "alpha_theme" is light, dark, or missing (follow the phone). The old
// "alpha_light_mode" key is read once so nobody's choice is lost.
const THEME_SCRIPT = `try{var t=localStorage.getItem('alpha_theme');if(!t&&localStorage.getItem('alpha_light_mode')==='true')t='light';var c=document.documentElement.classList;if(t==='light')c.add('light');else if(t==='dark')c.add('dark')}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-bg-base text-text-primary font-sans antialiased">
        {children}
        <InstallBridge />
      </body>
    </html>
  )
}
