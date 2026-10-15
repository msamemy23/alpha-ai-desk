'use client'
import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

/**
 * Keeps a full-screen phone sheet inside the part of the screen you can actually see.
 * When the on-screen keyboard opens, phones shrink the visual viewport but not the page,
 * which would hide a bottom action bar behind the keyboard. This sets --vv-h and --vv-top
 * on the element so it can size itself to the visible area, and says whether the keyboard is up.
 */
export function useViewportFit(ref: RefObject<HTMLElement | null>, active: boolean) {
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    const el = ref.current
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!active || !el || !vv) return
    const apply = () => {
      el.style.setProperty('--vv-h', `${Math.round(vv.height)}px`)
      el.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`)
      setKeyboardOpen(window.innerHeight - vv.height > 140)
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      el.style.removeProperty('--vv-h')
      el.style.removeProperty('--vv-top')
      setKeyboardOpen(false)
    }
  }, [ref, active])

  return keyboardOpen
}
