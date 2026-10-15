'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { SearchField } from '@/components/ListKit'
import { carLine, roShort } from '@/components/jobs/types'
import { TEMPLATES } from '@/lib/dvi'
import { normName } from '@/lib/shopboard'
import { phonePretty } from '@/lib/today'
import type { StartJob } from './types'

export interface StartCustomer { id: string; name: string; phone: string; vehicle_year: string; vehicle_make: string; vehicle_model: string }
export interface StartValues { job_id: string | null; customer_id: string | null; customer_name: string; vehicle: string; tech: string; template: string }

/** Start an inspection: pick the car it is for, pick the checklist, go. Everything else is filled in on the checklist. */
export default function StartSheet({ jobs, customers, techs, presetJobId, busy, error, onStart }: {
  jobs: StartJob[]
  customers: StartCustomer[]
  techs: string[]
  presetJobId: string | null
  busy: boolean
  error: string
  onStart: (v: StartValues) => void
}) {
  const [mode, setMode] = useState<'job' | 'manual'>(presetJobId || jobs.length > 0 ? 'job' : 'manual')
  const [jobId, setJobId] = useState<string | null>(presetJobId)
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [tech, setTech] = useState('')
  const [template, setTemplate] = useState(TEMPLATES[0].key)
  const [problem, setProblem] = useState('')

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const hits = jobs.filter(j => !s || [j.customer_name, j.ro_number, carLine(j), j.tech].some(v => String(v || '').toLowerCase().includes(s)))
    // A car picked from the Jobs screen sits at the top so it is the first thing in view.
    return [...hits.filter(j => j.id === presetJobId), ...hits.filter(j => j.id !== presetJobId)].slice(0, 40)
  }, [jobs, q, presetJobId])
  const job = jobs.find(j => j.id === jobId) || null

  // A typed name that matches exactly one customer links to them, so the text goes to the right phone.
  const matches = customers.filter(c => normName(c.name) === normName(name))
  const linked = mode === 'manual' && matches.length === 1 ? matches[0] : null

  const go = () => {
    setProblem('')
    if (mode === 'job') {
      if (!job) { setProblem('Choose a car from the list, or enter the details by hand.'); return }
      onStart({ job_id: job.id, customer_id: job.customer_id, customer_name: job.customer_name, vehicle: carLine(job), tech: tech || (job.tech && normName(job.tech) !== 'unassigned' ? job.tech : ''), template })
      return
    }
    if (!name.trim()) { setProblem('Enter the customer’s name.'); return }
    onStart({ job_id: null, customer_id: linked?.id || null, customer_name: name.trim(), vehicle: vehicle.trim() || (linked ? carLine(linked) : ''), tech, template })
  }

  return (
    <div>
      <div role="group" aria-label="How to pick the car" className="mb-3 grid grid-cols-2 gap-2">
        {([['job', 'A car in the shop'], ['manual', 'Enter by hand']] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}
            className={`min-h-[44px] rounded-md border px-3 text-[0.9375rem] font-bold ${mode === k ? 'border-blue bg-blue/10 text-blue' : 'border-[rgb(var(--c-line))] bg-bg-card hover:bg-bg-hover'}`}>{label}</button>
        ))}
      </div>

      {mode === 'job' ? (
        <>
          <SearchField value={q} onChange={setQ} label="Search open jobs" placeholder="Customer, car, or repair order" />
          {jobs.length === 0 ? (
            <p className="mt-3 text-[0.9375rem] text-text-secondary">No open jobs. Write up a car on the Jobs screen, or enter the details by hand.</p>
          ) : shown.length === 0 ? (
            <p className="mt-3 text-[0.9375rem] text-text-secondary">No open job matches “{q.trim()}”.</p>
          ) : (
            <ul className="ledger mt-2 max-h-[40vh] overflow-y-auto" aria-label="Open jobs">
              {shown.map(j => {
                const on = j.id === jobId
                return (
                  <li key={j.id}>
                    <button type="button" className="ledger-row" aria-pressed={on} onClick={() => setJobId(j.id)}>
                      <span className="ledger-main">
                        <span className="ledger-title block">{j.customer_name || 'No name'}</span>
                        <span className="ledger-sub block">{carLine(j) || 'No vehicle noted'}{j.ro_number ? ` · ${roShort(j.ro_number)}` : ''}</span>
                      </span>
                      {on && <Icon name="check" className="h-5 w-5 shrink-0 text-blue" strokeWidth={2.4} />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="form-label" htmlFor="dvi-start-name">Customer name</label>
            <input id="dvi-start-name" className="form-input" value={name} onChange={e => setName(e.target.value)} list="dvi-customers" autoComplete="off" placeholder="Start typing a name" />
            <datalist id="dvi-customers">{customers.slice(0, 300).map(c => <option key={c.id} value={c.name} />)}</datalist>
            {linked && <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-text-secondary"><span className="lamp lamp-green !h-2.5 !w-2.5" aria-hidden="true" />Linked to {linked.name}{linked.phone ? `, ${phonePretty(linked.phone)}` : ', no phone on file'}</p>}
          </div>
          <div>
            <label className="form-label" htmlFor="dvi-start-vehicle">Vehicle</label>
            <input id="dvi-start-vehicle" className="form-input" value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder={linked ? carLine(linked) || '2018 Toyota Camry' : '2018 Toyota Camry'} />
          </div>
        </div>
      )}

      <h3 className="section-title mt-5">Which checklist?</h3>
      <ul className="ledger mt-1" aria-label="Checklists">
        {TEMPLATES.map(t => (
          <li key={t.key}>
            <button type="button" className="ledger-row" aria-pressed={template === t.key} onClick={() => setTemplate(t.key)}>
              <span className="ledger-main"><span className="ledger-title block">{t.label}</span><span className="ledger-sub block !whitespace-normal">{t.blurb}</span></span>
              {template === t.key && <Icon name="check" className="h-5 w-5 shrink-0 text-blue" strokeWidth={2.4} />}
            </button>
          </li>
        ))}
      </ul>

      {techs.length > 0 && (
        <div className="mt-4">
          <label className="form-label" htmlFor="dvi-start-tech">Technician</label>
          <select id="dvi-start-tech" className="form-select" value={tech} onChange={e => setTech(e.target.value)}>
            <option value="">{mode === 'job' && job?.tech && normName(job.tech) !== 'unassigned' ? `${job.tech} (on the job)` : 'Not chosen yet'}</option>
            {techs.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      )}

      {(problem || error) && <p role="alert" className="form-error">{problem || error}</p>}
      <button type="button" className="btn btn-primary mt-5 w-full" disabled={busy} onClick={go}>{busy ? 'Starting…' : 'Start inspection'}</button>
    </div>
  )
}
