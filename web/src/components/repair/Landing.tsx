'use client'
import Icon from '@/components/Icon'
import { EXAMPLES } from './types'
import type { SavedDraft } from './types'

const POINTS = [
  { icon: 'manual', title: 'Pages from real manuals', text: 'LEMON covers newer cars. CHARM goes deep on 1982 to 2013. Recalls come from NHTSA, and OEM1Stop and AutoZone links are included.' },
  { icon: 'shield', title: 'Check before you quote', text: 'Specs, steps, labor times and wiring must be confirmed on the source page before work starts. Alpha never makes them up.' },
  { icon: 'wrench', title: 'Keep what your shop learns', text: 'Save a draft procedure, have a technician verify it, and it becomes your shop’s own procedure card.' },
]

/** What this screen is for and the quickest ways to start. Shown before the first search. */
export default function Landing({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="repair-try">
        <h2 id="repair-try" className="section-title">Try a lookup</h2>
        <p className="mt-1 text-text-secondary">Tap one to see how it works, or type your own above.</p>
        <ul className="ledger mt-3">
          {EXAMPLES.map(example => (
            <li key={example}>
              <button type="button" className="ledger-row" onClick={() => onPick(example)}>
                <Icon name="search" className="h-5 w-5 shrink-0 text-text-muted" />
                <span className="ledger-main font-bold">{example}</span>
                <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="repair-how">
        <h2 id="repair-how" className="section-title">How it works</h2>
        <ul className="mt-3 space-y-4">
          {POINTS.map(p => (
            <li key={p.title} className="flex gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-blue/10 text-blue"><Icon name={p.icon} className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="font-bold">{p.title}</p>
                <p className="text-text-secondary">{p.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** Lookups saved on this device, each one a tap away from running again. */
export function SavedLookups({ drafts, onRun, onRemove, disabled }: { drafts: SavedDraft[]; onRun: (d: SavedDraft) => void; onRemove: (id: string) => void; disabled: boolean }) {
  if (drafts.length === 0) return null
  return (
    <section className="mt-8" aria-labelledby="repair-saved">
      <h2 id="repair-saved" className="section-title">Saved lookups</h2>
      <p className="mt-1 text-text-secondary">Kept on this device only. Run one again to get fresh sources.</p>
      <ul className="ledger mt-3">
        {drafts.map(d => (
          <li key={d.id}>
            <div className="ledger-row flex-wrap sm:flex-nowrap">
              <div className="ledger-main">
                <p className="ledger-title">{d.vehicle}</p>
                <p className="ledger-sub">{d.operation} · saved {new Date(d.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => onRun(d)} disabled={disabled}>Run again</button>
                <button type="button" className="btn btn-ghost" onClick={() => onRemove(d.id)} aria-label={`Remove saved lookup: ${d.vehicle}, ${d.operation}`}>Remove</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
