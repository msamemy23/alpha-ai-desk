'use client'
import { addressText } from './address'
import { StatusLine } from './parts'
import { explainBlock } from './settings'
import type { SettingsPayload } from './settings'

const LABELS = ['Which rule', 'Why']

function Line({ line }: { line: string }) {
  const at = line.indexOf(':')
  if (at > 0 && LABELS.includes(line.slice(0, at))) {
    return <><strong>{line.slice(0, at + 1)}</strong>{line.slice(at + 1)}</>
  }
  return <>{line}</>
}

/**
 * A site rule stopped a page. Says which rule and why, from the settings the screen already has; when that does not
 * explain it, the server's own sentence is shown. People who may change the rules get a way to the settings.
 */
export default function BlockedNotice({
  url, message, payload, canManage, onOpenSettings,
}: { url: string; message: string; payload: SettingsPayload | null; canManage: boolean; onOpenSettings: () => void }) {
  const why = explainBlock(url, payload, message)
  return (
    <section className="card" role="alert" aria-label="This page was blocked">
      <StatusLine lamp="red">{why.title}</StatusLine>
      <ul className="mt-3 space-y-1.5 text-[0.9375rem]">
        {why.lines.map(l => <li key={l} className="break-words"><Line line={l} /></li>)}
      </ul>
      {url && <p className="mt-3 break-all text-[0.875rem] text-text-secondary">Nothing was opened: {addressText(url)}</p>}
      {why.overridable && (
        <div className="mt-3">
          {canManage
            ? <button type="button" className="btn btn-secondary" onClick={onOpenSettings}>Open browser settings</button>
            : <p className="text-[0.9375rem] text-text-secondary">Ask an owner or manager if this site should be allowed.</p>}
        </div>
      )}
    </section>
  )
}
