'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, getShopProfile, updateSettings } from '@/lib/supabase'
import { joinShopAddress, splitShopAddress } from '@/lib/shop-form'
import Notice from '@/components/Notice'
import Progress from '@/components/onboarding/Progress'
import ShopStep, { type ShopErrors, type ShopFields } from '@/components/onboarding/ShopStep'
import ServicesStep from '@/components/onboarding/ServicesStep'
import ReviewStep from '@/components/onboarding/ReviewStep'
import DoneCard from '@/components/onboarding/DoneCard'
import { SERVICES, isPreset } from '@/components/onboarding/services'

type ProfileState = 'loading' | 'ready' | 'error'

const EMPTY: ShopFields = { shopName: '', phone: '', address: '', cityStateZip: '' }

export default function OnboardingPage() {
  const [step, setStep] = useState(1)
  const [finished, setFinished] = useState(false)
  const [shop, setShop] = useState<ShopFields>(EMPTY)
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [extras, setExtras] = useState<string[]>([])
  const [customService, setCustomService] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [partial, setPartial] = useState(false)
  const [shopErrors, setShopErrors] = useState<ShopErrors>({})
  const [profileState, setProfileState] = useState<ProfileState>('loading')
  const [touched, setTouched] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const stepHeading = useRef<HTMLHeadingElement>(null)

  // What customers already see (Settings) wins over the older profile copy, so nobody re-enters or overwrites it.
  const loadProfile = useCallback(() => {
    setProfileState('loading')
    const loadSettings = async () => {
      const res = await fetch('/api/settings', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      // A shop with no settings row yet answers ok with nothing. Anything else is a failure, not "you have none".
      if (!res.ok || data.ok !== true) throw new Error('settings did not load')
      return (data.settings || {}) as Record<string, unknown>
    }
    Promise.all([getShopProfile(), loadSettings()]).then(([profile, saved]) => {
      const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
      const settingsAddress = text(saved.shop_address)
      const split = settingsAddress
        ? splitShopAddress(settingsAddress, profile?.city_state_zip)
        : { address: profile?.address || '', cityStateZip: profile?.city_state_zip || '' }
      setShop({
        shopName: text(saved.shop_name) || profile?.shop_name || '',
        phone: text(saved.shop_phone) || profile?.phone || '',
        address: split.address,
        cityStateZip: split.cityStateZip,
      })
      const services = Array.isArray(profile?.services) ? profile.services.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : []
      if (services.length) {
        setSelectedServices(services)
        setExtras(services.filter(s => !isPreset(s)))
      }
      setProfileState('ready')
    }).catch(() => setProfileState('error'))
  }, [])

  useEffect(() => { loadProfile() }, [loadProfile])

  // Warn before a refresh or tab close throws away what was typed.
  const unsaved = touched && !finished
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  // Move to the top of each step so the heading is the first thing read and seen.
  const go = (next: number) => {
    setStep(next)
    setError('')
    requestAnimationFrame(() => {
      stepHeading.current?.focus()
      stepHeading.current?.scrollIntoView({ block: 'start' })
    })
  }

  const changeShop = (key: keyof ShopFields, value: string) => {
    setShop(s => ({ ...s, [key]: value }))
    setTouched(true)
    if (key === 'shopName' && shopErrors.name) setShopErrors(e => ({ ...e, name: undefined }))
    if (key === 'phone' && shopErrors.phone) setShopErrors(e => ({ ...e, phone: undefined }))
  }

  const toggleService = (svc: string) => {
    setTouched(true)
    setSelectedServices(s => (s.includes(svc) ? s.filter(x => x !== svc) : [...s, svc]))
  }

  // Adds what is typed in "Another service" as a ticked choice. Returns the list so a step change does not lose it.
  const addCustom = (): string[] => {
    const value = customService.trim()
    if (!value) return selectedServices
    const lower = value.toLowerCase()
    const preset = SERVICES.find(sv => sv.value.toLowerCase() === lower || sv.label.toLowerCase() === lower)
    const known = preset?.value ?? [...extras, ...selectedServices].find(sv => sv.toLowerCase() === lower)
    const name = known ?? value.charAt(0).toUpperCase() + value.slice(1)
    const next = selectedServices.includes(name) ? selectedServices : [...selectedServices, name]
    if (!isPreset(name) && !extras.includes(name)) setExtras(e => [...e, name])
    setSelectedServices(next)
    setCustomService('')
    setTouched(true)
    return next
  }

  const checkShop = (): boolean => {
    const found: ShopErrors = {}
    if (!shop.shopName.trim()) found.name = 'Enter your shop name to continue.'
    const digits = shop.phone.replace(/\D/g, '')
    if (shop.phone.trim() && digits.length < 10) found.phone = 'Enter the full phone number with its area code, or leave it blank for now.'
    setShopErrors(found)
    if (found.name) nameRef.current?.focus()
    else if (found.phone) phoneRef.current?.focus()
    return !found.name && !found.phone
  }

  const next = () => {
    if (step === 1 && !checkShop()) return
    if (step === 2) addCustom()
    go(step + 1)
  }

  const handleComplete = async () => {
    if (saving) return
    // The name is needed to finish, even if someone got here by the Change link or the back button.
    if (!shop.shopName.trim()) { setStep(1); setShopErrors({ name: 'Enter your shop name to continue.' }); requestAnimationFrame(() => nameRef.current?.focus()); return }
    setSaving(true)
    setError('')
    setPartial(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('You are signed out. Sign in again, then finish setup.')
      const services = selectedServices
      const clean = {
        shop_name: shop.shopName.trim(),
        phone: shop.phone.trim(),
        address: shop.address.trim(),
        city_state_zip: shop.cityStateZip.trim(),
      }
      const { error: err } = await supabase
        .from('shop_profiles')
        .upsert({ user_id: user.id, ...clean, services }, { onConflict: 'user_id' })
      if (err) throw new Error('Your shop details could not be saved.')

      // Estimates, invoices and texts read the shop's details from Settings, so they are saved there too.
      const settingsResult = await updateSettings({
        shop_name: clean.shop_name,
        shop_phone: clean.phone,
        shop_address: joinShopAddress(clean.address, clean.city_state_zip),
      })
      if (settingsResult?.error) {
        setPartial(true)
        throw new Error('Your shop profile was saved, but the details customers see on estimates and texts were not updated.')
      }
      setFinished(true)
      requestAnimationFrame(() => stepHeading.current?.focus())
    } catch (e: unknown) {
      setError(e instanceof Error && e.message ? e.message : 'Your setup could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const loading = profileState === 'loading'

  return (
    <div className="page-container animate-fade-in">
      <div className="mx-auto max-w-xl">
        <header className="mb-6">
          <h1 className="page-title">Set up your shop</h1>
          <p className="page-subtitle">Three short steps. You can change any of this later in Settings.</p>
        </header>

        <Progress step={step} done={finished} />

        {profileState === 'error' && !finished && (
          <Notice kind="warn" className="mb-4">
            <p className="font-bold">Your saved shop details did not load.</p>
            <p>You can still fill them in. Saving will replace what is stored, so tap Try again first if you have already set up this shop.</p>
            <button type="button" className="mt-1 min-h-[44px] font-bold text-blue underline underline-offset-4" onClick={loadProfile}>Try again</button>
          </Notice>
        )}

        {!finished && step === 1 && (
          <ShopStep
            headingRef={stepHeading}
            nameRef={nameRef}
            phoneRef={phoneRef}
            values={shop}
            onChange={changeShop}
            errors={shopErrors}
            loading={loading}
            onNext={next}
          />
        )}

        {!finished && step === 2 && (
          <ServicesStep
            headingRef={stepHeading}
            selected={selectedServices}
            extras={extras}
            custom={customService}
            onCustom={v => { setCustomService(v); setTouched(true) }}
            onAddCustom={addCustom}
            onToggle={toggleService}
            onBack={() => go(1)}
            onNext={next}
          />
        )}

        {!finished && step === 3 && (
          <ReviewStep
            headingRef={stepHeading}
            shop={shop}
            services={selectedServices}
            error={error}
            partial={partial}
            saving={saving}
            onEdit={go}
            onBack={() => go(2)}
            onFinish={handleComplete}
          />
        )}

        {finished && <DoneCard headingRef={stepHeading} />}
      </div>
    </div>
  )
}
