'use client'
import Icon from '@/components/Icon'
import { STEPS } from './services'

export default function Progress({ step, done }: { step: number; done: boolean }) {
  return (
    <ol className="mb-6 flex items-start" aria-label="Setup progress">
      {STEPS.map((label, i) => {
        const n = i + 1
        const status = done || n < step ? 'done' : n === step ? 'current' : 'todo'
        const circle =
          status === 'done'
            ? 'border-green bg-green text-[rgb(var(--c-card))]'
            : status === 'current'
              ? 'border-blue bg-blue text-[rgb(var(--c-on-blue))]'
              : 'border-line bg-bg-card text-text-secondary'
        return (
          <li key={label} aria-current={status === 'current' ? 'step' : undefined} className="relative flex flex-1 flex-col items-center gap-1.5 text-center">
            {i > 0 && (
              <span aria-hidden="true" className={`absolute left-[-50%] top-[1.0625rem] h-0.5 w-full ${n <= step || done ? 'bg-green' : 'bg-border'}`} />
            )}
            <span className={`display num relative z-10 grid h-9 w-9 place-items-center rounded-full border-2 text-[1rem] font-bold ${circle}`}>
              {status === 'done' ? <Icon name="check" className="h-5 w-5" strokeWidth={2.6} /> : n}
            </span>
            <span className={`text-[0.8125rem] font-bold leading-tight ${status === 'todo' ? 'text-text-secondary' : 'text-text-primary'}`}>
              {label}
              <span className="sr-only">{status === 'done' ? ', done' : status === 'current' ? ', current step' : ', not started'}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
