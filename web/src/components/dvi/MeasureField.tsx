'use client'
import { useState } from 'react'
import { MEASURE_LABEL, cleanMeasure, rateMeasure, unevenWear } from '@/lib/dvi-measure'
import type { Measure, MeasureKind } from '@/lib/dvi-measure'

const LAMP = { green: 'lamp-green', yellow: 'lamp-amber', red: 'lamp-red' } as const

const text = (n: number | undefined) => (n === undefined ? '' : String(n))

/**
 * A reading the technician takes with a gauge: tread depth, pad thickness, rotor thickness. The reading earns a lamp and a
 * word at once ("3/32 in: Replace soon"). A tire can be measured in three places; the lowest one counts.
 * `before` is the same line on the last visit, so the tech sees how fast it is wearing.
 */
export default function MeasureField({ id, kind, measure, before, onChange }: {
  id: string
  kind: MeasureKind
  measure: Measure | undefined
  before: { text: string; wear: string } | null
  onChange: (m: Measure | undefined) => void
}) {
  const [vals, setVals] = useState<string[]>(() => (kind === 'tread' ? [text(measure?.readings?.[0] ?? measure?.value), text(measure?.readings?.[1]), text(measure?.readings?.[2])] : [text(measure?.value)]))
  const [spec, setSpec] = useState(text(measure?.spec))

  const push = (nextVals: string[], nextSpec: string) => {
    const filled = nextVals.filter(v => v.trim() !== '')
    if (filled.length === 0) { onChange(undefined); return }
    const raw = kind === 'tread' ? { kind, readings: filled.map(Number) } : { kind, value: filled[0], ...(nextSpec.trim() ? { spec: nextSpec } : {}) }
    const m = cleanMeasure(kind === 'tread' && filled.length === 1 ? { kind, value: filled[0] } : raw)
    if (m) onChange(m)
  }

  const setAt = (i: number, v: string) => { const next = vals.map((x, j) => (j === i ? v : x)); setVals(next); push(next, spec) }
  const result = measure ? rateMeasure(measure) : null
  const places = kind === 'tread' ? ['Inside', 'Middle', 'Outside'] : [kind === 'pad' ? 'Thickness, mm' : 'Thickness, mm']
  const filledBad = vals.some(v => v.trim() !== '' && cleanMeasure({ kind, value: v }) === undefined)

  return (
    <div className="mt-2.5 rounded-md border border-border bg-bg-base px-3 py-2.5">
      <p className="text-[0.875rem] font-bold">{MEASURE_LABEL[kind]}{kind === 'tread' ? ' (32nds of an inch)' : kind === 'pad' ? ' (millimetres)' : ' (millimetres)'}</p>
      <div className={`mt-1.5 grid gap-2 ${kind === 'tread' ? 'grid-cols-3' : kind === 'rotor' ? 'grid-cols-2' : 'grid-cols-2'}`}>
        {places.map((label, i) => (
          <div key={label}>
            <label className="form-label !mb-0.5 !text-[0.8125rem]" htmlFor={`m-${id}-${i}`}>{label}</label>
            <input id={`m-${id}-${i}`} className="form-input num" inputMode="decimal" autoComplete="off" value={vals[i] ?? ''} placeholder={kind === 'tread' ? '6' : kind === 'pad' ? '5.5' : '22.0'} onChange={e => setAt(i, e.target.value)} aria-invalid={(vals[i] ?? '').trim() !== '' && cleanMeasure({ kind, value: vals[i] }) === undefined ? true : undefined} />
          </div>
        ))}
        {kind === 'rotor' && (
          <div>
            <label className="form-label !mb-0.5 !text-[0.8125rem]" htmlFor={`m-${id}-spec`}>Minimum stamped, mm</label>
            <input id={`m-${id}-spec`} className="form-input num" inputMode="decimal" autoComplete="off" value={spec} placeholder="21.0" onChange={e => { setSpec(e.target.value); push(vals, e.target.value) }} />
          </div>
        )}
      </div>
      {filledBad && <p role="alert" className="form-error !mt-1.5">Use a number, like {kind === 'tread' ? '6' : '5.5'}.</p>}

      {result && measure && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.9375rem]" aria-live="polite">
          <span className={`lamp ${result.rating ? LAMP[result.rating] : 'lamp-off'} shrink-0`} aria-hidden="true" />
          <span className="num font-bold">{result.text}</span>
          <span>{result.word}</span>
        </p>
      )}
      {measure && unevenWear(measure) && <p className="mt-1 text-[0.875rem] text-text-secondary">Wear is uneven across the tire. Worth checking the alignment.</p>}
      {before && <p className="mt-1.5 text-[0.8125rem] text-text-secondary">Last visit: <span className="num">{before.text}</span>.{before.wear ? ` ${before.wear}` : ''}</p>}
    </div>
  )
}
