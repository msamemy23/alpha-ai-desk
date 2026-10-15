'use client'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, RowsSkeleton } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { Section } from './parts'
import RepairPosts from './posts/RepairPosts'
import { timeAgo } from './helpers'
import type { Rec } from './helpers'

interface Props {
  loading: boolean
  failedPosts: boolean
  failedCampaigns: boolean
  posts: Rec[]
  campaigns: Rec[]
  cityLabel: string | null
  onRetry: () => void
  onWrite: () => void
  onAd: (platform: 'google' | 'facebook') => void
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

const cap = (s: unknown) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1)

export default function PostsTab({ loading, failedPosts, failedCampaigns, posts, campaigns, cityLabel, onRetry, onWrite, onAd, notify }: Props) {
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); notify('Post copied. Paste it where you want it to appear.', 'success') }
    catch { notify('The post could not be copied. Select the text and copy it by hand.', 'error') }
  }

  return (
    <>
      <RepairPosts notify={notify} />

      <Section
        title="Social posts"
        hint="Write a post, read the preview and save it as a draft. Nothing is published for you."
        action={<button type="button" className="btn btn-primary" onClick={onWrite}><Icon name="pen" className="h-5 w-5" />Write a post</button>}
      >
        <Notice kind="info" className="mb-4">A draft written here is never published by itself. Copy it and paste it into the app. To have Alpha publish a repair with real photos to a connected Page, use Repair posts above; connect your accounts under Connected apps.</Notice>
        {failedPosts ? <ErrorCard title="Your post drafts did not load" message="Check your connection and try again." onRetry={onRetry} busy={loading} />
          : loading ? <RowsSkeleton rows={2} label="Loading drafts" />
          : posts.length === 0 ? (
            <EmptyBlock icon="image" title="No post drafts yet">Write a short update about your shop. Alpha saves it as a draft you can review.</EmptyBlock>
          ) : (
            <ul className="ledger">
              {posts.map((p, i) => (
                <li key={p.id || i} className="px-3 py-3">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-bold">{Array.isArray(p.platforms) && p.platforms.length ? p.platforms.map((x: string) => cap(x)).join(', ') : 'Draft'}</span>
                    <span className="text-[0.875rem] text-text-secondary">{timeAgo(p.created_at)}</span>
                  </p>
                  <p className="line-clamp-2 text-[0.9375rem] text-text-secondary">{p.text}</p>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-[0.875rem] text-text-secondary"><span className="lamp lamp-off" aria-hidden="true" />Draft, not published</p>
                    <button type="button" className="btn btn-secondary" onClick={() => void copy(String(p.text || ''))} aria-label="Copy this post"><Icon name="copy" className="h-5 w-5" />Copy</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Section>

      <Section title="Ad campaigns" hint="Plan an ad and save it as a draft. Saving does not start any ads or spend money.">
        <div className="toolbar mb-4">
          <button type="button" className="btn btn-secondary" onClick={() => onAd('google')}><Icon name="globe" className="h-5 w-5" />New Google ads campaign</button>
          <button type="button" className="btn btn-secondary" onClick={() => onAd('facebook')}><Icon name="globe" className="h-5 w-5" />New Facebook ads campaign</button>
        </div>
        {failedCampaigns ? <ErrorCard title="Your campaigns did not load" message="Check your connection and try again." onRetry={onRetry} busy={loading} />
          : loading ? <RowsSkeleton rows={2} label="Loading campaigns" />
          : campaigns.length === 0 ? <EmptyBlock icon="growth" title="No campaigns yet">Start with Google ads to reach people searching for repairs{cityLabel ? ` near ${cityLabel}` : ''}.</EmptyBlock>
          : (
            <ul className="ledger">
              {campaigns.map(c => (
                <li key={c.id}>
                  <div className="ledger-row">
                    <span className={`lamp ${c.status === 'active' ? 'lamp-green' : 'lamp-off'}`} aria-hidden="true" />
                    <span className="ledger-main">
                      <span className="ledger-title block">{c.name}</span>
                      {c.ad_copy?.headline && <span className="ledger-sub block truncate">{String(c.ad_copy.headline)}</span>}
                      <span className="ledger-sub block">{cap(c.platform)} · {c.status === 'active' ? 'Running' : c.status === 'draft' || !c.status ? 'Draft, not started' : cap(c.status)}{Number(c.budget_per_day) > 0 ? ` · $${Number(c.budget_per_day).toLocaleString('en-US', { maximumFractionDigits: 2 })} a day` : ''}</span>
                    </span>
                    <span className="ledger-amt">${Number(c.spend || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Section>
    </>
  )
}
