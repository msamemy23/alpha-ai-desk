// A stand-in for next/link, used only when the customer card's parts are drawn under `node --test`.
// It draws a plain link with the same address and words, so a test can read where a row goes.
import React from 'react'

export default function Link({ href, children, ...rest }) {
  return React.createElement('a', { href: typeof href === 'string' ? href : String(href?.pathname ?? ''), ...rest }, children)
}
