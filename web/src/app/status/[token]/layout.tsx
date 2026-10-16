import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// A customer's private link: keep it out of search results.
export const metadata: Metadata = {
  title: 'Where is my car',
  robots: { index: false, follow: false },
}

export default function StatusLayout({ children }: { children: ReactNode }) {
  return children
}
