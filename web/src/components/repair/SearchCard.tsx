'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import type { Repair } from './useRepair'

const FIELDS = [
  { key: 'year', label: 'Year', placeholder: '2012', inputMode: 'numeric' as const, maxLength: 4 },
  { key: 'make', label: 'Make', placeholder: 'Honda' },
  { key: 'model', label: 'Model', placeholder: 'Accord' },
  { key: 'engine', label: 'Engine', placeholder: '2.4L' },
] as const

export default function SearchCard({ r }: { r: Repair }) {
  const [open, setOpen] = useState(false)
  const filled = Object.values(r.vehicle).some(v => String(v || '').trim())
  const canSearch = r.query.trim() !== '' || filled

  return (
    <form
      className="card"
      onSubmit={e => { e.preventDefault(); if (canSearch && !r.loading) void r.search() }}
    >
      <label htmlFor="repair-q" className="form-label">Repair, trouble code or symptom</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
          <input
            id="repair-q"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            className="form-input pl-10"
            placeholder="P0420 2012 Honda Accord"
            value={r.query}
            onChange={e => r.setQuery(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary sm:w-36" disabled={r.loading || !canSearch}>
          {r.loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      <button
        type="button"
        className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md font-bold text-blue hover:underline sm:min-h-[36px]"
        aria-expanded={open}
        aria-controls="repair-vehicle"
        onClick={() => setOpen(o => !o)}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} className="h-4 w-4" strokeWidth={2.4} />
        {open ? 'Hide vehicle details' : filled ? 'Vehicle details added' : 'Add vehicle details'}
      </button>
      {open && (
        <div id="repair-vehicle" className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FIELDS.map(f => (
            <div key={f.key}>
              <label htmlFor={`repair-${f.key}`} className="form-label">{f.label}</label>
              <input
                id={`repair-${f.key}`}
                className={`form-input ${f.key === 'year' ? 'num' : ''}`}
                autoComplete="off"
                inputMode={'inputMode' in f ? f.inputMode : undefined}
                maxLength={'maxLength' in f ? f.maxLength : undefined}
                placeholder={f.placeholder}
                value={r.vehicle[f.key] || ''}
                onChange={e => r.setVehicle(v => ({ ...v, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="col-span-2 sm:col-span-4">
            <label htmlFor="repair-vin" className="form-label">VIN</label>
            <input
              id="repair-vin"
              className="form-input num"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={17}
              placeholder="17 characters"
              value={r.vehicle.vin || ''}
              onChange={e => r.setVehicle(v => ({ ...v, vin: e.target.value.toUpperCase() }))}
              aria-describedby="repair-vin-hint"
            />
            <p id="repair-vin-hint" className="form-hint">A VIN tells Alpha the exact engine and trim, so the diagrams match the car.</p>
          </div>
        </div>
      )}
    </form>
  )
}
