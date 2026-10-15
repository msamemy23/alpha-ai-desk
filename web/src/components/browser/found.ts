// "Use what was found": the text that is copied, and the question that is handed to Ask Alpha.
// Page text came from someone else's website, so whatever goes to Ask Alpha is wrapped as information, never as instructions.
import { cleanPageText, wrapUntrusted } from '../../lib/browser/untrusted.ts'
import { displayHost } from '../../lib/browser/url.ts'
import type { Block, Inline, ReaderDoc } from '../../lib/browser/reader.ts'

/** Ask Alpha reads this note once when the screen opens, and puts it in the message box without sending it. */
export const PREFILL_KEY = 'ai_prefill'
/** The Ask Alpha box holds 4000 characters. */
export const PREFILL_MAX = 3600

export function runsText(runs: Inline[] | undefined): string {
  return (Array.isArray(runs) ? runs : []).map(r => (r && typeof r.t === 'string' ? r.t : '')).join('').replace(/\s+/g, ' ').trim()
}

/**
 * A page as plain lines, the way a person would copy it: headings, paragraphs, lists and tables. No links, no markup.
 * Each piece is cleaned of invisible characters before it is joined, so a nested list keeps its indent.
 */
export function blocksToText(blocks: Block[], limit = 12000): string {
  const clean = (t: string) => cleanPageText(t, limit)
  let out = ''
  let previousWasListLine = false
  for (const b of Array.isArray(blocks) ? blocks : []) {
    let line = ''
    let listLine = false
    switch (b?.k) {
      case 'h': case 'p': case 'quote': line = clean(runsText(b.runs)); break
      case 'li': {
        listLine = true
        const body = clean(runsText(b.runs))
        if (body) line = `${'  '.repeat(Math.min(4, Math.max(0, Math.round(Number(b.depth) || 0))))}${b.ordered ? `${Math.max(1, Math.round(Number(b.index) || 1))}.` : '-'} ${body}`
        break
      }
      case 'pre': line = clean(String(b.text || '').trimEnd()); break
      case 'table': line = clean((Array.isArray(b.rows) ? b.rows : []).map(r => (Array.isArray(r) ? r.join(' | ') : '')).join('\n')); break
      case 'facts': line = clean([b.title, ...(Array.isArray(b.rows) ? b.rows : []).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join('\n')); break
      default: line = ''
    }
    if (!line.trim()) continue
    out += (out ? (listLine && previousWasListLine ? '\n' : '\n\n') : '') + line
    previousWasListLine = listLine
    if (out.length >= limit) break
  }
  return out.length > limit ? `${out.slice(0, limit).trimEnd()}…` : out
}

/** What "Copy" puts on the clipboard for a page. */
export function pageCopyText(doc: ReaderDoc, url: string): string {
  const title = cleanPageText(doc.title || '', 200)
  return [title, url, '', blocksToText(doc.blocks)].join('\n').trim()
}

export interface FoundAnswer {
  goal: string
  text: string
  evidence: string
  verified: boolean
  sourceUrl: string
  sourceTitle: string
}

export const UNVERIFIED_WORDS = 'Alpha could not match this answer to the page. Check it on the page before you rely on it.'

/** What "Copy" puts on the clipboard for an answer Alpha found. */
export function answerCopyText(a: FoundAnswer): string {
  const lines = [
    `Question: ${a.goal}`,
    `Answer: ${a.text}`,
    a.evidence ? `What the page says: “${a.evidence}”` : '',
    `Source: ${a.sourceTitle ? `${a.sourceTitle} ` : ''}${a.sourceUrl}`.trim(),
    a.verified ? '' : UNVERIFIED_WORDS,
  ]
  return lines.filter(Boolean).join('\n')
}

function cap(text: string): string {
  return text.length > PREFILL_MAX ? `${text.slice(0, PREFILL_MAX - 1).trimEnd()}…` : text
}

/** The message that opens in Ask Alpha for a page. The person reads it, adds their question and sends it. */
export function textPrefill(title: string, url: string, text: string): string {
  const host = displayHost(url) || 'a website'
  return cap([
    'I found this page in the Browser. Help me use it.',
    '',
    `Page: ${cleanPageText(title || '', 160)} (${host})`,
    `Address: ${url}`,
    '',
    wrapUntrusted(text, host, 2400),
    '',
    'What I want to know: ',
  ].join('\n'))
}

export function pagePrefill(doc: ReaderDoc, url: string): string {
  return textPrefill(doc.title, url, blocksToText(doc.blocks, 2400))
}

/** A page seen in Live view, as plain text: the title, the address and what a person sees on it. */
export function liveCopyText(snap: { title: string; url: string; text: string }): string {
  return [cleanPageText(snap.title || '', 200), snap.url, '', cleanPageText(snap.text || '', 12000)].join('\n').trim()
}

export function livePrefill(snap: { title: string; url: string; text: string }): string {
  return textPrefill(snap.title, snap.url, cleanPageText(snap.text || '', 2400))
}

/** The message that opens in Ask Alpha for an answer Alpha looked up. */
export function answerPrefill(a: FoundAnswer): string {
  const host = displayHost(a.sourceUrl) || 'a website'
  return cap([
    'Alpha looked this up in the Browser for me.',
    '',
    `I asked: ${cleanPageText(a.goal, 400)}`,
    `Source: ${a.sourceUrl}`,
    a.verified ? '' : UNVERIFIED_WORDS,
    '',
    wrapUntrusted(`Answer: ${a.text}\nWhat the page says: ${a.evidence}`, host, 1800),
    '',
    'Help me use this: ',
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n'))
}
