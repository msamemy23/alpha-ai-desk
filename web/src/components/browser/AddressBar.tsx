'use client'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Icon from '@/components/Icon'

/**
 * The address and search bar, with Back, Forward and Reload for the tab you are in. A typed web address opens the page;
 * anything else is searched. While you are typing in the bar, a page finishing its load never changes your words.
 */
export default function AddressBar({
  shown, onSubmit, canBack, canForward, canReload, onBack, onForward, onReload, children,
}: {
  /** The address of the page in this tab, in the form it is shown. */
  shown: string
  /** Returns a problem in plain words if the text cannot be used. */
  onSubmit: (input: string) => string | null
  canBack: boolean
  canForward: boolean
  canReload: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  children?: ReactNode
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const focused = useRef(false)
  const lastShown = useRef(shown)
  const [text, setText] = useState(shown)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    if (lastShown.current === shown) return
    lastShown.current = shown
    if (!focused.current) {
      setText(shown)
      setProblem('')
    }
  }, [shown])

  return (
    <div className="space-y-2">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={e => {
          e.preventDefault()
          const said = onSubmit(text)
          setProblem(said || '')
          if (!said) inputRef.current?.blur()
        }}
      >
        <label htmlFor={id} className="sr-only">Web address or words to search for</label>
        <input
          id={id}
          ref={inputRef}
          type="text"
          className="form-input min-w-0 flex-1"
          placeholder="Type a web address or search"
          value={text}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          onChange={e => { setText(e.target.value); if (problem) setProblem('') }}
          onFocus={e => { focused.current = true; e.currentTarget.select() }}
          onBlur={() => { focused.current = false }}
        />
        <button type="submit" className="btn btn-primary shrink-0">Go</button>
      </form>
      {problem && <p id={`${id}-problem`} className="form-error" role="alert">{problem}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn-icon border-[rgb(var(--c-line))] disabled:opacity-50" aria-label="Back" onClick={onBack} disabled={!canBack}>
            <Icon name="chevronLeft" className="h-5 w-5" />
          </button>
          <button type="button" className="btn-icon border-[rgb(var(--c-line))] disabled:opacity-50" aria-label="Forward" onClick={onForward} disabled={!canForward}>
            <Icon name="chevronRight" className="h-5 w-5" />
          </button>
          <button type="button" className="btn-icon border-[rgb(var(--c-line))] disabled:opacity-50" aria-label="Reload this page" onClick={onReload} disabled={!canReload}>
            <Icon name="refresh" className="h-5 w-5" />
          </button>
        </div>
        {children && <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
  )
}
