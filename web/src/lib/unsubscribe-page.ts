// The small web page a person lands on from an "Unsubscribe" link. Plain HTML with no scripts, so it works in any
// mail app's built-in browser. Pure: given a state it returns the page.

import { escapeHtml } from './marketing-email.ts'

export type UnsubscribeState = 'confirm' | 'done' | 'resubscribed' | 'invalid' | 'error'

export interface UnsubscribeView {
  state: UnsubscribeState
  shopName?: string
  /** Already masked. */
  email?: string
  token?: string
}

const COPY: Record<UnsubscribeState, (v: UnsubscribeView) => { title: string; body: string }> = {
  confirm: v => ({
    title: 'Unsubscribe',
    body: `Stop emails from ${v.shopName || 'this shop'} to ${v.email || 'this address'}?`,
  }),
  done: v => ({
    title: 'You are unsubscribed',
    body: `${v.shopName || 'This shop'} will not email ${v.email || 'this address'} again. If you did this by mistake, you can undo it below.`,
  }),
  resubscribed: v => ({
    title: 'You are back on the list',
    body: `${v.shopName || 'This shop'} may email ${v.email || 'this address'} again. You can unsubscribe from any email.`,
  }),
  invalid: () => ({
    title: 'This link does not work',
    body: 'The link is incomplete or has been changed. Use the unsubscribe link in the email again, or reply to the email and ask to be removed.',
  }),
  error: () => ({
    title: 'We could not finish that',
    body: 'Something went wrong on our side and nothing was changed. Please try again in a minute, or reply to the email and ask to be removed.',
  }),
}

export function unsubscribePage(view: UnsubscribeView): string {
  const { title, body } = COPY[view.state](view)
  const token = escapeHtml(view.token || '')
  const form = (action: string, label: string, primary: boolean) => `
    <form method="post" action="/api/outreach/unsubscribe">
      <input type="hidden" name="t" value="${token}">
      <input type="hidden" name="action" value="${action}">
      <button type="submit" class="${primary ? 'primary' : 'plain'}">${label}</button>
    </form>`
  const actions = view.state === 'confirm' ? form('unsubscribe', 'Unsubscribe', true)
    : view.state === 'done' ? form('resubscribe', 'Undo and keep me subscribed', false)
      : view.state === 'error' && token ? form('unsubscribe', 'Try again', true)
        : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #f5f6f8; --card: #ffffff; --text: #1f2937; --muted: #4b5563; --line: #d1d5db; --accent: #1d4ed8; --accent-text: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f1216; --card: #181c22; --text: #f3f4f6; --muted: #b6bcc6; --line: #2d333b; --accent: #6ea0ff; --accent-text: #0b0f14; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  main { width: 100%; max-width: 440px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 24px; }
  h1 { margin: 0 0 8px; font-size: 1.375rem; line-height: 1.25; }
  p { margin: 0 0 20px; color: var(--muted); }
  button { min-height: 48px; width: 100%; border-radius: 10px; font: inherit; font-weight: 700; cursor: pointer; }
  .primary { border: 0; background: var(--accent); color: var(--accent-text); }
  .plain { border: 1px solid var(--line); background: transparent; color: var(--text); }
  button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(body)}</p>${actions}
</main>
</body>
</html>`
}
