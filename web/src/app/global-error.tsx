'use client'
import { useEffect } from 'react'
import { reportClientError } from '@/lib/report-error'
import { referenceCode } from '@/lib/client-errors'

/**
 * The last safety net: the page frame itself broke, so there is no layout, no menu and none of the app's styles.
 * Next requires this file to draw its own <html> and <body>. It carries a small style block of its own
 * (colours follow the phone's light or dark setting) and uses no outside files, so it can still draw.
 */
const STYLE = `
  :root { --base: #f6f6f3; --chrome: #e2e4df; --card: #ffffff; --text: #1c2025; --text2: #3d444c; --line: #7d847b; --blue: #1c4eaa; --on-blue: #ffffff; --red: #b3261e; }
  @media (prefers-color-scheme: dark) { :root { --base: #13161a; --chrome: #1b1f24; --card: #1b1f24; --text: #eceef1; --text2: #bcc2c9; --line: #707882; --blue: #80acff; --on-blue: #081226; --red: #ff8a80; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; background: var(--base); color: var(--text); font: 17px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { background: var(--chrome); padding: max(14px, env(safe-area-inset-top)) 20px 14px; display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.25rem; }
  .lamp { width: 12px; height: 12px; border-radius: 50%; background: var(--red); }
  main { flex: 1; width: 100%; max-width: 32rem; margin: 0 auto; padding: 40px 20px calc(40px + env(safe-area-inset-bottom)); }
  h1 { margin: 0 0 12px; font-size: 1.75rem; line-height: 1.2; }
  p { margin: 0 0 16px; color: var(--text2); }
  .ref { font-size: 0.9375rem; }
  .ref b { color: var(--text); }
  .row { display: flex; flex-wrap: wrap; gap: 10px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 22px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--text); font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
  .btn.primary { background: var(--blue); border-color: var(--blue); color: var(--on-blue); }
  .btn:focus-visible { outline: 3px solid var(--text); outline-offset: 3px; }
`

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { reportClientError('app', error, { digest: error.digest }) }, [error])
  const ref = referenceCode(error.digest)
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="light dark" />
        <meta name="robots" content="noindex" />
        <title>Something went wrong · Alpha Desk</title>
        <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      </head>
      <body>
        <header><span className="lamp" aria-hidden="true" />Alpha Desk</header>
        <main role="alert">
          <h1>Alpha Desk ran into a problem</h1>
          <p>The page could not be shown. Anything you already saved is safe. If you were typing something and had not saved it yet, check it after the page loads again.</p>
          <p>Alpha Desk records problems like this so they can be fixed.</p>
          {ref && <p className="ref">Reference: <b>{ref}</b></p>}
          <div className="row">
            <button type="button" className="btn primary" onClick={() => retry()}>Try again</button>
            <a className="btn" href="/dashboard">Go to Today</a>
          </div>
        </main>
      </body>
    </html>
  )
}
