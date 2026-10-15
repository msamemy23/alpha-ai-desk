import { Suspense } from 'react'
import BrowserScreen from '@/components/browser/BrowserScreen'
import { RowsSkeleton } from '@/components/ListKit'

export default function BrowserPage() {
  return (
    <Suspense
      fallback={(
        <div className="page-container">
          <header className="page-header">
            <div>
              <h1 className="page-title">Browser</h1>
              <p className="page-subtitle">Loading…</p>
            </div>
          </header>
          <RowsSkeleton rows={4} label="Loading the browser" />
        </div>
      )}
    >
      <BrowserScreen />
    </Suspense>
  )
}
