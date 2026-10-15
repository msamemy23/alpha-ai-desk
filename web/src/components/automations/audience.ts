import { getShopId, supabase } from '@/lib/supabase'
import {
  appointmentAudience, blastAudience, BLAST_LIMIT, estimateAudience, leadEmailAudience, reviewAudience, tomorrowIn, wholeNumber, winBackAudience,
} from '@/lib/automation-text'
import type { Row } from '@/lib/automation-text'

export interface Person { id: string; name: string; detail: string }

/** Who an automation would reach if it ran right now, worked out from the same rules the server uses. */
export interface Audience {
  /** False when the automation cannot be counted ahead of time. */
  counted: boolean
  /** False when the list was cut off by the page size, so the real number could be higher. */
  complete: boolean
  people: Person[]
  /** Who is left out, and why, in words. */
  left: { label: string; count: number }[]
  /** Facts worth saying next to the list. */
  facts: string[]
  /** The first person's details, for filling in the example text. */
  first?: { name?: string; service?: string; time?: string }
}

export const NOT_COUNTED: Audience = { counted: false, complete: true, people: [], left: [], facts: [] }

const PAGE = 1000
const DAY = 86_400_000
const num = (v: unknown, fallback: number) => {
  const n = wholeNumber(String(v ?? ''), 1, 100000)
  return n ?? fallback
}

async function need<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []) as T
}

const leftOf = (pairs: [string, number][]) => pairs.filter(([, n]) => n > 0).map(([label, count]) => ({ label, count }))
const phoneLine = (p: unknown) => String(p || '')

