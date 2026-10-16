import { MAX_REPORTS_PER_PAGE, cleanReport, isNoise, reportKey, type ErrorReport, type ReportKind } from './client-errors'

/**
 * The browser's half of crash reporting. It cuts the report down, skips noise and repeats, and sends at most a few
 * per page load. Failing to send is never shown to anyone and never throws: a report must not cause a second crash.
 */
const sent = new Set<string>()

export function reportClientError(kind: ReportKind, err: unknown, extra?: { digest?: string }): void {
  try {
    if (typeof window === 'undefined') return
    const e = err as { message?: unknown; stack?: unknown; digest?: unknown } | null
    const message = typeof err === 'string' ? err : typeof e?.message === 'string' ? e.message : ''
    if (isNoise(message)) return
    const report: ErrorReport | null = cleanReport({
      kind,
      message,
      stack: e?.stack,
      path: window.location.pathname,
      digest: extra?.digest ?? e?.digest,
    })
    if (!report) return
    const key = reportKey(report)
    if (sent.has(key) || sent.size >= MAX_REPORTS_PER_PAGE) return
    sent.add(key)
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {})
  } catch { /* reporting must never break the page */ }
}
