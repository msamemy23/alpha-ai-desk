'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'

interface Props {
  title: string
  text: string
  /** The saved copy is cut to 500 characters by the server; a fresh run shows everything. */
  cut: boolean
  onClose: () => void
}

/** What Alpha wrote for one of your own automations. Nothing in it has been sent. */
export default function PlanSheet({ title, text, cut, onClose }: Props) {
  const [copied, setCopied] = useState<'idle' | 'yes' | 'no'>('idle')
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied('yes') } catch { setCopied('no') }
  }
  return (
    <Sheet open onClose={onClose} title={title} wide>
      <Notice kind="info">Nothing has been sent or posted. This is only what Alpha wrote. Copy it where you want to use it.</Notice>
      <div className="mt-4 max-h-[50vh] overflow-y-auto rounded-lg bg-bg-hover px-3 py-2.5">
        <p className="whitespace-pre-wrap break-words text-[0.9375rem]" data-testid="plan-text">{text}</p>
      </div>
      {cut && <p className="mt-2 text-[0.875rem] text-text-secondary">Only the first part is kept on this page. Run it again to see the whole thing.</p>}
      {copied === 'no' && <p className="mt-2 text-[0.875rem] text-red" role="alert">Your browser would not copy it. Select the words and copy them by hand.</p>}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-primary" onClick={copy}>
          <Icon name={copied === 'yes' ? 'check' : 'copy'} className="h-5 w-5" />{copied === 'yes' ? 'Copied' : 'Copy the words'}
        </button>
      </div>
    </Sheet>
  )
}
