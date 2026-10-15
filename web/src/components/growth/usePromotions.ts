'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { load } from '@/components/automations/api'
import type { Outcome } from '@/components/automations/model'
import type { PromotionShop, PromotionView } from './promotions-model'

export interface PromotionsData {
  state: 'loading' | 'ready' | 'error'
  error: string
  promotions: PromotionView[]
  shop: PromotionShop | null
  needsDatabaseUpdate: boolean
  canEdit: boolean
  /** What each promotion brought in (replied, booked, paid). Missing when the results could not be counted. */
  outcomes: Record<string, Outcome>
  deliveryTracking: boolean
}

/** The promotions list, with what each one brought in. A failed refresh keeps what was on screen. */
export function usePromotions(enabled: boolean) {
  const [data, setData] = useState<PromotionsData>({ state: 'loading', error: '', promotions: [], shop: null, needsDatabaseUpdate: false, canEdit: true, outcomes: {}, deliveryTracking: false })
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++seq.current
    setData(p => ({ ...p, state: p.promotions.length || p.shop ? p.state : 'loading' }))
    const [list, results] = await Promise.all([
      load('/api/growth/promotions', d => ({
        promotions: (Array.isArray(d.promotions) ? d.promotions : []) as PromotionView[],
        shop: (d.shop ?? null) as PromotionShop | null,
        needs: d.needs_database_update === true,
        canEdit: d.can_edit !== false,
      })),
      load('/api/automations/insights?days=90', d => {
        const r = (d.results ?? {}) as { by_campaign?: Record<string, Outcome>; delivery_tracking?: boolean }
        return { byCampaign: r.by_campaign || {}, delivery: r.delivery_tracking === true }
      }),
    ])
    if (mine !== seq.current) return
    setData(p => list.ok
      ? { state: 'ready', error: '', promotions: list.value.promotions, shop: list.value.shop, needsDatabaseUpdate: list.value.needs, canEdit: list.value.canEdit, outcomes: results.ok ? results.value.byCampaign : p.outcomes, deliveryTracking: results.ok ? results.value.delivery : p.deliveryTracking }
      : { ...p, state: 'error', error: list.error })
  }, [])

  useEffect(() => { if (enabled) void reload() }, [enabled, reload])
  return { ...data, reload }
}
