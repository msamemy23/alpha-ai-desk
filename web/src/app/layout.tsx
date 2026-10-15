import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/overpass/wght.css'
import '@fontsource/atkinson-hyperlegible-next/400.css'
import '@fontsource/atkinson-hyperlegible-next/500.css'
import '@fontsource/atkinson-hyperlegible-next/700.css'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Alpha Desk', template: '%s · Alpha Desk' },
  description: 'The office manager for independent auto repair shops: customers, estimates, invoices, texts, calls and an AI that handles the paperwork.',
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
      </body>
    </html>
  )
}
