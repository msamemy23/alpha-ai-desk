'use client'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { scheduleWords } from '@/lib/automation-text'
import { ago, OnOff, Fact, Status } from './parts'
import type { CustomAutomation, Lamp } from './types'

interface Props {
  item: CustomAutomation
  busy: boolean
  running: boolean
  onToggle: (next: boolean) => void
  onRun: () => void
  onRead: () => void
  onEdit: () => void
  onDelete: () => void
}

/** Words for where a plan of your own stands. Running one only writes a plan; nothing is sent. */
function standing(item: CustomAutomation): { lamp: Lamp; text: string } {
  switch (item.status) {
    case 'awaiting_approval': return { lamp: 'amber', text: 'Plan written. Read it, then act on it yourself.' }
    case 'completed': return { lamp: 'green', text: `Last run worked${item.last_run ? `, ${ago(item.last_run)}` : ''}` }
    case 'error': return { lamp: 'red', text: `Last run failed${item.last_run ? `, ${ago(item.last_run)}` : ''}` }
    case 'running': return { lamp: 'blue', text: 'Running now' }
    default: return { lamp: 'off', text: item.last_run ? `Last ran ${ago(item.last_run)}` : 'Has not run yet' }
  }
}

export default function CustomCard({ item, busy, running, onToggle, onRun, onRead, onEdit, onDelete }: Props) {
  const st = standing(item)
  const failed = item.status === 'error'
  const hasPlan = !!item.last_result && !failed
  return (
    <article className="card h-full">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-bg-hover text-text-secondary">
          <Icon name="pen" className="h-5 w-5" />
        </span>
        <h3 className="min-w-0 flex-1 break-words font-bold leading-tight">{item.name}</h3>
        <OnOff enabled={item.enabled} name={`${item.name} on or paused`} onChange={onToggle} disabled={busy || running} />
      </div>
      <p className="mt-2 line-clamp-3 break-words text-[0.9375rem] text-text-secondary">{item.task_prompt}</p>
      {item.description && <p className="mt-1 line-clamp-2 break-words text-[0.9375rem] text-text-muted">Note: {item.description}</p>}

      <div className="mt-3 space-y-1 text-[0.9375rem]">
        <Fact icon="clock">{scheduleWords(item.schedule) || item.schedule}</Fact>
        <Status lamp={st.lamp}>{st.text}{item.run_count > 0 ? <span className="text-text-secondary"> · {item.run_count} {item.run_count === 1 ? 'run' : 'runs'} so far</span> : null}</Status>
      </div>

      {failed && item.last_result && <Notice kind="error" className="mt-3"><span className="font-bold">What went wrong: </span>{item.last_result}</Notice>}
      {hasPlan && <p className="mt-3 line-clamp-3 break-words rounded-md bg-bg-hover px-3 py-2 text-[0.9375rem] text-text-secondary">{item.last_result}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={onRun} disabled={running || busy} aria-label={`Write a plan: ${item.name}`}>
          <Icon name="play" className="h-4 w-4" />
          {running ? 'Writing…' : 'Write a plan'}
        </button>
        {hasPlan && (
          <button type="button" className="btn btn-ghost" onClick={onRead} aria-label={`Read plan: ${item.name}`}>
            <Icon name="eye" className="h-5 w-5" />
            Read plan
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onEdit} disabled={busy || running} aria-label={`Edit: ${item.name}`}>
          <Icon name="edit" className="h-5 w-5" />
          Edit
        </button>
        <button type="button" className="btn btn-danger sm:ml-auto" onClick={onDelete} disabled={busy || running} aria-label={`Delete: ${item.name}`}>
          <Icon name="trash" className="h-5 w-5" />
          Delete
        </button>
      </div>
    </article>
  )
}
