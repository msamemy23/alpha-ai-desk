'use client'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { phonePretty } from '@/lib/today'
import { CALL_KIND_LABEL, CALL_KIND_LAMP, CALL_KIND_TEXT, callKind, formatDuration, otherNumber, recordingUrl, stamp } from './utils'
import type { CallRecord } from './utils'
import { LeadTag } from './CallsView'
import AiReview from './AiReview'
import type { Interaction } from './ai-types'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-border py-2.5 last:border-b-0">
      <dt className="w-28 shrink-0 text-[0.9375rem] text-text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  )
}

/** Everything about one call: who, how it went, recording, transcript and what the AI noted. */
export default function CallDetail({ call, name, customerId, onCallBack, onText, ai, onAiChanged }: {
  call: CallRecord
  name: string
  customerId: string | null
  onCallBack: () => void
  onText: () => void
  /** What the assistant recorded about this call, when it answered it. */
  ai?: Interaction
  onAiChanged?: () => void
}) {
  const kind = callKind(call.direction, call.status, call.duration_secs, call.viaAi)
  const number = otherNumber(call)
  const rec = recordingUrl(call)
  const failed = call.transcript === '[transcription_failed]'
  const hasInsights = !!call.lead_score && call.lead_score !== 'unknown'
  const service = call.service_needed && call.service_needed !== 'unknown' ? call.service_needed : ''

  return (
    <div className="space-y-6">
      <div className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 font-bold">
          <span className={`lamp ${CALL_KIND_LAMP[kind]}`} aria-hidden="true" />
          <span className={CALL_KIND_TEXT[kind]}>{CALL_KIND_LABEL[kind]} call</span>
        </span>
        <span className="text-text-secondary">{stamp(call.start_time)}</span>
        {kind !== 'missed' && <span className="num text-text-secondary">{formatDuration(call.duration_secs)} long</span>}
        {call.viaAi && <span className="tag tag-gray">AI assistant</span>}
        <LeadTag score={call.lead_score} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-primary" onClick={onCallBack} disabled={!number}>
          <Icon name="phone" className="h-5 w-5" />{kind === 'outgoing' ? 'Call again' : 'Call back'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onText} disabled={!number}>
          <Icon name="inbox" className="h-5 w-5" />Send a text
        </button>
      </div>

      <dl className="rounded-lg border border-border bg-bg-base px-4">
        <Fact label="Number">{number ? phonePretty(number) : <span className="text-text-secondary">Unknown</span>}</Fact>
        <Fact label="Customer">
          {name
            ? (customerId
              ? <Link href={`/customers?customer=${encodeURIComponent(customerId)}`} className="font-bold text-blue underline-offset-2 hover:underline">{name}</Link>
              : name)
            : <span className="text-text-secondary">Not matched to a customer</span>}
        </Fact>
        <Fact label="Times called">{call.call_count_from_number || 1}</Fact>
        {service && <Fact label="Needs">{service}</Fact>}
      </dl>

      {ai && <AiReview interactionId={ai.id} onChanged={onAiChanged} />}

      {!ai && hasInsights && (
        <section aria-labelledby="cd-ai" className="space-y-2">
          <h3 id="cd-ai" className="section-title">What the AI noted</h3>
          <div className="space-y-2 rounded-lg border border-border bg-bg-base p-4 text-[0.9375rem]">
            {call.lead_reasoning && <p>{call.lead_reasoning}</p>}
            {call.caller_sentiment && <p><span className="text-text-secondary">Caller mood:</span> <span className="font-bold capitalize">{call.caller_sentiment}</span></p>}
            {call.key_quotes && <p className="italic text-text-secondary">&ldquo;{call.key_quotes}&rdquo;</p>}
          </div>
        </section>
      )}

      {!ai && rec && (
        <section aria-labelledby="cd-rec" className="space-y-2">
          <h3 id="cd-rec" className="section-title">Recording</h3>
          <audio controls preload="none" src={rec} className="w-full" aria-label="Call recording" />
        </section>
      )}

      {!ai && (call.transcript || rec) && (
        <section aria-labelledby="cd-tx" className="space-y-2">
          <h3 id="cd-tx" className="section-title">Transcript</h3>
          {call.transcript && !failed ? (
            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-base p-4 text-[0.9375rem] leading-relaxed">{call.transcript}</div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">
              {failed ? 'This recording has expired, so there is no transcript.' : 'The transcript is not ready yet. Check back in a few minutes.'}
            </p>
          )}
        </section>
      )}

      {!ai && !rec && !call.transcript && !hasInsights && (
        <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">
          {kind === 'missed' ? 'Nobody picked up, so there is no recording.' : 'There is no recording or transcript for this call.'}
        </p>
      )}
    </div>
  )
}
