'use client'
import { useCallback, useEffect, useState } from 'react'
import FormActions from '@/components/forms/FormActions'
import FormError from '@/components/forms/FormError'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { postJson } from '@/lib/client-api'
import type { PurchaseOrder, Vendor } from '@/lib/inventory-logic'
import type { StockAct } from './useStock'

interface Preview { to: string; subject: string; text: string; token: string; vendor: Vendor | null }

/**
 * Shows exactly the email a vendor would get and sends that email only when the person says so. The server hands back a token for
 * the message it showed, and sending needs the same token back, so an order that changed in between is never sent unseen.
 */
export default function SendOrder({ po, act, onClose, onSent, onMarkSent, onOpenVendor }: {
  po: PurchaseOrder
  act: StockAct
  onClose: () => void
  onSent: (to: string, recorded: boolean) => void
  /** The email cannot go (no address on file), or the person placed the order another way. */
  onMarkSent: () => void
  onOpenVendor?: (vendorId: string) => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (note = '') => {
    setLoading(true); setLoadError(''); setError(note)
    const r = await postJson<{ preview: Preview }>('/api/inventory', { action: 'po-preview', id: po.id })
    setLoading(false)
    if (r.ok) setPreview(r.data.preview)
    else setLoadError(r.needsUpdate ? 'Purchase orders need a one-time update to your Alpha Desk database first.' : r.message)
  }, [po.id])
  useEffect(() => { void load() }, [load])

  const send = async () => {
    if (!preview || sending) return
    setSending(true); setError('')
    const r = await act<{ sentTo: string; recorded: boolean }>({ action: 'po-send', id: po.id, token: preview.token })
    setSending(false)
    if (r.ok) { onSent(r.data.sentTo, r.data.recorded); return }
    if (r.status === 409 && r.message.startsWith('The order or the vendor changed')) { await load(r.message); return }
    setError(r.message)
  }

  const noEmail = !!preview && !preview.to
  return (
    <Sheet open onClose={() => { if (!sending) onClose() }} title={`Send ${po.po_number}`} wide>
      {loading && !preview ? (
        <div className="space-y-2" aria-busy="true" role="status" aria-label="Loading the email"><div className="skeleton h-[5rem]" /><div className="skeleton h-[14rem]" /></div>
      ) : loadError ? (
        <div className="space-y-3">
          <Notice kind="error"><p className="font-bold">The email could not be prepared</p><p className="mt-0.5 text-text-secondary">{loadError}</p></Notice>
          <div className="flex gap-2"><button type="button" className="btn btn-secondary" onClick={() => void load()}>Try again</button><button type="button" className="btn btn-ghost" onClick={onClose}>Close</button></div>
        </div>
      ) : preview && (
        <div className="space-y-4">
          {noEmail ? (
            <Notice kind="warn">
              <p className="font-bold">{preview.vendor?.name || po.vendor_name} has no email address on file</p>
              <p className="mt-0.5 text-text-secondary">Add one to the vendor and come back, or place the order by phone or on their website and then tell Alpha Desk you sent it.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {preview.vendor && onOpenVendor && <button type="button" className="btn btn-secondary" onClick={() => onOpenVendor(preview.vendor!.id)}>Add an email to {preview.vendor.name}</button>}
                <button type="button" className="btn btn-secondary" onClick={onMarkSent}>I already sent it</button>
              </div>
            </Notice>
          ) : (
            <p className="text-[0.9375rem] text-text-secondary">This is exactly the email that will go out. The vendor also gets the order as a table. Nothing is sent until you tap Send.</p>
          )}
          <dl className="rounded-md border border-border text-[0.9375rem]">
            <div className="flex gap-3 border-b border-border px-4 py-2.5"><dt className="w-16 shrink-0 font-bold text-text-secondary">To</dt><dd className="min-w-0 break-words">{preview.to || <span className="text-text-secondary">No email address</span>}</dd></div>
            <div className="flex gap-3 border-b border-border px-4 py-2.5"><dt className="w-16 shrink-0 font-bold text-text-secondary">Subject</dt><dd className="min-w-0 break-words">{preview.subject}</dd></div>
            <div className="px-4 py-3"><pre className="whitespace-pre-wrap break-words text-[0.9375rem] leading-relaxed" style={{ fontFamily: 'inherit' }} aria-label="Email message">{preview.text}</pre></div>
          </dl>
          {error && <FormError>{error}</FormError>}
          <FormActions>
            <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={sending || noEmail}><Icon name="send" className="h-5 w-5" />{sending ? 'Sending…' : `Send to ${preview.to || 'vendor'}`}</button>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={sending}>Not now</button>
            {!noEmail && <button type="button" className="btn btn-ghost sm:ml-auto" onClick={onMarkSent} disabled={sending}>I already sent it</button>}
          </FormActions>
        </div>
      )}
    </Sheet>
  )
}
