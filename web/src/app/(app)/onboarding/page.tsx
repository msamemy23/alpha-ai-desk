'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getShopProfile } from '@/lib/supabase'

const SERVICES = [
  'Oil Change',
  'Tire Rotation',
  'Brake Service',
  'Engine Repair',
  'A/C Service',
  'Transmission Service',
  'Alignment',
  'Body Work',
  'State Inspection',
]

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [shopName, setShopName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [cityStateZip, setCityStateZip] = useState('')
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [customService, setCustomService] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getShopProfile().then(profile => {
      if (profile) {
        setShopName(profile.shop_name || '')
        setPhone(profile.phone || '')
        setAddress(profile.address || '')
        setCityStateZip(profile.city_state_zip || '')
        if (profile.services?.length) setSelectedServices(profile.services)
      }
    }).catch(() => {})
  }, [])

  const toggleService = (svc: string) => {
    setSelectedServices(s =>
      s.includes(svc) ? s.filter(x => x !== svc) : [...s, svc]
    )
  }

  const handleComplete = async () => {
    setSaving(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const services = [
        ...selectedServices,
        ...(customService.trim() ? [customService.trim()] : []),
      ]
      const { error: err } = await supabase
        .from('shop_profiles')
        .upsert(
          { user_id: user.id, shop_name: shopName, phone, address, city_state_zip: cityStateZip, services },
          { onConflict: 'user_id' }
        )
      if (err) throw err
      router.push('/dashboard')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in max-w-2xl mx-auto">
      {/* Step Indicators */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
              s === step
                ? 'bg-amber text-bg-base'
                : s < step
                ? 'bg-amber/30 text-amber'
                : 'bg-bg-hover text-text-muted'
            }`}>
              {s < step ? '✓' : s}
            </div>
            {s < 3 && (
              <div className={`h-0.5 w-12 transition-colors ${s < step ? 'bg-amber/40' : 'bg-border'}`} />
            )}
          </div>
        ))}
        <span className="ml-2 text-sm text-text-muted">Step {step} of 3</span>
      </div>

      {/* Step 1 — Shop Info */}
      {step === 1 && (
        <div className="card">
          <h1 className="text-xl font-bold mb-1">Shop Info</h1>
          <p className="text-text-muted text-sm mb-6">Tell us about your shop</p>
          <div className="space-y-4">
            <div>
              <label className="form-label">Shop Name</label>
              <input
                className="form-input"
                value={shopName}
                onChange={e => setShopName(e.target.value)}
                placeholder="e.g. Alpha International Auto Center"
              />
            </div>
            <div>
              <label className="form-label">Phone Number</label>
              <input
                className="form-input"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(713) 000-0000"
              />
            </div>
            <div>
              <label className="form-label">Street Address</label>
              <input
                className="form-input"
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="10710 S Main St"
              />
            </div>
            <div>
              <label className="form-label">City, State, ZIP</label>
              <input
                className="form-input"
                value={cityStateZip}
                onChange={e => setCityStateZip(e.target.value)}
                placeholder="Houston, TX 77025"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button
              className="btn btn-primary"
              onClick={() => setStep(2)}
              disabled={!shopName.trim()}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Services */}
      {step === 2 && (
        <div className="card">
          <h1 className="text-xl font-bold mb-1">Your Services</h1>
          <p className="text-text-muted text-sm mb-6">Select the services your shop offers</p>
          <div className="grid grid-cols-2 gap-2">
            {SERVICES.map(svc => (
              <label
                key={svc}
                className="flex items-center gap-2 p-3 rounded-lg border border-border hover:bg-bg-hover cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedServices.includes(svc)}
                  onChange={() => toggleService(svc)}
                  className="accent-amber w-4 h-4"
                />
                <span className="text-sm">{svc}</span>
              </label>
            ))}
          </div>
          <div className="mt-4">
            <label className="form-label">Custom Service (optional)</label>
            <input
              className="form-input"
              value={customService}
              onChange={e => setCustomService(e.target.value)}
              placeholder="e.g. Fleet Maintenance"
            />
          </div>
          <div className="mt-6 flex justify-between">
            <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-primary" onClick={() => setStep(3)}>Next →</button>
          </div>
        </div>
      )}

      {/* Step 3 — AI Voicemail Setup */}
      {step === 3 && (
        <div className="card">
          <h1 className="text-xl font-bold mb-1">Set Up AI Voicemail</h1>
          <p className="text-text-muted text-sm mb-6">Never miss a customer call</p>

          <div className="space-y-5 mb-6">
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-amber/20 flex items-center justify-center text-amber font-bold text-sm shrink-0">1</div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Call your carrier to enable conditional call forwarding</p>
                <div className="mt-2 bg-bg-hover border border-border rounded-lg p-3">
                  <p className="text-xs text-text-muted mb-1">Universal code:</p>
                  <code className="text-amber font-mono text-sm">**61*[forwarding_number]#</code>
                </div>
                <p className="text-xs text-text-muted mt-1">For AT&T/T-Mobile dial **61*[number]# and press Call.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-amber/20 flex items-center justify-center text-amber font-bold text-sm shrink-0">2</div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Your AI forwarding number</p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="bg-green/10 text-green text-xs font-bold px-2.5 py-1 rounded-full border border-green/30">Coming Soon</span>
                  <span className="text-sm text-text-muted">Your dedicated AI line will appear here</span>
                </div>
                <p className="text-xs text-text-muted mt-1">Customers who aren&apos;t answered within 4 rings will be greeted by your AI assistant.</p>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-4 bg-red/10 border border-red/30 rounded-lg p-3 text-sm text-red">
              {error}
            </div>
          )}

          <div className="flex justify-between">
            <button className="btn btn-secondary" onClick={() => setStep(2)}>← Back</button>
            <button className="btn btn-primary" onClick={handleComplete} disabled={saving}>
              {saving ? 'Saving…' : '✓ Complete Setup'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
