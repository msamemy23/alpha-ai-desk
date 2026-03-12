import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Alpha Desktop AI',
  description: 'Alpha International Auto Center — Shop Management',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-bg-base text-text-primary font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
