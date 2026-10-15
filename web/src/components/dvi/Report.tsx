'use client'
import { RATING_CUSTOMER_WORD, counts, findings, fmtMoney, summaryWords } from '@/lib/dvi'
import type { DviSection } from '@/lib/dvi'

/** The inspection as a sheet of paper: what a customer can be handed, or saved as a PDF. Always black on white. */
export default function Report({ shop, logo, customer, vehicle, tech, date, note, sections }: {
  shop: { name: string; phone: string; address?: string }
  logo: string | null
  customer: string
  vehicle: string
  tech: string
  date: string
  note: string
  sections: DviSection[]
}) {
  const list = findings(sections)
  const c = counts(sections)
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

      {list.length > 0 && (
        <section className="mt-5" aria-label="Findings">
          <h2 className="border-b border-black pb-1 text-[1.125rem] font-bold">What we found</h2>
          <ul className="mt-2 space-y-3">
            {list.map(f => (
              <li key={f.id} className="break-inside-avoid">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-bold">{f.name} <span className="font-normal">({RATING_CUSTOMER_WORD[f.status]})</span></span>
                  {f.price !== null && <span className="num font-bold">{fmtMoney(f.price)}</span>}
                </p>
                {f.note && <p className="text-[0.9375rem]">{f.note}</p>}
                {f.photos.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {f.photos.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={src} alt={`${f.name}, photo ${i + 1}`} className="h-32 w-auto max-w-[48%] border border-black/30 object-cover" />
                    ))}
                  </div>
                )}
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
                {rated.map(i => (
                  <li key={i.id} className="flex items-baseline justify-between gap-3 border-b border-black/15 py-1 text-[0.875rem]">
                    <span className="min-w-0">{i.name}</span>
                    <span className="shrink-0 font-bold">{i.status ? RATING_CUSTOMER_WORD[i.status] : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
        {c.unrated > 0 && <p className="mt-3 text-[0.8125rem]">{c.unrated} {c.unrated === 1 ? 'item was' : 'items were'} not checked.</p>}
      </section>
    </article>
  )
}
