'use client'
import { useEffect, useRef } from 'react'
import Notice from '@/components/Notice'

/** The reason a save failed. It scrolls itself into view, clear of the sticky Save row, because the form can be long. */
export default function FormError({ children }: { children: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [children])
  return <div ref={ref} className="scroll-mb-24"><Notice kind="error">{children}</Notice></div>
}
