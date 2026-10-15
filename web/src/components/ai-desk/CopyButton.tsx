'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'

/** Copy text to the clipboard. Falls back to a hidden textarea where the clipboard API is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Blocked or not allowed here; try the older way below.
  }
  try {
    const box = document.createElement('textarea')
    box.value = text
    box.setAttribute('readonly', '')
    box.style.position = 'fixed'
    box.style.opacity = '0'
    document.body.appendChild(box)
    box.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(box)
    return copied
  } catch {
    return false
  }
}

/** "Copy" under an answer. Says "Copied" for a moment, or says it could not. */
export default function CopyButton({ text, label = 'Copy answer' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const onCopy = async () => {
    const ok = await copyText(text)
    setState(ok ? 'copied' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2200)
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={label}
      className="btn btn-ghost -ml-3 px-3 text-text-secondary"
    >
      <Icon name={state === 'copied' ? 'check' : 'copy'} className="h-5 w-5" />
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy. Press and hold the text instead.' : 'Copy'}</span>
    </button>
  )
}
