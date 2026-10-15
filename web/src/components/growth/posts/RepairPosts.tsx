'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import { ErrorCard, RowsSkeleton } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { ACTIVE_STATES } from '@/lib/posts-rules'
import type { QueueItemView } from '@/lib/posts-api-types'
import { Section } from '../parts'
import DevicePostSheet from './DevicePostSheet'
import PostAutoCard from './PostAutoCard'
import PostItemSheet from './PostItemSheet'
import PostQueue from './PostQueue'
import PostResults from './PostResults'
import ShopPhotosSheet from './ShopPhotosSheet'
import { usePosts } from './usePosts'

interface Props {
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

/**
 * Repair posts: Alpha turns finished jobs into posts with the shop's own photos. Off until the owner turns it on; Suggest waits for
 * a tap; Auto posts within the owner's rules. Every post, and who or what sent it, is in the log.
 */
export default function RepairPosts({ notify }: Props) {
  const posts = usePosts()
  const [panel, setPanel] = useState<null | 'shop' | 'device'>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const o = posts.overview

  const item: QueueItemView | null = o && openId ? o.items.find(i => i.id === openId) ?? null : null
  const canMake = Boolean(o && o.can_edit && o.available)

  const runNow = async () => {
    if (running) return
    setRunning(true)
    try {
      const r = await posts.act({ action: 'run_due' })
      if (r.ok) notify(r.data.message, 'success')
      else notify(r.error, 'error')
    } finally { setRunning(false) }
  }

  const refreshNumbers = async (): Promise<string> => {
    const r = await posts.act({ action: 'refresh_numbers' })
    return r.ok ? r.data.message : r.error
  }

  return (
    <Section
      title="Repair posts"
      hint="Alpha turns a finished job into a post with your own shop photos, the car and engine, and the work done. You decide what goes public."
      action={canMake ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => setPanel('shop')}><Icon name="image" className="h-5 w-5" />Pick shop photos</button>
          <button type="button" className="btn btn-secondary" onClick={() => setPanel('device')}><Icon name="upload" className="h-5 w-5" />Post photos from this device</button>
        </div>
      ) : undefined}
    >
      {posts.load === 'loading' ? <RowsSkeleton rows={3} label="Loading repair posts" />
        : posts.load === 'error' || !o ? <ErrorCard title="Repair posts did not load" message={posts.error || 'Check your connection and try again.'} onRetry={() => void posts.retry()} />
        : (
          <div className="space-y-4">
            {!o.available && (
              <Notice kind="info">Repair posts need a database update before Alpha can prepare or log posts. Ask your developer to apply it. Nothing is posted automatically until then, and everything else on this page keeps working.</Notice>
            )}
            {posts.error && <Notice kind="warn">The list could not be refreshed just now: {posts.error}</Notice>}

            <PostAutoCard overview={o} notify={notify} onChange={patch => posts.act({ action: 'set_settings', ...patch })} />

            <Notice kind="info">
              <p className="font-bold">Where photos come from</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>Shop photos: the inspection photos already in Alpha, grouped by job. Works now.</li>
                <li>This device: photos saved on this phone or computer. Works now.</li>
                <li>Google Photos and Apple iCloud: not connected. Alpha cannot reach them. Save a picture to your device first.</li>
                <li>A link for customers to send photos: not built yet.</li>
              </ul>
              <p className="mt-1">Alpha cannot find license plates or VINs in a photo by itself. You check every photo before it can be posted.</p>
            </Notice>

            <PostQueue
              waiting={o.items.filter(i => ACTIVE_STATES.includes(i.state))}
              log={o.items.filter(i => !ACTIVE_STATES.includes(i.state))}
              mode={o.settings.mode}
              canEdit={canMake}
              running={running}
              onOpen={setOpenId}
              onPickShop={() => setPanel('shop')}
              onRun={() => void runNow()}
            />

            <PostResults overview={o} onRefresh={refreshNumbers} />
          </div>
        )}

      {o && panel === 'shop' && (
        <ShopPhotosSheet overview={o} act={posts.act} onClose={() => setPanel(null)} onMade={made => { setPanel(null); setOpenId(made.id) }} onOpenItem={id => { setPanel(null); setOpenId(id) }} notify={notify} />
      )}
      {o && panel === 'device' && (
        <DevicePostSheet overview={o} act={posts.act} onClose={() => setPanel(null)} onMade={made => { setPanel(null); setOpenId(made.id) }} notify={notify} />
      )}
      {o && item && (
        <PostItemSheet key={item.id} item={item} canEdit={o.can_edit} connections={o.connections} act={posts.act} onClose={() => setOpenId(null)} notify={notify} />
      )}
    </Section>
  )
}
