'use client'
import { RATING_CUSTOMER_WORD, URGENCIES, URGENCY_HELP, URGENCY_WORD, counts, estimateTotal, findingMeasure, findings, fmtMoney, summaryWords } from '@/lib/dvi'
import type { DviSection } from '@/lib/dvi'
import type { Change } from '@/lib/dvi-history'

const SINCE_WORD: Record<Change['kind'], string> = { worse: 'Got worse', new: 'New', declined: 'Still open', still: 'Still open', better: 'Better', fixed: 'Fixed' }

/**
 * The inspection as a sheet of paper: what a customer can be handed, or saved as a PDF. Always black on white.
 * Findings are grouped by how soon they should be fixed, every reading is written out with its warning in words,
 * and the technician's private notes are never part of it.
 */
export default function Report({ shop, logo, customer, vehicle, tech, date, note, sections, urlFor = s => s, showPhotos = true, since }: {
  shop: { name: string; phone: string; address?: string }
  logo: string | null
  customer: string
  vehicle: string
  tech: string
  date: string
  note: string
  sections: DviSection[]
  /** The address of a stored picture; null while it is still being fetched. Pictures kept in the row pass straight through. */
  urlFor?: (src: string) => string | null
  showPhotos?: boolean
  /** What changed since the last inspection of this car, when the shop chose to print it. */
  since?: { changes: Change[]; lastDate: string } | null
}) {
  const list = findings(sections)
  const c = counts(sections)
  const clipCount = list.reduce((n, f) => n + f.clips.length, 0)
  return (
    <article className="mx-auto w-full max-w-3xl bg-white p-6 text-black print:p-0 sm:p-8" aria-label="Inspection report">
      <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-4">
        <div className="min-w-0">
          <h1 className="text-[1.5rem] font-bold leading-tight">Vehicle inspection</h1>
          <p className="mt-1 text-[0.9375rem]">{customer || 'No name'}{vehicle ? ` · ${vehicle}` : ''}</p>
          <p className="text-[0.875rem]">{date}{tech ? ` · Inspected by ${tech}` : ''}</p>
        </div>
        <div className="shrink-0 text-right text-[0.875rem]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo && <img src={logo} alt="" className="ml-auto mb-1 max-h-16 w-auto" />}
          <p className="font-bold">{shop.name}</p>
          {shop.address && <p>{shop.address}</p>}
          {shop.phone && <p>{shop.phone}</p>}
        </div>
      </header>

      <p className="mt-4 text-[1rem] font-bold">{summaryWords(c)}</p>
      {note && <p className="mt-1 whitespace-pre-wrap text-[0.9375rem]">{note}</p>}

      {list.length > 0 && URGENCIES.map(u => {
        const group = list.filter(f => f.urgency === u)
        if (group.length === 0) return null
        const total = estimateTotal(group)
        return (
          <section key={u} className="mt-5" aria-label={URGENCY_WORD[u]}>
            <h2 className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-black pb-1 text-[1.125rem] font-bold">
              <span>{URGENCY_WORD[u]} <span className="text-[0.875rem] font-normal">({group.length})</span></span>
              {total > 0 && <span className="num text-[0.9375rem]">About {fmtMoney(total)}</span>}
            </h2>
            <p className="mt-1 text-[0.8125rem]">{URGENCY_HELP[u]}</p>
            <ul className="mt-2 space-y-3">
              {group.map(f => (
                <li key={f.id} className="break-inside-avoid">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-bold">{f.name} <span className="font-normal">({RATING_CUSTOMER_WORD[f.status]})</span></span>
                    {f.price !== null && <span className="num font-bold">{fmtMoney(f.price)}</span>}
                  </p>
                  {f.measure && <p className="num text-[0.9375rem]">{f.measure.text}. {f.measure.word}.</p>}
                  {f.note && <p className="text-[0.9375rem]">{f.note}</p>}
                  {showPhotos && f.photos.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {f.photos.map((src, i) => {
                        const url = urlFor(src)
                        // eslint-disable-next-line @next/next/no-img-element
                        return url ? <img key={i} src={url} alt={`${f.name}, photo ${i + 1}`} loading="eager" className="h-32 w-auto max-w-[48%] border border-black/30 object-cover" /> : <span key={i} className="grid h-32 w-40 place-items-center border border-black/30 text-[0.8125rem]">Loading the photo</span>
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {clipCount > 0 && <p className="mt-3 text-[0.8125rem]">{clipCount} video or voice {clipCount === 1 ? 'note is' : 'notes are'} on the online page, which the shop sends by text or email.</p>}

      {since && since.changes.length > 0 && (
        <section className="mt-6 break-inside-avoid" aria-label="Since the last visit">
          <h2 className="border-b border-black pb-1 text-[1.125rem] font-bold">Since the last visit, {since.lastDate}</h2>
          <ul className="mt-2 space-y-1.5">
            {since.changes.slice(0, 20).map((ch, i) => (
              <li key={`${ch.name}-${i}`} className="text-[0.9375rem]">
                <span className="font-bold">{ch.name}</span>: {SINCE_WORD[ch.kind]}. {ch.words}
                {ch.reading ? <span className="num"> {ch.reading.before} before, {ch.reading.now} now.{ch.reading.wear ? ` ${ch.reading.wear}` : ''}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6" aria-label="Everything checked">
        <h2 className="border-b border-black pb-1 text-[1.125rem] font-bold">Everything checked</h2>
        {sections.map(s => {
          const rated = s.items.filter(i => i.status)
          if (rated.length === 0) return null
          return (
            <div key={s.title} className="mt-3 break-inside-avoid">
              <h3 className="text-[0.9375rem] font-bold">{s.title}</h3>
              <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
                {rated.map(i => {
                  const m = findingMeasure(i.measure)
                  return (
                    <li key={i.id} className="flex items-baseline justify-between gap-3 border-b border-black/15 py-1 text-[0.875rem]">
                      <span className="min-w-0">{i.name}{m && m.kind !== 'pressure' ? <span className="num"> · {m.text}</span> : null}</span>
                      <span className="shrink-0 font-bold">{i.status ? RATING_CUSTOMER_WORD[i.status] : ''}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
        {c.unrated > 0 && <p className="mt-3 text-[0.8125rem]">{c.unrated} {c.unrated === 1 ? 'item was' : 'items were'} not checked.</p>}
      </section>
    </article>
  )
}
