'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6dG5zcXJoamVzcWNuc3N6cWRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMTM3MDIsImV4cCI6MjA1ODU4OTcwMn0.4_MNwSmqTU_dlPWtqY9HGqFlrxL_50y0_C1e3KeQ4Fo'
)

export default function OnboardingPage() {
  const [shopName, setShopName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [cityStateZip, setCityStateZip] = useState('')
  const [services, setServices] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.href = '/login'; return }
      const { data } = await supabase.from('shop_profiles').select('*').eq('user_id', user.id).single()
      if (data?.shop_name && data.shop_name !== 'My Shop' && !data.shop_name.endsWith("'s Shop")) {
        window.location.href = '/dashboard'
      } else if (data) {
        setShopName(data.shop_name || '')
        setPhone(data.phone || '')
        setAddress(data.address || '')
        setCityStateZip(data.city_state_zip || '')
      }
    })()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      await supabase.from('shop_profiles').update({
        shop_name: shopName,
        phone,
        address,
        city_state_zip: cityStateZip,
        services: services.split(',').map(s => s.trim()).filter(Boolean),
      }).eq('user_id', user.id)
      window.location.href = '/dashboard'
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
    color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box'
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e1a', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '480px', background: 'rgba(15,23,42,0.95)', borderRadius: '20px', padding: '40px', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <div style={{ fontSize: '48px', marginBottom: '10px' }}>\uD83D\uDD27</div>
          <h1 style={{ color: '#f59e0b', fontSize: '24px', fontWeight: '700', margin: 0 }}>Set Up Your Shop</h1>
          <p style={{ color: '#6b7280', fontSize: '14px', marginTop: '8px' }}>Tell us about your business</p>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '6px', display: 'block' }}>Shop Name *</label>
            <input type="text" value={shopName} onChange={e => setShopName(e.target.value)} placeholder="Your Auto Shop" required style={inputStyle} />
          </div>
          <div>
            <label style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '6px', display: 'block' }}>Phone</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" style={inputStyle} />
          </div>
          <div>
            <label style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '6px', display: 'block' }}>Address</label>
            <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St" style={inputStyle} />
          </div>
          <div>
            <label style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '6px', display: 'block' }}>City, State, ZIP</label>
            <input type="text" value={cityStateZip} onChange={e => setCityStateZip(e.target.value)} placeholder="Houston, TX 77001" style={inputStyle} />
          </div>
          <div>
            <label style={{ color: '#9ca3af', fontSize: '13px', marginBottom: '6px', display: 'block' }}>Services (comma separated)</label>
            <input type="text" value={services} onChange={e => setServices(e.target.value)} placeholder="Oil Change, Brakes, Engine Repair" style={inputStyle} />
          </div>
          {error && <div style={{ color: '#ef4444', fontSize: '13px', textAlign: 'center' }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px', background: '#f59e0b', color: '#000', fontWeight: '700', fontSize: '15px', borderRadius: '12px', border: 'none', cursor: 'pointer', marginTop: '8px' }}>
            {loading ? 'Saving...' : 'Get Started'}
          </button>
        </form>
        <p style={{ color: '#6b7280', fontSize: '12px', textAlign: 'center', marginTop: '16px' }}>You can update this later in Settings</p>
      </div>
    </div>
  )
}
