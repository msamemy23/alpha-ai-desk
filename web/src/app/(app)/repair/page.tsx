'use client'
import { ErrorCard } from '@/components/ListKit'
import Landing, { SavedLookups } from '@/components/repair/Landing'
import ManualReader from '@/components/repair/ManualReader'
import Results from '@/components/repair/Results'
import SearchCard from '@/components/repair/SearchCard'
import { DiagramViewer } from '@/components/repair/DiagramViewer'
import { useRepair } from '@/components/repair/useRepair'

export default function RepairPage() {
  const r = useRepair()
  const { viewer } = r

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Repair info</h1>
          <p className="page-subtitle max-w-2xl">Look up a repair, trouble code or symptom. Alpha finds manual pages and official records. Check every spec and step against the source before work starts.</p>
        </div>
      </header>

      <SearchCard r={r} />

      {/* Said aloud for screen readers; the page itself shows the skeleton and the answer. */}
      <p className="sr-only" role="status">
        {r.loading ? 'Searching repair sources.' : r.result ? `Found ${r.result.sources.length} sources for ${r.repairView?.vehicle || 'this vehicle'}.` : ''}
      </p>

      <div className="mt-6">
        {r.loading ? (
          <div aria-busy="true" role="status" aria-label="Searching repair sources">
            <p className="mb-3 text-text-secondary">Searching manuals and official records. This can take up to a minute.</p>
            <div className="space-y-3">
              <div className="skeleton h-32" />
              <div className="skeleton h-12" />
              <div className="skeleton h-48" />
            </div>
          </div>
        ) : r.error ? (
          <ErrorCard title="The lookup did not finish" message={r.error} onRetry={r.retrySearch} />
        ) : r.result ? (
          <Results key={r.searchId} r={r} />
        ) : (
          <Landing onPick={text => void r.search(text)} />
        )}
      </div>

      <SavedLookups
        drafts={r.savedDrafts}
        disabled={r.loading}
        onRemove={r.removeDraft}
        onRun={d => void r.search(d.vehicle === 'Vehicle not fully identified' ? d.operation : `${d.vehicle} ${d.operation}`)}
      />

      <ManualReader r={r} />
      {viewer && (
        <DiagramViewer
          key={viewer.url}
          image={viewer}
          bookmarked={r.bookmarks.some(b => b.url === viewer.url)}
          onToggleBookmark={() => r.toggleBookmark(viewer)}
          onClose={() => r.setViewer(null)}
        />
      )}
    </div>
  )
}
