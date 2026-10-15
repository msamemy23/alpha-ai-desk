'use client'
import { Group, SelectField, TextAreaField, TextField } from './fields'
import LogoGroup from './LogoGroup'

// A shop picks its own zone. The Central default is what the app has always used when nothing is saved.
const TIME_ZONES = [
  { value: 'America/New_York', label: 'Eastern time' },
  { value: 'America/Chicago', label: 'Central time' },
  { value: 'America/Denver', label: 'Mountain time' },
  { value: 'America/Phoenix', label: 'Arizona (no daylight saving)' },
  { value: 'America/Los_Angeles', label: 'Pacific time' },
  { value: 'America/Anchorage', label: 'Alaska time' },
  { value: 'Pacific/Honolulu', label: 'Hawaii time' },
]

export default function ShopSection() {
  return (
    <div className="space-y-4">
      <LogoGroup />
      <Group title="Shop details" description="Customers see these on the estimates, invoices, texts and signing links you send.">
        <TextField k="shop_name" label="Shop name" autoComplete="organization" />
        <TextField k="shop_address" label="Address" autoComplete="street-address" placeholder="Street, city, state and ZIP" hint="Street, city, state and ZIP, on one line." />
        <TextField k="shop_phone" label="Phone" type="text" inputMode="tel" autoComplete="tel" hint="The number customers call." />
        <TextField k="shop_email" label="Email" type="email" inputMode="email" autoComplete="email" hint="Replies to emailed estimates come here, and so does the note when a customer signs." />
      </Group>

      <Group title="Rates and paperwork">
        <div className="grid gap-4 min-[420px]:grid-cols-2">
          <TextField k="labor_rate" label="Labor rate (dollars per hour)" type="number" inputMode="decimal" step="0.01" hint="The starting labor rate on new estimates and invoices. Until it is set, new labor lines start at $0 an hour." />
          <TextField k="tax_rate" label="Tax rate (percent)" type="number" inputMode="decimal" step="0.01" hint="For example 8.25. Use 0 for no tax. New estimates and invoices start at this rate; until it is set they start at 0%." />
        </div>
        <div className="grid gap-4 min-[420px]:grid-cols-2">
          <TextField k="warranty_months" label="Warranty (months)" type="number" inputMode="numeric" step="1" fallback={12} hint="How long your repair warranty lasts." />
          <TextField k="payment_methods" label="Payment methods" hint="Separate with commas, like Cash, Card, Zelle. They are the choices when you take a payment." />
        </div>
        <TextAreaField k="disclaimer" label="Disclaimer" rows={3} hint="Fine print for your paperwork, such as storage fees or your parts policy." />
      </Group>

      <Group title="Reviews and time zone">
        <TextField k="google_review_url" label="Google review link" type="url" inputMode="url" placeholder="https://g.page/r/your-shop/review" hint="Customers are sent here to leave a review. Find it in your Google Business Profile under Get more reviews." />
        <SelectField
          k="timezone"
          label="Time zone"
          fallback="America/Chicago"
          hint="Used for reminders, schedules and automations."
          options={TIME_ZONES}
        />
      </Group>
    </div>
  )
}
