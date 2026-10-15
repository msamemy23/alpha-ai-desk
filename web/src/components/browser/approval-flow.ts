// Pressing Approve or Do not do this on an approval card. One place for the rules, used by both Live view and Ask Alpha:
//  - the server is asked first; nothing happens unless it says yes,
//  - an approval is for one exact action and one try, so a lapsed or answered request is cleared, never retried blindly,
//  - a download is only saved if it is really a PDF, a picture or plain text,
//  - a double tap does nothing the second time.
// The calls are passed in, so this can be tested without a server.
import { checkDownloaded, downloadVerdict, sizeText } from './approval.ts'
import type { PendingApproval } from './live.ts'
import type { FailureInfo } from './failure.ts'

type Result<T> = { ok: true; data: T } | { ok: false; failure: FailureInfo; aborted: boolean }

export interface FlowDeps {
  decide: (id: string, decision: 'approved' | 'denied') => Promise<Result<true>>
  fetchFile: (url: string, approvalId: string) => Promise<Result<{ bytes: Uint8Array; name: string; contentType: string }>>
  /** Hand a checked file to the device. */
  save: (file: { name: string; mime: string; bytes: Uint8Array }) => void
}

export interface FlowIO {
  setPhase: (phase: PendingApproval['phase'], error?: string) => void
  /** The person said no. */
  denied: () => void
  /** The request is over and cannot be used again (ran out of time, already answered, not found). */
  gone: (message: string) => void
  /** Approved: send the same action again with the approval. */
  resend: (p: PendingApproval) => Promise<void> | void
  /** Approved: Alpha may now open the site it asked about. */
  openApproved: (p: PendingApproval) => void
  /** A download was checked and handed to the device. */
  saved: (name: string, size: string) => void
  /** The download could not be saved. The approval is used up, so the card is cleared with this message. */
  fileProblem: (message: string) => void
}

/** True when the failure means the request itself is finished, as opposed to a bad connection that can be tried again. */
export function requestIsOver(f: FailureInfo): boolean {
  return f.status === 404 || f.status === 403 || f.status === 409
}

export async function answerApproval(p: PendingApproval, decision: 'approved' | 'denied', deps: FlowDeps, io: FlowIO): Promise<void> {
  if (p.phase === 'deciding' || p.phase === 'sending') return
  if (decision === 'denied') {
    io.setPhase('deciding')
    // If the "no" does not reach the server, the request still runs out by itself in 10 minutes and nothing was approved.
    await deps.decide(p.approvalId, 'denied').catch(() => null)
    io.denied()
    return
  }
  const kind = p.details.kind
  if (!p.approvalId) {
    io.setPhase('asking', 'This request cannot be approved here. Ask again.')
    return
  }
  if (kind === 'download') {
    const verdict = downloadVerdict(p.details.url)
    if (!verdict.allowed) {
      io.setPhase('asking', verdict.reason)
      return
    }
  }
  if (p.phase !== 'retry') {
    io.setPhase('deciding')
    const said = await deps.decide(p.approvalId, 'approved')
    if (!said.ok) {
      if (said.aborted) return
      if (requestIsOver(said.failure)) io.gone(said.failure.message)
      else io.setPhase('asking', said.failure.message)
      return
    }
  }
  io.setPhase('sending')
  if (kind === 'download') {
    const got = await deps.fetchFile(p.details.url, p.approvalId)
    if (!got.ok) {
      if (got.aborted) return
      // A lost connection never reached the server, so the same approval can be used again. Anything else used it up.
      if (got.failure.offline) io.setPhase('retry', got.failure.message)
      else io.fileProblem(got.failure.message)
      return
    }
    const verdict = checkDownloaded({ name: got.data.name || downloadVerdict(p.details.url).name, bytes: got.data.bytes })
    if (!verdict.ok) {
      io.fileProblem(verdict.message)
      return
    }
    try {
      deps.save({ name: verdict.name, mime: verdict.mime, bytes: got.data.bytes })
    } catch {
      io.fileProblem('Your device would not save the file. Allow downloads for this site and ask again.')
      return
    }
    io.saved(verdict.name, sizeText(got.data.bytes.length))
    return
  }
  if (kind === 'open_site') {
    io.openApproved(p)
    return
  }
  await io.resend(p)
}
