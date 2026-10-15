'use client'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, RowsSkeleton } from '@/components/ListKit'
import { addressText } from './address'
import { quickSites, savedPages } from './settings'
import type { BookmarkRow } from './settings'
import type { SettingsApi } from './useBrowserSettings'

function SiteList({ label, sites, onOpen }: { label: string; sites: BookmarkRow[]; onOpen: (url: string) => void }) {
  return (
    <ul className="ledger" aria-label={label}>
      {sites.map(b => (
        <li key={b.id || b.url}>
          <button type="button" className="ledger-row" onClick={() => onOpen(b.url)}>
            <Icon name="globe" className="h-5 w-5 shrink-0 text-text-secondary" />
            <span className="ledger-main">
              <span className="ledger-title block">{b.title}</span>
              <span className="ledger-sub block">{addressText(b.url)}</span>
            </span>
            <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** What a new tab shows: ask Alpha, the shop's quick sites and any saved pages. Typing in the bar above always works. */
export default function StartPage({
  settings, aiEnabled, onOpen, onAsk, onOpenSettings,
}: { settings: SettingsApi; aiEnabled: boolean; onOpen: (url: string) => void; onAsk: () => void; onOpenSettings: () => void }) {
  const p = settings.payload
  const quick = quickSites(p)
  const saved = savedPages(p)
  return (
    <div className="space-y-6">
      <section className="card" aria-label="Ask Alpha">
        <h2 className="section-title">Ask Alpha to look this up</h2>
        <p className="mt-1 text-[0.9375rem] text-text-secondary">
          Say what you need to find, such as a part number or a recall. Alpha opens pages one step at a time and shows you each step.
          It asks you before it sends or saves anything.
        </p>
        <button type="button" className="btn btn-primary mt-3 w-full sm:w-auto" onClick={onAsk} disabled={!aiEnabled}>
          <Icon name="alpha" className="h-5 w-5" />Ask Alpha
        </button>
        {!aiEnabled && <p className="mt-2 text-[0.875rem] text-text-secondary">Alpha lookups are switched off for your shop. You can still read pages and search.</p>}
      </section>

      <section aria-label="Quick sites" className="space-y-2">
        <h2 className="section-title">Quick sites</h2>
        {settings.status === 'loading' && !p && <RowsSkeleton rows={3} label="Loading quick sites" />}
        {settings.status === 'error' && !p && (
          <ErrorCard title="Quick sites could not be loaded" message={`${settings.error || 'That did not work.'} You can still type an address or search above.`} onRetry={settings.reload} />
        )}
        {p && quick.length === 0 && (
          <EmptyBlock icon="globe" title="No quick sites yet" action={<button type="button" className="btn btn-primary" onClick={onOpenSettings}>Open browser settings</button>}>
            Quick sites are the shop’s favourite places, such as a parts supplier. They show here for everyone.
          </EmptyBlock>
        )}
        {p && quick.length > 0 && <SiteList label="Quick sites" sites={quick} onOpen={onOpen} />}
      </section>

      {saved.length > 0 && (
        <section aria-label="Saved pages" className="space-y-2">
          <h2 className="section-title">Saved pages</h2>
          <SiteList label="Saved pages" sites={saved} onOpen={onOpen} />
        </section>
      )}
    </div>
  )
}
