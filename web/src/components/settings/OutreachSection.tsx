'use client'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { Group } from './fields'

/**
 * Win-back texts used to be sent from here with one confirmation box. They now live in Get more customers, as promotions:
 * you read every message and the full list first, can schedule it, and can stop it while it goes out.
 */
export default function OutreachSection() {
  return (
    <div className="space-y-4">
      <Group title="Win back past customers" description="Promotions moved to Get more customers, where you can do more with them.">
        <ul className="space-y-2 text-[0.9375rem]">
          {[
            'Choose who gets it: last visit, vehicle, what they spent, or tags.',
            'Read the exact message for each person and see who is left out, and why, before anything is sent.',
            'Send now or pick a time. Texts are held back at night, and anyone who replied STOP is never texted.',
            'Stop a promotion while it is going out, and see afterwards who replied, booked and paid.',
          ].map(line => <li key={line} className="flex items-start gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-green" />{line}</li>)}
        </ul>
        <Link href="/growth" className="btn btn-primary btn-lg w-full no-underline sm:w-auto">
          <Icon name="send" className="h-5 w-5" />Open promotions
        </Link>
        <p className="form-hint !text-text-secondary">On that page, choose the Promotions tab.</p>
      </Group>
    </div>
  )
}
