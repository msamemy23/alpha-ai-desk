/**
 * The small, safe markdown subset used for Ask Alpha answers: paragraphs, lists,
 * headings, quotes, rules, fenced code, simple tables, bold, italics, inline code,
 * links and images. Every piece of text is escaped before any markup is added, so
 * model or provider output can never bring markup of its own.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Only http and https links survive. Anything else becomes an inert "#". */
export function safeUrl(value: string): string {
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const url = new URL(value, base)
    if (!['http:', 'https:'].includes(url.protocol)) return '#'
    return escapeHtml(url.href)
  } catch {
    return '#'
  }
}

const CODE_CLASS = 'break-words rounded bg-text-primary/[0.08] px-1 py-0.5 text-[0.9em]'

function renderInlineText(escaped: string): string {
  return escaped
    // YouTube embeds: bare embed URLs
    .replace(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([\w-]{11})/g, (_m, id) => `<div style="margin:8px 0;border-radius:12px;overflow:hidden;max-width:480px"><iframe width="100%" height="270" src="https://www.youtube.com/embed/${id}" frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen style="border-radius:12px"></iframe></div>`)
    // Images: ![alt](url). The text is already escaped.
    .replace(/!\[([^\]]*)]\(([^)]+)\)/g, (_m, alt, url) => `<img src="${safeUrl(String(url).replace(/&amp;/g, '&'))}" alt="${alt}" class="my-1 inline-block max-h-[300px] max-w-full rounded-lg object-cover sm:max-w-[300px]" />`)
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `<a href="${safeUrl(String(url).replace(/&amp;/g, '&'))}" target="_blank" rel="noopener noreferrer" class="break-words font-bold text-blue underline underline-offset-4">${label}</a>`)
    // Bold: **text**
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold">$1</strong>')
    // Italic: *text*, only when the stars hug the words so "5 * 3" stays maths
    .replace(/(^|[\s(>])\*([^\s*](?:[^*]*[^\s*])?)\*(?=$|[\s).,;:!?<])/g, '$1<em>$2</em>')
}

function renderInline(escaped: string): string {
  // Code spans first, so nothing inside backticks is treated as markup.
  return escaped
    .split(/(`[^`]+`)/g)
    .map(part => (part.length > 2 && part.startsWith('`') && part.endsWith('`'))
      ? `<code class="${CODE_CLASS}">${part.slice(1, -1)}</code>`
      : renderInlineText(part))
    .join('')
}

export function renderChatMarkdown(text: string): string {
  const lines = escapeHtml(text).split('\n')
  const out: string[] = []
  let paragraph: string[] = []
  let list: { tag: 'ul' | 'ol'; items: string[]; start: number } | null = null
  let quote: string[] = []
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p class="mt-3 first:mt-0">${paragraph.map(renderInline).join('<br />')}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (list) {
      const style = list.tag === 'ul' ? 'list-disc' : 'list-decimal'
      const start = list.tag === 'ol' && list.start > 1 ? ` start="${list.start}"` : ''
      out.push(`<${list.tag}${start} class="mt-3 first:mt-0 ${style} space-y-1.5 pl-6">${list.items.map(item => `<li class="pl-1">${renderInline(item)}</li>`).join('')}</${list.tag}>`)
    }
    list = null
  }
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote class="mt-3 first:mt-0 border-l-4 border-line pl-3 text-text-secondary">${quote.map(renderInline).join('<br />')}</blockquote>`)
    quote = []
  }
  const flushAll = () => { flushParagraph(); flushList(); flushQuote() }
  const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) { flushAll(); continue }

    // Fenced code. An unclosed fence runs to the end of the answer.
    if (/^\s*```/.test(line)) {
      flushAll()
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++ }
      out.push(`<pre tabindex="0" class="mt-3 first:mt-0 overflow-x-auto rounded-lg border border-border bg-text-primary/[0.05] px-3 py-2.5 text-[0.875rem] leading-relaxed"><code>${code.join('\n')}</code></pre>`)
      continue
    }

    const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)$/)
    if (heading) { flushAll(); out.push(`<h3 class="mt-4 first:mt-0 font-bold text-[1.0625rem] leading-snug">${renderInline(heading[1])}</h3>`); continue }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flushAll(); out.push('<hr class="my-4 border-border" />'); continue }

    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flushAll()
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i++ }
      i--
      // The table keeps its natural width and scrolls sideways inside its own box,
      // so a wide table never pushes the whole page sideways on a phone.
      out.push(`<div tabindex="0" class="mt-3 first:mt-0 overflow-x-auto rounded-lg border border-border"><table class="w-max min-w-full text-[0.9375rem]"><thead><tr>${head.map(cell => `<th class="whitespace-nowrap border-b border-line px-3 py-2 text-left text-[0.8125rem] font-bold text-text-secondary">${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${head.map((_, c) => `<td class="min-w-[5rem] max-w-[18rem] border-b border-border px-3 py-2 align-top">${renderInline(row[c] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }

    const quoted = line.match(/^\s*&gt;\s?(.*)$/)
    if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1]); continue }

    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const numbered = line.match(/^\s*(\d{1,3})[.)]\s+(.*)$/)
    if (bullet || numbered) {
      flushParagraph(); flushQuote()
      const tag = bullet ? 'ul' : 'ol'
      if (list && list.tag !== tag) flushList()
      if (!list) list = { tag, items: [], start: numbered ? Number(numbered[1]) : 1 }
      list.items.push(bullet ? bullet[1] : numbered![2])
      continue
    }
    flushList(); flushQuote()
    paragraph.push(line)
  }
  flushAll()
  return out.join('')
}

/** The answer as plain text for pasting into a text message, email or note. */
export function chatPlainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '')
    .replace(/^\s*\|(.*)\|\s*$/gm, (_m, row: string) => row.split('|').map(cell => cell.trim()).join(' | '))
    .replace(/!\[([^\]]*)]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^\s*](?:[^*]*[^\s*])?)\*(?=$|[\s).,;:!?])/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '- ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
