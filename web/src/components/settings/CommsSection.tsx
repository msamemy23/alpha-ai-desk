'use client'
import { useEffect, useState } from 'react'
import Icon from '@/components/Icon'
import { normalizePhoneE164 } from '@/lib/shop-form'
import { Group, TextField, useSettings } from './fields'
import { StatusLine } from './shared'
import RegistrationCard from './RegistrationCard'

export default function CommsSection() {
  const { settings } = useSettings()
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])
  const webhook = origin ? `${origin}/api/sms` : ''
  const callWebhook = origin ? `${origin}/api/calls/webhook` : ''

  const copyAddress = async (which: string, value: string) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
      setTimeout(() => setCopied(c => (c === which ? '' : c)), 2000)
    } catch { /* the address is selectable, so it can be copied by hand */ }
  }

  const loaded = 'telnyx_api_key_configured' in settings
  const textsReady = settings.telnyx_api_key_configured === true && Boolean(String(settings.telnyx_phone_number || '').trim())
  const emailReady = settings.resend_api_key_configured === true && Boolean(String(settings.from_email || '').trim())

  return (
    <div className="space-y-4">
      <Group title="Texts and calls (Telnyx)" description="Telnyx is the phone service that sends your texts and places your calls. After you buy a Telnyx number, paste its details here.">
        {loaded && (textsReady
          ? <StatusLine lamp="green">Texts are set up</StatusLine>
          : <StatusLine lamp="amber">Texts are not set up yet. Add the key and number below, then save.</StatusLine>)}
        <div>
          <span id="set-webhook-label" className="form-label">Text webhook address</span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <p
              id="set-webhook"
              tabIndex={0}
              aria-labelledby="set-webhook-label"
              aria-describedby="set-webhook-hint"
              className="min-w-0 flex-1 select-all break-all rounded-md border border-[rgb(var(--c-line))] bg-bg-input px-3 py-2.5 font-mono text-[0.9375rem]"
            >
              {webhook || 'Loading…'}
            </p>
            <button type="button" className="btn btn-secondary shrink-0" onClick={() => copyAddress('text', webhook)} disabled={!webhook}>
              <Icon name={copied === 'text' ? 'check' : 'copy'} className="h-5 w-5" />
              {copied === 'text' ? 'Copied' : 'Copy address'}
            </button>
          </div>
          <p id="set-webhook-hint" className="form-hint !text-text-secondary">In Telnyx, paste this into your messaging profile as the webhook address so incoming texts reach Alpha Desk.</p>
        </div>
        <div>
          <span id="set-call-webhook-label" className="form-label">Call webhook address</span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <p
              id="set-call-webhook"
              tabIndex={0}
              aria-labelledby="set-call-webhook-label"
              aria-describedby="set-call-webhook-hint"
              className="min-w-0 flex-1 select-all break-all rounded-md border border-[rgb(var(--c-line))] bg-bg-input px-3 py-2.5 font-mono text-[0.9375rem]"
            >
              {callWebhook || 'Loading…'}
            </p>
            <button type="button" className="btn btn-secondary shrink-0" onClick={() => copyAddress('call', callWebhook)} disabled={!callWebhook}>
              <Icon name={copied === 'call' ? 'check' : 'copy'} className="h-5 w-5" />
              {copied === 'call' ? 'Copied' : 'Copy address'}
            </button>
          </div>
          <p id="set-call-webhook-hint" className="form-hint !text-text-secondary">In Telnyx, paste this into your voice connection (Call Control application) as the webhook address so the AI assistant can answer calls. Set how it answers under Calls and texts AI.</p>
        </div>
        <TextField k="telnyx_api_key" label="Telnyx API key" type="password" mono secret placeholder="KEY01..." hint="From the API Keys page in your Telnyx account." />
        <TextField k="telnyx_phone_number" label="Your Telnyx phone number" type="text" inputMode="tel" autoComplete="off" placeholder="+17135550000" normalize={normalizePhoneE164} hint="Include the country code, like +1. A 10-digit US number gets the +1 added." />
        <TextField k="telnyx_connection_id" label="Telnyx connection ID" mono placeholder="Connection ID" hint="Needed for calls. In Telnyx, copy the ID of the voice connection your number uses." />
        <TextField k="telnyx_outbound_voice_profile_id" label="Outbound voice profile ID (optional)" mono placeholder="Profile ID" hint="Leave blank when your Telnyx account has one default outbound profile. It is found automatically." />
        <TextField k="telnyx_messaging_profile_id" label="Messaging profile ID (optional)" mono placeholder="Profile ID" hint="Only needed when your Telnyx account has more than one messaging profile." />
      </Group>

      <Group title="Email (Resend)" description={<>Resend sends your emails. Get a free key at <strong>resend.com</strong>, which includes 100 emails a day, and add your domain there too.</>}>
        {loaded && (emailReady
          ? <StatusLine lamp="green">Email is set up</StatusLine>
          : <StatusLine lamp="amber">Email is not set up yet. Add the key and sender below, then save.</StatusLine>)}
        <TextField k="resend_api_key" label="Resend API key" type="password" mono secret placeholder="re_..." />
        <TextField k="from_email" label="From email" type="email" inputMode="email" placeholder="service@yourdomain.com" hint="Emails to customers are sent from this address. It must be on the domain you added in Resend." />
      </Group>

      <RegistrationCard />
    </div>
  )
}
