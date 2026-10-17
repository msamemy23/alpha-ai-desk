'use client'
import { useEffect, useState } from 'react'
import Icon from '@/components/Icon'
import { api } from '@/components/inbox/api'
import { normalizePhoneE164 } from '@/lib/shop-form'
import { GATEWAYS, isGatewayProvider } from '@/lib/text-channel'
import { Group, SelectField, TextField, useSettings } from './fields'
import { StatusLine } from './shared'

/**
 * Text with the owner's own Android phone. A free gateway app (TextBee or httpSMS) on the phone sends the texts Alpha writes, from the
 * phone's own number, and passes the replies back to the Inbox. An iPhone cannot do this (Apple has no way to send a text for an app),
 * so for an iPhone the "From my phone" button on each text is the way. Nothing here changes how texts go out until "Send my texts from"
 * is set to the phone and saved, and that setting refuses to save until every detail is filled in.
 */
export default function PhoneTextCard() {
  const { settings } = useSettings()
  const [origin, setOrigin] = useState('')
  const [secret, setSecret] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<'' | 'address' | 'code' | 'test'>('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [testTo, setTestTo] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])

  if (settings.phone_columns_ready === false) {
    return (
      <Group title="Text with my own phone" description="Use an Android phone to send and receive your texts, from its own number.">
        <StatusLine lamp="amber">This needs a one-time database update before it can be turned on.</StatusLine>
        <p className="text-[0.9375rem] text-text-secondary">Nothing is wrong with your texts. They keep going out the way they do now.</p>
      </Group>
    )
  }
  if (!('phone_columns_ready' in settings)) return null

  const provider = isGatewayProvider(settings.phone_gateway) ? settings.phone_gateway : null
  const number = String(settings.phone_gateway_number || '').trim()
  const keyReady = Boolean(String(settings.phone_gateway_key || '').trim()) || settings.phone_gateway_key_configured === true
  const deviceReady = provider !== 'textbee' || Boolean(String(settings.phone_gateway_device || '').trim())
  const complete = Boolean(provider && keyReady && number && deviceReady)
  const using = settings.sms_channel === 'phone'
  const telnyxReady = settings.telnyx_api_key_configured === true && Boolean(String(settings.telnyx_phone_number || '').trim())
  const shopId = String(settings.shop_id || '')
  const savedSecret = typeof settings.phone_gateway_secret === 'string' ? settings.phone_gateway_secret : ''
  const code = secret || savedSecret
  const address = origin && shopId && code ? `${origin}/api/sms-inbound?shop=${encodeURIComponent(shopId)}&secret=${encodeURIComponent(code)}` : ''
  const service = provider ? GATEWAYS[provider] : null

  const showAddress = async () => {
    setBusy('address'); setMessage(null)
    const r = await api<{ settings?: Record<string, unknown> }>('/api/settings')
    setBusy('')
    const found = r.data?.settings?.phone_gateway_secret
    if (typeof found === 'string' && found) setSecret(found)
    else setMessage({ kind: 'bad', text: 'There is no address yet. Choose the service, fill in the details and choose Save changes first.' })
  }

  const newCode = async () => {
    if (!window.confirm('Make a new code? The old address stops working, so you will paste the new one into the phone service.')) return
    setBusy('code'); setMessage(null)
    const r = await api<{ phone_gateway_secret?: string }>('/api/settings', { body: { rotate_phone_secret: true } })
    setBusy('')
    if (r.ok && r.data?.phone_gateway_secret) { setSecret(r.data.phone_gateway_secret); setMessage({ kind: 'ok', text: 'New address made. Paste it into the phone service.' }) }
    else setMessage({ kind: 'bad', text: r.error || 'A new code could not be made.' })
  }

  const copyAddress = async () => {
    if (!address) return
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* the address is selectable, so it can be copied by hand */ }
  }

  const sendTest = async () => {
    setBusy('test'); setMessage(null)
    const r = await api('/api/settings/phone-test', { body: { to: testTo } })
    setBusy('')
    setMessage(r.ok
      ? { kind: 'ok', text: 'Sent. If it does not arrive on that phone in a minute, check that the app is open on your Android phone and has a signal.' }
      : { kind: 'bad', text: r.error })
  }

  return (
    <Group
      title="Text with my own phone"
      description="Use an Android phone to send and receive your texts, from its own number and plan. On an iPhone this is not possible, because Apple does not let an app send texts for you. Use the From my phone button on each text instead."
    >
      {using && complete
        ? <StatusLine lamp="green">Texts go out from your phone, {number}</StatusLine>
        : <StatusLine lamp={telnyxReady ? 'blue' : 'amber'}>{telnyxReady ? 'Texts go out from your Telnyx number. Your phone is not in use.' : 'Texting is not set up yet.'}</StatusLine>}

      <ol className="list-decimal space-y-1.5 pl-5 text-[0.9375rem] text-text-secondary">
        <li>On your Android phone, make a free account with TextBee (textbee.dev) or httpSMS (httpsms.com), install their app and sign in on the phone.</li>
        <li>Choose the service below and fill in the details. Choose Save changes.</li>
        <li>Copy the address that appears into the service, as the webhook for received messages. That is how customer replies reach your Inbox.</li>
        <li>Send a test text to another phone. When it arrives, set Send my texts from to My own phone and save.</li>
      </ol>

      <SelectField
        k="phone_gateway"
        label="Phone service"
        options={[{ value: '', label: 'Choose one' }, { value: 'textbee', label: 'TextBee' }, { value: 'httpsms', label: 'httpSMS' }]}
        hint="The app you installed on your Android phone."
      />
      <TextField k="phone_gateway_key" label={`${service?.label || 'Phone service'} API key`} type="password" mono secret placeholder="Paste the key" hint="From the service's dashboard. It is kept like your Telnyx key and is never shown again." />
      {provider === 'textbee' && (
        <TextField k="phone_gateway_device" label="TextBee device ID" mono placeholder="Device ID" hint="Shown in the TextBee dashboard once your phone is linked." />
      )}
      <TextField k="phone_gateway_number" label="Your phone's number" type="text" inputMode="tel" autoComplete="off" placeholder="+17135550000" normalize={normalizePhoneE164} hint="The number of the Android phone, with the country code. Customers will see texts from it." />

      <div>
        <span id="set-phone-address-label" className="form-label">Address for received texts</span>
        {address ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <p id="set-phone-address" tabIndex={0} aria-labelledby="set-phone-address-label" className="min-w-0 flex-1 select-all break-all rounded-md border border-[rgb(var(--c-line))] bg-bg-input px-3 py-2.5 font-mono text-[0.9375rem]">{address}</p>
              <button type="button" className="btn btn-secondary shrink-0" onClick={() => void copyAddress()}>
                <Icon name={copied ? 'check' : 'copy'} className="h-5 w-5" />{copied ? 'Copied' : 'Copy address'}
              </button>
            </div>
            <p className="form-hint !text-text-secondary">Keep this private: anyone with it can put texts into your Inbox. <button type="button" className="underline" onClick={() => void newCode()} disabled={busy !== ''}>Make a new code</button> if it gets out.</p>
          </>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" className="btn btn-secondary" onClick={() => void showAddress()} disabled={busy !== ''}>Show the address</button>
            <p className="form-hint !mt-0 !text-text-secondary">It appears after you choose the service and save.</p>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="set-phone-test" className="form-label">Send a test text to</label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <input id="set-phone-test" className="form-input" type="text" inputMode="tel" autoComplete="off" placeholder="+17135550000" value={testTo} onChange={e => setTestTo(e.target.value)} onBlur={e => { const next = normalizePhoneE164(e.target.value); if (next !== e.target.value) setTestTo(next) }} />
          <button type="button" className="btn btn-secondary shrink-0" onClick={() => void sendTest()} disabled={busy !== '' || !complete || !testTo.trim()}>
            <Icon name="send" className="h-5 w-5" />{busy === 'test' ? 'Sending…' : 'Send test'}
          </button>
        </div>
        <p className="form-hint !text-text-secondary">{complete ? 'Use a different phone from the Android one, so you can see it arrive.' : 'Fill in the details above and save first.'}</p>
      </div>

      <SelectField
        k="sms_channel"
        label="Send my texts from"
        options={[{ value: 'telnyx', label: 'The shop number (Telnyx)' }, { value: 'phone', label: 'My own phone' }]}
        fallback="telnyx"
        hint={complete ? 'Saving this to My own phone moves every text to your phone. Switch it back any time.' : 'My own phone can only be saved once the details above are filled in.'}
      />

      {message && (
        <p role={message.kind === 'ok' ? 'status' : 'alert'} className={message.kind === 'ok' ? 'flex items-center gap-2 text-[0.9375rem] text-green' : 'form-error'}>
          {message.kind === 'ok' && <Icon name="check" className="h-4 w-4 shrink-0" />}{message.text}
        </p>
      )}

      <div className="rounded-md border border-border bg-bg-base p-3 text-[0.875rem] text-text-secondary">
        <p className="font-bold text-text-primary">What changes when you text from your phone</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>Texts leave from your phone&apos;s number and use its plan. Replies come into the Inbox through the service.</li>
          <li>Pictures cannot go this way. Promotions and win-back texts stay off it too, because carriers block a phone that sends in bulk.</li>
          <li>Alpha only knows the service accepted a text, not that it was delivered.</li>
          <li>The phone has to be on, with a signal, and the app allowed to run in the background.</li>
          <li>The AI receptionist still answers calls on your Telnyx line. Only texts move.</li>
        </ul>
      </div>
    </Group>
  )
}
