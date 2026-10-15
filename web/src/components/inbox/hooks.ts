'use client'
import { useEffect, useState } from 'react'

/** True when the media query matches. False on the server and on the first client render, so markup always agrees. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const update = () => setMatches(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])
  return matches
}

/**
 * Height of the on-screen keyboard in pixels (0 when it is closed), so a composer
 * pinned to the bottom of the screen can sit just above it.
 */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    if (!active) { setInset(0); return }
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop)
      // Ignore small changes such as the browser address bar sliding away.
      setInset(covered > 120 ? covered : 0)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [active])
  return inset
}
