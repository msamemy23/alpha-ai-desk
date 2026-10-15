'use client'
import Icon from '@/components/Icon'
import { SERVICES } from './services'

export default function ServicesStep({
  headingRef, selected, extras, custom, onCustom, onAddCustom, onToggle, onBack, onNext,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>
  selected: string[]
  /** Services the shop added or saved earlier that are not in the common list. */
  extras: string[]
  custom: string
  onCustom: (value: string) => void
  onAddCustom: () => void
  onToggle: (value: string) => void
  onBack: () => void
  onNext: () => void
}) {
  const options = [...SERVICES, ...extras.map(v => ({ value: v, label: v }))]
  return (
    <section className="card" aria-labelledby="step-title">
      <h2 id="step-title" ref={headingRef} tabIndex={-1} className="section-title outline-none"><span className="sr-only">Step 2 of 3: </span>What does your shop do?</h2>
      <p className="mt-1 text-[0.9375rem] text-text-secondary">Pick every service you offer. You can skip this.</p>

      <fieldset className="mt-5">
        <legend className="sr-only">Services your shop offers</legend>
        <ul className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
          {options.map(svc => {
            const checked = selected.includes(svc.value)
            return (
              <li key={svc.value}>
                <label
                  className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-md border px-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue ${
                    checked ? 'border-blue bg-blue/10' : 'border-line bg-bg-card hover:bg-bg-hover'
                  }`}
                >
                  <input type="checkbox" className="sr-only" checked={checked} onChange={() => onToggle(svc.value)} />
                  <span
                    aria-hidden="true"
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded border-2 ${checked ? 'border-blue bg-blue text-[rgb(var(--c-on-blue))]' : 'border-line bg-bg-input'}`}
                  >
                    {checked && <Icon name="check" className="h-4 w-4" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 break-words font-bold leading-tight">{svc.label}</span>
                </label>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-[0.875rem] text-text-secondary" aria-live="polite">
          {selected.length === 0 ? 'None selected yet.' : `${selected.length} selected.`}
        </p>
      </fieldset>

      <div className="mt-4">
        <label htmlFor="ob-custom" className="form-label">Another service (optional)</label>
        <div className="flex gap-2">
          <input
            id="ob-custom"
            className="form-input min-w-0 flex-1"
            value={custom}
            onChange={e => onCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAddCustom() } }}
            placeholder="Fleet maintenance"
            enterKeyHint="done"
            maxLength={60}
          />
          <button type="button" className="btn btn-secondary shrink-0" onClick={onAddCustom} disabled={!custom.trim()}>Add service</button>
        </div>
        <p className="form-hint !text-text-secondary">Not in the list? Add it, and it joins the choices above. Add as many as you like.</p>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          <Icon name="chevronLeft" className="h-5 w-5" />
          Back
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={onNext}>
          Next: finish
          <Icon name="arrowRight" className="h-5 w-5" />
        </button>
      </div>
    </section>
  )
}
