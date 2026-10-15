'use client'
import { useEffect, useRef } from 'react'

/** True while the screen using it is on the page. Check it before changing state after a slow request. */
export function useMounted(): { readonly current: boolean } {
  const ref = useRef(true)
  useEffect(() => {
    ref.current = true
    return () => { ref.current = false }
  }, [])
  return ref
}
