/**
 * The screen a phone shows when a page cannot load for lack of a connection. The service worker keeps one copy of
 * it. It is a single self-contained page (no scripts, no outside files) so it still draws with no connection at all.
 * It holds nothing about any shop. Colours follow the phone's light or dark setting.
 */
export const dynamic = 'force-static'

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>Offline · Alpha Desk</title>
<style>
  :root { --base: #f6f6f3; --chrome: #e2e4df; --text: #1c2025; --text2: #3d444c; --line: #7d847b; --blue: #1c4eaa; --on-blue: #fff; --amber: #f0a202; }
  @media (prefers-color-scheme: dark) { :root { --base: #13161a; --chrome: #1b1f24; --text: #eceef1; --text2: #bcc2c9; --line: #707882; --blue: #80acff; --on-blue: #081226; --amber: #f7b020; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; background: var(--base); color: var(--text); font: 17px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { background: var(--chrome); padding: max(14px, env(safe-area-inset-top)) 20px 14px; display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.25rem; }
  .lamp { width: 12px; height: 12px; border-radius: 50%; background: var(--amber); }
  main { flex: 1; width: 100%; max-width: 32rem; margin: 0 auto; padding: 40px 20px calc(40px + env(safe-area-inset-bottom)); }
  h1 { margin: 0 0 12px; font-size: 1.75rem; line-height: 1.2; }
  p { margin: 0 0 16px; color: var(--text2); }
  a.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 22px; border-radius: 8px; background: var(--blue); color: var(--on-blue); font-weight: 700; text-decoration: none; }
  a.btn:focus-visible { outline: 3px solid var(--text); outline-offset: 3px; }
</style>
</head>
<body>
<header><span class="lamp" aria-hidden="true"></span>Alpha Desk</header>
<main>
  <h1>You are offline</h1>
  <p>Alpha Desk cannot reach the internet right now, so nothing new can load. Anything you typed but had not saved may not have gone through, so check it once you are back online.</p>
  <p>Check that Wi-Fi or mobile data is on, then try again.</p>
  <a class="btn" href="/dashboard">Try again</a>
</main>
</body>
</html>
`

export function GET() {
  return new Response(PAGE, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // The service worker keeps its own copy; the browser should not hold another.
      'cache-control': 'no-cache',
    },
  })
}
