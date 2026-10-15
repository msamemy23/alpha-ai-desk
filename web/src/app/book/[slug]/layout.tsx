import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The address is the shop's to hand out; keep it out of search results and never cache a private form.
export const metadata: Metadata = {
  title: 'Book an appointment',
  robots: { index: false, follow: false },
}

export default function BookLayout({ children }: { children: ReactNode }) {
  return children
}
