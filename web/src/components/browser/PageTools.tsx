'use client'
import Icon from '@/components/Icon'
import { OutsideLink } from './parts'

/** What you can do with the page in front of you: copy it, take it to Ask Alpha, save it, or open it in your own browser. */
export default function PageTools({
  hasText, url, canSave, saving, aiEnabled, onCopy, onAskAbout, onLookUp, onSave,
}: {
  hasText: boolean
  url: string
  canSave: boolean
  saving: boolean
  aiEnabled: boolean
  onCopy: () => void
  onAskAbout: () => void
  onLookUp: () => void
  onSave: () => void
}) {
  return (
    <div className="toolbar" role="group" aria-label="Use this page">
      <button type="button" className="btn btn-secondary btn-sm" onClick={onCopy} disabled={!hasText}>
        <Icon name="copy" className="h-4 w-4" />Copy
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onAskAbout} disabled={!hasText}>
        <Icon name="alpha" className="h-4 w-4" />Ask Alpha about this
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onLookUp} disabled={!aiEnabled}>
        <Icon name="search" className="h-4 w-4" />Look up with Alpha
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onSave} disabled={!canSave || saving}>
        <Icon name="star" className="h-4 w-4" />{saving ? 'Saving…' : 'Save page'}
      </button>
      <OutsideLink url={url} />
    </div>
  )
}
