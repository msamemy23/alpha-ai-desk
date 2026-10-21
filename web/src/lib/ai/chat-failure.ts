/**
 * How a failed turn in Ask Alpha is told apart from an answer.
 *
 * Failed turns are saved as ordinary assistant messages. The prefixes below mark them so the chat can show an
 * error with a Retry button instead of something that looks like an answer, and so the start screen can leave
 * a question that failed out of its "Ask again" suggestions.
 *
 * Pure module: no imports from '@/' so node:test can load it directly.
 */

export const FAILURE_PREFIXES: [RegExp, string][] = [
  [/^AI error:\s*/i, 'Alpha could not answer'],
  [/^Ran into an issue:\s*/i, 'Alpha ran into a problem'],
  [/^Repair lookup failed:\s*/i, 'The repair lookup failed'],
  [/^Image analysis failed:\s*/i, 'Alpha could not read that photo'],
  [/^Desktop action failed:\s*/i, 'The desktop action failed'],
]
// A request the owner stopped is saved as an ordinary assistant message too, so it
// survives in history and shows as "Stopped" with a way to ask again.
export const STOP_PATTERN = /^Stopped by you\.\s*/i
export const ABORT_PATTERN = /AbortError|signal is aborted|user aborted a request|operation was aborted/i

export type FailureKind = 'failed' | 'stopped'

export function describeFailure(content: string): { title: string; detail: string; kind: FailureKind } | null {
  if (STOP_PATTERN.test(content)) return { title: 'You stopped this request', detail: content.replace(STOP_PATTERN, '').trim(), kind: 'stopped' }
  for (const [pattern, title] of FAILURE_PREFIXES) {
    if (pattern.test(content)) {
      const detail = content.replace(pattern, '').replace(/\s*Try again\.\s*$/i, '').replace(/\.{2,}$/, '.').trim()
      // A request cut off by Stop can surface as a raw "aborted" error from deep inside a lookup.
      if (ABORT_PATTERN.test(detail)) return { title: 'You stopped this request', detail: 'Nothing was sent or changed.', kind: 'stopped' }
      return { title, detail, kind: 'failed' }
    }
  }
  return null
}
