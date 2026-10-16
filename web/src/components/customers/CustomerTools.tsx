'use client'
import { useCallback, useState } from 'react'
import Sheet from '@/components/Sheet'
import { Segmented } from '@/components/ScreenParts'
import ExportPanel from './ExportPanel'
import ImportPanel from './ImportPanel'
import DuplicatesPanel from './DuplicatesPanel'

export type ToolsTab = 'export' | 'import' | 'duplicates'
type Tab = ToolsTab

const TABS: { key: Tab; label: string }[] = [
  { key: 'export', label: 'Export' },
  { key: 'import', label: 'Import' },
  { key: 'duplicates', label: 'Possible duplicates' },
]

function Body({ start, customerCount, onImported, onOpenCustomer, onDirty }: {
  start: Tab
  customerCount: number
  onImported: (added: number) => void
  onOpenCustomer: (id: string) => void
  onDirty: (dirty: boolean) => void
}) {
  const [tab, setTab] = useState<Tab>(start)
  // The pairs are looked for the first time the tab is opened, not before.
  const [seenDuplicates, setSeenDuplicates] = useState(start === 'duplicates')
  const choose = (next: Tab) => {
    setTab(next)
    if (next === 'duplicates') setSeenDuplicates(true)
  }
  return (
    <div className="space-y-4">
      <Segmented<Tab> label="Customer tools" idPrefix="ct" options={TABS} value={tab} onChange={choose} columns="grid-cols-3" />
      <div id="ct-panel" role="tabpanel" aria-labelledby={`ct-tab-${tab}`}>
        {tab === 'export' && <ExportPanel customerCount={customerCount} />}
        {/* Kept on the page while another tab is showing, so a list that was pasted or previewed is not lost. */}
        <div hidden={tab !== 'import'}><ImportPanel onImported={onImported} onDirty={onDirty} /></div>
        {seenDuplicates && <div hidden={tab !== 'duplicates'}><DuplicatesPanel onOpenCustomer={onOpenCustomer} /></div>}
      </div>
    </div>
  )
}

/**
 * Customer tools: download the customer list, add customers from a list, and look at customers who may be the same person.
 * Everything here is either read only or add only. Nothing on these tabs changes or removes a customer who is already in the book.
 */
export default function CustomerTools({ open, start = 'export', onClose, customerCount, onImported, onOpenCustomer }: {
  open: boolean
  /** The tab to show when the tools open. */
  start?: ToolsTab
  onClose: () => void
  customerCount: number
  /** Called after an import added customers, so the list can read again. */
  onImported: (added: number) => void
  onOpenCustomer: (id: string) => void
}) {
  // A list that was typed or pasted and not imported yet: a stray tap outside the sheet must not throw it away.
  const [typed, setTyped] = useState(false)
  const onDirty = useCallback((d: boolean) => setTyped(d), [])
  const close = () => { setTyped(false); onClose() }
  return (
    <Sheet open={open} onClose={close} title="Customer tools" wide dirty={typed}>
      <Body start={start} customerCount={customerCount} onImported={onImported} onOpenCustomer={id => { setTyped(false); onOpenCustomer(id) }} onDirty={onDirty} />
    </Sheet>
  )
}
