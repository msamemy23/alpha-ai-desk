'use client'
import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import Notice from '@/components/Notice'
import { EmptyBlock } from '@/components/ListKit'
import { Fact } from '@/components/ScreenParts'
import { injectionNotice } from '../../lib/browser/untrusted'
import type { Block, Inline, ReaderDoc } from '../../lib/browser/reader'
import { addressText, imageSrc, safeLink } from './address'
import { groupBlocks, isPlainClick, listIndent, listMarker } from './blocks'
import type { Drawn } from './blocks'
import { SIGN_IN_WORDS } from './live'
import { OutsideLink } from './parts'

type Open = (url: string) => void

function Run({ run, onOpen }: { run: Inline; onOpen: Open }) {
  let node: ReactNode = String(run.t ?? '')
  if (run.code) node = <code className="rounded bg-bg-chrome px-1 text-[0.9em]">{node}</code>
  if (run.b) node = <strong>{node}</strong>
  if (run.i) node = <em>{node}</em>
  const link = run.href ? safeLink(run.href) : null
  if (link && link.kind === 'web') {
    const url = link.url
    node = (
      <a
        href={url}
        rel="nofollow noopener noreferrer"
        className="break-words text-blue underline"
        onClick={(e: MouseEvent<HTMLAnchorElement>) => { if (isPlainClick(e)) { e.preventDefault(); onOpen(url) } }}
      >
        {node}
      </a>
    )
  } else if (link && link.kind === 'tel') {
    node = <a href={link.url} className="text-blue underline">{node}</a>
  }
  return <>{node}</>
}

function Runs({ runs, onOpen }: { runs: Inline[] | undefined; onOpen: Open }) {
  return <>{(Array.isArray(runs) ? runs : []).map((r, i) => <Run key={i} run={r} onOpen={onOpen} />)}</>
}

/** A picture on the page. It loads through Alpha's own picture route, never straight from the site. If it will not load, its description shows instead. */
function PageImage({ src, alt, show }: { src: string; alt: string; show: boolean }) {
  const [failed, setFailed] = useState(false)
  const address = show ? imageSrc(src) : null
  const text = String(alt || '').trim()
  if (!address || failed) return text ? <p className="mb-3 text-[0.9375rem] text-text-secondary">Picture: {text}</p> : null
  return (
    <figure className="mb-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={address} alt={text} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-auto max-h-80 max-w-full rounded-md border border-border" />
      {text && <figcaption className="mt-1 text-[0.875rem] text-text-secondary">{text}</figcaption>}
    </figure>
  )
}

const HEADING: Record<number, string> = {
  1: 'display mb-2 mt-5 text-[1.5rem] font-bold leading-tight',
  2: 'display mb-2 mt-4 text-[1.25rem] font-bold leading-tight',
  3: 'mb-1.5 mt-3 text-[1.0625rem] font-bold leading-snug',
  4: 'mb-1.5 mt-3 text-base font-bold leading-snug',
}

