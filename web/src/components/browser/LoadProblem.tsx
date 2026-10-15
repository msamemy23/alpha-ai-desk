'use client'
import { ErrorCard } from '@/components/ListKit'
import { FILE_WORDS } from './approval'
import BlockedNotice from './BlockedNotice'
import type { FailureInfo } from './failure'
import { OutsideLink, StatusLine } from './parts'
import type { SettingsPayload } from './settings'

/**
 * A page or a search that could not be shown, said plainly. A site rule shows which rule and why. A file shows what to do
 * instead. Everything else says what went wrong and offers Try again.
 */
export default function LoadProblem({
  failure, url, isSearch, payload, canManage, onOpenSettings, onRetry,
}: {
  failure: FailureInfo
  /** The page address, or '' for a search. */
  url: string
  isSearch: boolean
  payload: SettingsPayload | null
  canManage: boolean
  onOpenSettings: () => void
  onRetry: () => void
}) {
  if (failure.blocked && !isSearch) {
    return <BlockedNotice url={url} message={failure.message} payload={payload} canManage={canManage} onOpenSettings={onOpenSettings} />
  }
  if (failure.code === 'type' && !isSearch) {
    return (
      <section className="card space-y-3" role="alert" aria-label="This address is a file">
        <StatusLine lamp="amber">This address is a file, not a web page</StatusLine>
        <p className="break-words text-[0.9375rem]">{failure.message}</p>
        <p className="text-[0.9375rem] text-text-secondary">
          To save it, go back to the page that links to it, open that page in Live view and tap the download link. Alpha shows exactly what it will save and waits for your OK.
          {' '}{FILE_WORDS}
        </p>
        <OutsideLink url={url} />
      </section>
    )
  }
  return (
    <ErrorCard
      title={isSearch ? 'The search did not work' : 'This page could not be opened'}
      message={failure.message}
      onRetry={onRetry}
    />
  )
}
