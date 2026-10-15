'use client'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { Group } from './fields'

/**
 * Review replies used to be drafted here and then lost. They now live in Get more customers, where each reply is saved,
 * checked, approved by you and marked once you have pasted it into Google. Nothing is ever posted for you.
 */
export default function ReviewsSection({ shopName }: { shopName?: string }) {
  return (
    <div className="space-y-4">
      <Group title="Reply to Google reviews" description={`Review replies for ${shopName || 'your shop'} moved to Get more customers, so every draft is saved and nothing gets lost.`}>
        <ul className="space-y-2 text-[0.9375rem]">
          {[
            'Paste a review and the stars. Alpha drafts a polite reply from your shop details only.',
            'Low ratings and reviews that mention damage, money or safety are flagged for you to read first.',
            'Alpha never promises a discount or a price in a reply, and never posts to Google for you.',
            'Approve the reply, copy it into your Google reply box, and mark it posted.',
          ].map(line => <li key={line} className="flex items-start gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-green" />{line}</li>)}
        </ul>
        <Link href="/growth" className="btn btn-primary btn-lg w-full no-underline sm:w-auto">
          <Icon name="star" className="h-5 w-5" />Open review replies
        </Link>
        <p className="form-hint !text-text-secondary">On that page, choose the Reviews tab.</p>
      </Group>
    </div>
  )
}
