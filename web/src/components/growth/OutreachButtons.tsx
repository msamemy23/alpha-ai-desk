'use client'
import Icon from '@/components/Icon'
import { hasPhone } from '@/lib/growth-text'
import type { Rec } from './helpers'

export type OutreachMethod = 'sms' | 'email' | 'ai_call'

/** Only the ways this lead can actually be reached. Each opens a preview first; nothing is sent from here. */
export default function OutreachButtons({ lead, onOutreach }: { lead: Rec; onOutreach: (lead: Rec, method: OutreachMethod) => void }) {
  const phone = hasPhone(lead.phone)
  const email = !!String(lead.email || '').trim()
  const name = lead.name || 'lead'
  if (!phone && !email) return <p className="text-[0.9375rem] text-text-secondary">No phone number or email yet. Tap Edit to add one.</p>
  return (
    <div className="flex flex-wrap gap-2">
      {phone && <button type="button" className="btn btn-secondary" onClick={() => onOutreach(lead, 'sms')} aria-label={`Text ${name}`}><Icon name="send" className="h-4 w-4" />Text</button>}
      {email && <button type="button" className="btn btn-secondary" onClick={() => onOutreach(lead, 'email')} aria-label={`Email ${name}`}><Icon name="mail" className="h-4 w-4" />Email</button>}
      {phone && <button type="button" className="btn btn-secondary" onClick={() => onOutreach(lead, 'ai_call')} aria-label={`Have Alpha call ${name}`}><Icon name="phone" className="h-4 w-4" />Have Alpha call</button>}
    </div>
  )
}
