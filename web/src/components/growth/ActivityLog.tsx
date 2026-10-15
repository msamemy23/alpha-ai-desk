import { timeAgo } from './helpers'
import type { Rec } from './helpers'

const ACTION_WORD: Record<string, string> = {
  follow_up_sms: 'Win-back text',
  review_request: 'Review link',
  referral_created: 'Referral code',
  outreach_sms: 'Text to a lead',
  outreach_email: 'Email to a lead',
  outreach_ai_call: 'Call by Alpha',
}

const wordFor = (action: unknown) => {
  const a = String(action || '')
  return ACTION_WORD[a] || a.replace(/_/g, ' ').replace(/^./, m => m.toUpperCase()) || 'Activity'
}

/** The last few things this screen sent or made, so nothing goes out without a trace. */
export default function ActivityLog({ items }: { items: Rec[] }) {
  if (items.length === 0) return null
  return (
    <section className="mt-10" aria-labelledby="activity-h">
      <h2 id="activity-h" className="section-title mb-2">Recently sent</h2>
      <ul className="ledger">
        {items.slice(0, 5).map((a, i) => (
          <li key={a.id || i}>
            <div className="ledger-row !min-h-[3.25rem]">
              <span className="lamp lamp-green" aria-hidden="true" />
              <span className="ledger-main">
                <span className="ledger-title block">{wordFor(a.action)}: {a.target}</span>
                {a.details && <span className="ledger-sub block">{String(a.details)}</span>}
              </span>
              <span className="shrink-0 text-[0.8125rem] text-text-secondary">{timeAgo(a.created_at)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
