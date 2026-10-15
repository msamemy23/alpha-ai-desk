'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, RowsSkeleton } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { agoWords, money, whenWords } from '@/components/automations/model'
import PromotionDetail from './PromotionDetail'
import PromotionSheet from './PromotionSheet'
import type { PromotionSeed } from './PromotionSheet'
import { Section } from './parts'
import { PROMOTION_STATUS, countsLine } from './promotions-model'
import type { PromotionView } from './promotions-model'
import { usePromotions } from './usePromotions'

interface Props {
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
  /** Wording and audience to open a new promotion with (for example, from the follow-up list). */
  seed?: PromotionSeed | null
  onSeedUsed?: () => void
}

type Open = { kind: 'edit'; promotion: PromotionView | null; seed?: PromotionSeed | null } | { kind: 'detail'; id: string } | null

const seedOf = (p: PromotionView): PromotionSeed => ({ name: `${p.name} (copy)`.slice(0, 120), message: p.message, email_subject: p.email_subject, audience: p.audience })

/** One-off promotions: write it, choose who gets it, read every message, send now or later. */
export default function PromotionsTab({ notify, seed, onSeedUsed }: Props) {
  const data = usePromotions(true)
  const [open, setOpen] = useState<Open>(null)
  const { reload } = data
  useEffect(() => { if (seed) { setOpen({ kind: 'edit', promotion: null, seed }); onSeedUsed?.() } }, [seed, onSeedUsed])
  const changed = useCallback(() => { void reload() }, [reload])
  const shop = data.shop
  const detail = open?.kind === 'detail' ? data.promotions.find(p => p.id === open.id) || null : null

  return (
    <>
      <Section
        title="Promotions"
        hint="Send one message to a group of customers you choose. You read every message and the full list before anything goes out."
        action={data.canEdit && shop ? (
          <button type="button" className="btn btn-primary" onClick={() => setOpen({ kind: 'edit', promotion: null })} disabled={data.needsDatabaseUpdate}>
            <Icon name="plus" className="h-5 w-5" />New promotion
          </button>
        ) : undefined}
      >
        {data.needsDatabaseUpdate && (
          <Notice kind="info" className="mb-4">Promotions need a database update before they can be used. Ask your developer to apply it. Your other tools keep working in the meantime.</Notice>
        )}
        {shop && !shop.sms_ready && !data.needsDatabaseUpdate && (
          <Notice kind="warn" className="mb-4">Texting is not set up yet, so a promotion cannot be sent. <Link href="/settings" className="font-bold text-blue underline underline-offset-2">Open settings</Link> to add your Telnyx key and number.</Notice>
        )}
        {shop && !shop.master_enabled && !data.needsDatabaseUpdate && (
          <Notice kind="warn" className="mb-4">All automations are switched off, and that includes promotions. <Link href="/automations" className="font-bold text-blue underline underline-offset-2">Switch them back on</Link> before you send.</Notice>
        )}

        {data.state === 'loading' && !shop ? <RowsSkeleton rows={4} label="Loading promotions" />
          : data.state === 'error' && !shop ? <ErrorCard title="Promotions did not load" message={data.error || 'Check your connection and try again.'} onRetry={changed} />
          : data.promotions.length === 0 ? (
            data.needsDatabaseUpdate ? null : (
              <EmptyBlock icon="send" title="No promotions yet" action={data.canEdit && shop ? <button type="button" className="btn btn-primary" onClick={() => setOpen({ kind: 'edit', promotion: null })}><Icon name="plus" className="h-5 w-5" />New promotion</button> : undefined}>
                Write a message, choose who should get it, and see exactly what goes out before you send. Anyone who replied STOP is always left out.
              </EmptyBlock>
            )
          ) : (
            <>
              {data.state === 'error' && <Notice kind="error" className="mb-3">The list could not be refreshed. {data.error}</Notice>}
              <ul className="ledger" aria-label="Your promotions">
                {data.promotions.map(p => {
                  const s = PROMOTION_STATUS[p.status]
                  const o = data.outcomes[p.id]
                  const when = p.status === 'scheduled' && p.send_at && shop ? `Goes out ${whenWords(p.send_at, shop.timezone)}` : p.sent_at ? `Sent ${agoWords(p.sent_at)}` : `Made ${agoWords(p.created_at)}`
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="ledger-row w-full text-left"
                        onClick={() => setOpen(p.status === 'draft' && data.canEdit ? { kind: 'edit', promotion: p } : { kind: 'detail', id: p.id })}
                        aria-label={`${p.name}. ${s.word}. ${p.status === 'draft' ? 'Open to edit' : 'Open to see what happened'}`}
                      >
                        <span className={`lamp lamp-${s.lamp}`} aria-hidden="true" />
                        <span className="ledger-main">
                          <span className="ledger-title block">{p.name}</span>
                          <span className="ledger-sub !whitespace-normal block">{s.word} · {when}</span>
                          <span className="ledger-sub !whitespace-normal block">{countsLine(p)}</span>
                          {o && o.sent > 0 && <span className="ledger-sub !whitespace-normal block">{o.replied.toLocaleString('en-US')} replied · {o.booked.toLocaleString('en-US')} booked</span>}
                        </span>
                        {o && o.revenue > 0 && <span className="ledger-amt shrink-0" aria-label={`${money(o.revenue)} paid afterwards`}>{money(o.revenue)}</span>}
                        <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
      </Section>

      {open?.kind === 'edit' && shop && (
        <PromotionSheet
          key={open.promotion?.id || (open.seed ? 'copy' : 'new')}
          promotion={open.promotion}
          seed={open.seed}
          shop={shop}
          onClose={() => setOpen(null)}
          onChanged={changed}
          notify={notify}
        />
      )}
      {detail && shop && (
        <PromotionDetail
          promotion={detail}
          shop={shop}
          outcome={data.outcomes[detail.id]}
          deliveryTracking={data.deliveryTracking}
          canEdit={data.canEdit}
          onClose={() => setOpen(null)}
          onChanged={changed}
          onCopy={p => setOpen({ kind: 'edit', promotion: null, seed: seedOf(p) })}
          notify={notify}
        />
      )}
    </>
  )
}