export async function loadAudience(id: string, config: Record<string, unknown>, timezone: string): Promise<Audience> {
  const shopId = await getShopId()
  if (!shopId) throw new Error('We could not find your shop.')
  const now = Date.now()

  if (id === 'sms_blast') {
    const rows = await need<Row[]>(supabase.from('customers').select('id,name,phone,sms_opted_out').eq('shop_id', shopId).not('phone', 'is', null).order('created_at', { ascending: true }).limit(BLAST_LIMIT))
    const s = blastAudience(rows)
    return {
      counted: true, complete: true,
      people: s.send.map(c => ({ id: String(c.id), name: String(c.name || 'Customer'), detail: phoneLine(c.phone) })),
      left: leftOf([['replied STOP', s.optedOut.length], ['have no phone number', s.noPhone.length]]),
      facts: s.shared > 0 ? [`${s.shared === 1 ? '1 record shares' : `${s.shared} records share`} a phone number with another, so that number gets the text more than once.`] : [],
      first: { name: s.send[0]?.name },
    }
  }

  if (id === 'review_requests') {
    const since = new Date(now - 7 * DAY).toISOString()
    const docs = await need<Row[]>(supabase.from('documents').select('customer_id,created_at').eq('shop_id', shopId).in('type', ['Invoice', 'Receipt']).neq('status', 'Void').gte('created_at', since).limit(PAGE))
    const ids = [...new Set(docs.map(d => d.customer_id).filter(Boolean))].map(String)
    const [customers, requests] = await Promise.all([
      ids.length ? need<Row[]>(supabase.from('customers').select('id,name,phone,sms_opted_out').eq('shop_id', shopId).in('id', ids)) : Promise.resolve([] as Row[]),
      need<Row[]>(supabase.from('growth_review_requests').select('phone,created_at').eq('shop_id', shopId).gte('created_at', since).limit(PAGE)),
    ])
    const s = reviewAudience({ docs, customers, requests, now })
    return {
      counted: true, complete: docs.length < PAGE,
      people: s.send.map(c => ({ id: String(c.id), name: String(c.name || 'Customer'), detail: phoneLine(c.phone) })),
      left: leftOf([['were asked in the last 7 days', s.alreadyAsked.length], ['replied STOP', s.optedOut.length], ['have no phone number', s.noPhone.length]]),
      facts: [],
      first: { name: s.send[0]?.name },
    }
  }

  if (id === 'estimate_followups') {
    const hours = num(config.followup_hours, 48)
    const since = new Date(now - 14 * DAY).toISOString()
    const estimates = await need<Row[]>(supabase.from('documents').select('id,customer_id,customer_name,customer_phone,customer_email,created_at,status').eq('shop_id', shopId).eq('type', 'Estimate').gte('created_at', since).limit(PAGE))
    const ids = [...new Set(estimates.map(e => e.customer_id).filter(Boolean))].map(String)
    const eids = estimates.map(e => String(e.id))
    const [customers, sent] = await Promise.all([
      ids.length ? need<Row[]>(supabase.from('customers').select('id,name,phone,email,sms_opted_out').eq('shop_id', shopId).in('id', ids)) : Promise.resolve([] as Row[]),
      eids.length ? need<Row[]>(supabase.from('estimate_followups_sent').select('estimate_id').eq('shop_id', shopId).eq('sent', true).in('estimate_id', eids)) : Promise.resolve([] as Row[]),
    ])
    const rows = estimateAudience({ estimates, customers, sentIds: sent.map(r => String(r.estimate_id)), hours, now })
    const usable = rows.filter(r => r.via !== 'none')
    return {
      counted: true, complete: estimates.length < PAGE,
      people: usable.map(r => ({ id: r.id, name: r.name, detail: r.via === 'text' ? 'By text' : 'By email' })),
      left: leftOf([['have no phone number or email', rows.length - usable.length]]),
      facts: [],
      first: { name: usable[0]?.name },
    }
  }

  if (id === 're_engagement') {
    const months = num(config.months_threshold, 3)
    const [customers, docs, followups] = await Promise.all([
      need<Row[]>(supabase.from('customers').select('id,name,phone,sms_opted_out').eq('shop_id', shopId).limit(PAGE)),
      need<Row[]>(supabase.from('documents').select('customer_id,created_at').eq('shop_id', shopId).in('type', ['Invoice', 'Receipt']).order('created_at', { ascending: false }).limit(PAGE * 3)),
      need<Row[]>(supabase.from('growth_followups').select('customer_id,created_at').eq('shop_id', shopId).gte('created_at', new Date(now - 30 * DAY).toISOString()).limit(PAGE)),
    ])
    const s = winBackAudience({ customers, docs, followups, months, now })
    return {
      counted: true, complete: customers.length < PAGE && docs.length < PAGE * 3,
      people: s.send.map(c => ({ id: String(c.id), name: String(c.name || 'Customer'), detail: `Last visit ${c.monthsAgo} ${c.monthsAgo === 1 ? 'month' : 'months'} ago` })),
      left: leftOf([['replied STOP', s.optedOut.length], ['have no phone number', s.noPhone.length]]),
      facts: [],
      first: { name: s.send[0]?.name },
    }
  }

  if (id === 'appointment_reminders') {
    const tomorrow = tomorrowIn(timezone, now)
    const appts = await need<Row[]>(supabase.from('appointments').select('id,customer_id,customer_name,phone,date,time,service,status,reminder_sent_at').eq('shop_id', shopId).eq('date', tomorrow).limit(PAGE))
    const ids = [...new Set(appts.map(a => a.customer_id).filter(Boolean))].map(String)
    const customers = ids.length ? await need<Row[]>(supabase.from('customers').select('id,phone,sms_opted_out').eq('shop_id', shopId).in('id', ids)) : []
    const s = appointmentAudience({ appts, customers, tomorrow })
    return {
      counted: true, complete: true,
      people: s.send.map(a => ({ id: a.id, name: a.name, detail: [a.time, a.service].filter(Boolean).join(' · ') })),
      left: leftOf([['replied STOP', s.optedOut.length], ['have no phone number', s.noPhone.length]]),
      facts: [],
      first: s.send[0] ? { name: s.send[0].name, service: s.send[0].service, time: s.send[0].time } : undefined,
    }
  }

  if (id === 'lead_outreach') {
    const limit = Math.min(50, num(config.limit ?? config.daily_limit, 10))
    const leads = await need<Row[]>(supabase.from('leads').select('id,name,email,source,status,created_at').eq('shop_id', shopId).eq('status', 'new').not('email', 'is', null).order('created_at', { ascending: true }).limit(limit))
    const s = leadEmailAudience(leads, limit)
    return {
      counted: true, complete: true,
      people: s.send.map(l => ({ id: String(l.id), name: String(l.name || 'Lead'), detail: String(l.email) })),
      left: leftOf([['have no email address', s.passedOver]]),
      facts: [],
      first: { name: s.send[0]?.name },
    }
  }

  return NOT_COUNTED
}
