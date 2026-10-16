'use client'
import ErrorScreen from '@/components/ErrorScreen'
import { PublicHeader } from '@/components/PublicChrome'

/** A page outside the signed-in app broke (sign-in, help, a customer's link). There is no menu here, so it carries its own header. */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <PublicHeader showSignIn={false} />
      <ErrorScreen error={error} retry={retry} homeHref="/" homeLabel="Go to the home page" />
    </>
  )
}
