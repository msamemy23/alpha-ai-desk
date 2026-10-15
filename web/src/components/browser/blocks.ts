// Reader view draws a page from plain blocks. This groups the list lines together so they draw as one list.
import type { Block } from '../../lib/browser/reader.ts'

export type ListItem = Extract<Block, { k: 'li' }>
export type Drawn = Exclude<Block, { k: 'li' }> | { k: 'list'; items: ListItem[] }

/** Consecutive list lines become one list. Everything else stays as it is. Unknown blocks are dropped. */
export function groupBlocks(blocks: Block[]): Drawn[] {
  const out: Drawn[] = []
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== 'object') continue
    if (b.k === 'li') {
      const last = out[out.length - 1]
      if (last && last.k === 'list') last.items.push(b)
      else out.push({ k: 'list', items: [b] })
      continue
    }
    if (b.k === 'h' || b.k === 'p' || b.k === 'quote' || b.k === 'pre' || b.k === 'img' || b.k === 'table' || b.k === 'form' || b.k === 'facts' || b.k === 'hr') out.push(b)
  }
  return out
}

/** The marker in front of a list line: "-" style bullets or the number the page gave it. */
export function listMarker(item: ListItem): string {
  return item.ordered ? `${Math.max(1, Math.round(Number(item.index) || 1))}.` : '•'
}

export function listIndent(item: ListItem): number {
  return Math.min(4, Math.max(0, Math.round(Number(item.depth) || 0)))
}

/** A web address to open from a link on a page: only web addresses. Left-clicks open in the same tab; other clicks are left to the device. */
export function isPlainClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}
