'use client'
import { useEffect } from 'react'
import { reportClientError } from '@/lib/report-error'
import { isNoise } from '@/lib/client-errors'

/**
 * Catches the errors a crash screen never sees: a button handler that throws, a request that fails inside a promise.
 * The person sees nothing different; the error is written to the server log so it can be fixed.
 * Renders nothing. Errors raised by browser extensions and cross-origin scripts are skipped.
 */
export default function ClientErrorListener() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isNoise(e.message, e.filename)) return
      reportClientError('script', e.error ?? e.message)
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      reportClientError('promise', e.reason)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
