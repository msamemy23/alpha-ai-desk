import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Alpha Desk, the office manager for your auto shop.',
}

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children
}
