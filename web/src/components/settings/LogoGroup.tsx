'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import ShopLogoTile from '@/components/ShopLogoTile'
import { logoFromFile, saveShopLogo, useShopLogo } from '@/lib/shop-logo'
import { Group } from './fields'

/** Saves on its own as soon as a picture is chosen, so it does not wait for the Save button below. */
export default function LogoGroup() {
  const { logo, available, ready } = useShopLogo()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function choose(file: File | undefined) {
    if (!file) return
    setError(''); setDone(''); setBusy(true)
    try {
      const small = await logoFromFile(file)
      const res = await saveShopLogo(small)
      if (res.error) setError(res.error); else setDone('Logo saved. It now shows in the app and on your estimates and invoices.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That picture could not be used. Try a PNG, JPG or WebP file.')
    }
    setBusy(false)
  }

  async function remove() {
    if (!window.confirm('Remove your logo? Estimates and invoices will go back to showing your shop name only.')) return
    setError(''); setDone(''); setBusy(true)
    const res = await saveShopLogo(null)
    if (res.error) setError(res.error); else setDone('Logo removed.')
    setBusy(false)
  }

  return (
    <Group title="Logo" description="Shows in the app next to your shop name, and at the top of every estimate and invoice you print or save as a PDF. A logo saves as soon as you choose it.">
      <div className="flex items-center gap-4">
        {!ready ? (
          <div className="skeleton h-24 w-24 shrink-0 rounded-lg" aria-hidden="true" />
        ) : logo ? (
          <ShopLogoTile src={logo} size={96} alt="Your shop logo" />
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-text-muted" aria-hidden="true">
            <Icon name="image" className="h-8 w-8" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[0.9375rem] text-text-secondary">{logo ? 'This is the logo customers see.' : 'No logo yet. A square picture works best. PNG, JPG or WebP.'}</p>
          <div className="flex flex-wrap gap-2">
            <label className={`btn btn-secondary has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue ${busy || !available ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>
              <Icon name="upload" className="h-5 w-5" />
              {busy ? 'Saving…' : logo ? 'Replace logo' : 'Upload logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={busy || !available}
                onChange={e => { void choose(e.target.files?.[0]); e.target.value = '' }}
              />
            </label>
            {logo && <button type="button" className="btn btn-ghost" onClick={remove} disabled={busy}>Remove logo</button>}
          </div>
        </div>
      </div>
      {!available && <Notice kind="warn">Logos are not switched on for this account yet. Everything else here still works.</Notice>}
      {error && <Notice kind="error"><p className="font-bold">The logo was not saved.</p><p>{error}</p></Notice>}
      {done && <Notice kind="success">{done}</Notice>}
    </Group>
  )
}