function DrawnBlock({ b, onOpen, images }: { b: Drawn; onOpen: Open; images: boolean }) {
  switch (b.k) {
    case 'h': {
      const level = b.level >= 1 && b.level <= 4 ? b.level : 3
      const cls = `${HEADING[level]} break-words`
      const kids = <Runs runs={b.runs} onOpen={onOpen} />
      return level === 1 ? <h3 className={cls}>{kids}</h3> : level === 2 ? <h4 className={cls}>{kids}</h4> : <h5 className={cls}>{kids}</h5>
    }
    case 'p':
      return <p className="mb-3 break-words leading-relaxed"><Runs runs={b.runs} onOpen={onOpen} /></p>
    case 'list':
      return (
        <ul role="list" className="mb-3 space-y-1">
          {b.items.map((it, i) => (
            <li key={i} role="listitem" className="flex gap-2 break-words leading-relaxed" style={{ paddingLeft: `${listIndent(it) * 1.25}rem` }}>
              <span className="num w-6 shrink-0 text-right text-text-secondary" aria-hidden="true">{listMarker(it)}</span>
              <span className="min-w-0 flex-1"><Runs runs={it.runs} onOpen={onOpen} /></span>
            </li>
          ))}
        </ul>
      )
    case 'quote':
      return <blockquote className="mb-3 break-words border-l-4 border-[rgb(var(--c-line))] pl-3 leading-relaxed text-text-secondary"><Runs runs={b.runs} onOpen={onOpen} /></blockquote>
    case 'pre':
      return <pre className="mb-3 overflow-x-auto rounded-md border border-border bg-bg-chrome p-3 text-[0.875rem] leading-snug">{String(b.text ?? '')}</pre>
    case 'img':
      return <PageImage src={b.src} alt={b.alt} show={images} />
    case 'table': {
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 200)
      if (!rows.length) return null
      const head = b.header ? rows[0] : null
      const body = b.header ? rows.slice(1) : rows
      return (
        <div className="mb-3 overflow-x-auto rounded-md border border-border">
          <table className="data-table">
            {head && <thead><tr>{head.map((c, i) => <th key={i} scope="col">{String(c)}</th>)}</tr></thead>}
            <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{String(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
    }
    case 'form':
      return (
        <div className="mb-3 rounded-md border border-dashed border-[rgb(var(--c-line))] px-3 py-2.5 text-[0.9375rem] text-text-secondary">
          <span className="font-bold text-text-primary">This page has a form.</span> {String(b.summary || '')} Use Live view to fill it in.
        </div>
      )
    case 'facts':
      return (
        <div className="card mb-3">
          {b.title && <p className="mb-2 font-bold">{b.title}</p>}
          <dl className="grid gap-3 sm:grid-cols-2">{(Array.isArray(b.rows) ? b.rows : []).map(([k, v], i) => <Fact key={i} label={String(k)}>{String(v)}</Fact>)}</dl>
        </div>
      )
    case 'hr':
      return <hr className="my-4 border-border" />
    default:
      return null
  }
}

/**
 * A page in Reader view. Alpha draws plain blocks from what it read; the site's own page, scripts and styles never run here.
 */
export default function ReaderView({
  doc, finalUrl, images, onOpen, onLive,
}: { doc: ReaderDoc; finalUrl: string; images: boolean; onOpen: Open; onLive: () => void }) {
  const drawn = groupBlocks(doc.blocks as Block[])
  const warn = injectionNotice(doc.injection)
  return (
    <article className="min-w-0" aria-label={doc.title || 'Page'}>
      <header className="mb-3 min-w-0">
        <h2 className="section-title break-words">{doc.title || doc.siteName || addressText(finalUrl)}</h2>
        <p className="mt-0.5 break-all text-[0.875rem] text-text-secondary">{addressText(finalUrl)}</p>
      </header>
      <div className="mb-3 space-y-2">
        {doc.signInRequired && (
          <Notice kind="warn">
            <p>{SIGN_IN_WORDS}</p>
            <div className="mt-2"><OutsideLink url={finalUrl} /></div>
          </Notice>
        )}
        {warn && <Notice kind="warn">{warn}</Notice>}
        {doc.truncated && <Notice kind="info">This page is long. Only the first part is shown here.</Notice>}
        {doc.hasFields && (
          <Notice kind="info">
            <p>This page has boxes to type into, such as a search or part number box.</p>
            <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={onLive}>Fill them in with Live view</button>
          </Notice>
        )}
      </div>
      {drawn.length === 0 ? (
        <EmptyBlock icon="globe" title="Nothing to read on this page" action={<button type="button" className="btn btn-primary" onClick={onLive}>Try Live view</button>}>
          The page may need to run its own scripts to show anything. Live view shows it as a picture.
        </EmptyBlock>
      ) : (
        <div className="min-w-0 text-text-primary">
          {drawn.map((b, i) => <DrawnBlock key={i} b={b} onOpen={onOpen} images={images} />)}
        </div>
      )}
    </article>
  )
}
