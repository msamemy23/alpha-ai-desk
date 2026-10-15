'use client'
import Notice from '@/components/Notice'
import { COMPARE_OPTIONS, RANGE_OPTIONS } from '@/lib/report-ranges'
import type { CompareMode, RangeKey, RangeState, Resolved } from '@/lib/report-ranges'

/**
 * Which days to look at and what to compare them with. Presets cover the usual questions; "Pick dates" takes any two days,
 * and the comparison can be the period before, the same dates last year, or any other two days.
 */
export default function RangeBar({ value, resolved, onChange, today }: { value: RangeState; resolved: Resolved; onChange: (next: RangeState) => void; today: string }) {
  const { spec, cmp } = value
  const set = (patch: Partial<RangeState>) => onChange({ ...value, ...patch })
  return (
    <div className="mb-4" role="group" aria-label="Dates for the reports">
      <div className="grid grid-cols-2 gap-3 sm:max-w-xl">
        <div>
          <label htmlFor="report-period" className="form-label">Period</label>
          <select id="report-period" className="form-select" value={spec.key} onChange={e => set({ spec: { key: e.target.value as RangeKey } })}>
            {RANGE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="report-compare" className="form-label">Compare with</label>
          <select id="report-compare" className="form-select" value={cmp.mode} onChange={e => set({ cmp: { mode: e.target.value as CompareMode } })}>
            {COMPARE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
      </div>
      {spec.key === 'custom' && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-xl">
          <div>
            <label htmlFor="report-from" className="form-label">First day</label>
            <input id="report-from" type="date" className="form-input" value={spec.from || ''} max={today} onChange={e => set({ spec: { key: 'custom', from: e.target.value, to: spec.to } })} />
          </div>
          <div>
            <label htmlFor="report-to" className="form-label">Last day</label>
            <input id="report-to" type="date" className="form-input" value={spec.to || ''} max={today} onChange={e => set({ spec: { key: 'custom', from: spec.from, to: e.target.value } })} />
          </div>
        </div>
      )}
      {cmp.mode === 'custom' && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-xl">
          <div>
            <label htmlFor="report-cfrom" className="form-label">Compare: first day</label>
            <input id="report-cfrom" type="date" className="form-input" value={cmp.from || ''} max={today} onChange={e => set({ cmp: { mode: 'custom', from: e.target.value, to: cmp.to } })} />
          </div>
          <div>
            <label htmlFor="report-cto" className="form-label">Compare: last day</label>
            <input id="report-cto" type="date" className="form-input" value={cmp.to || ''} max={today} onChange={e => set({ cmp: { mode: 'custom', from: cmp.from, to: e.target.value } })} />
          </div>
        </div>
      )}
      {resolved.problem && <Notice kind="warn" className="mt-3 sm:max-w-xl">{resolved.problem}</Notice>}
    </div>
  )
}
