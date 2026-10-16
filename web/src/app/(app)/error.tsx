'use client'
import ErrorScreen from '@/components/ErrorScreen'

/** A signed-in page broke. This file sits inside the app layout, so the menu and tab bar stay on screen. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} homeHref="/dashboard" homeLabel="Go to Today" />
}
