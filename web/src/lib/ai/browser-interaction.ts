type Control = { tag?: string; text?: string; href?: string }

/** Resolve only an explicit, unambiguous link click against observed controls. */
export function observedLinkClick(request: string, controls: Control[]) {
  if (!/\b(click|follow)\b/i.test(request) || /\b(do not|don't|never)\s+(?:\w+\s+)?(?:click|follow)\b/i.test(request)) return null
  const links = controls.filter(control => control.tag === 'a' && control.href && !/^(javascript|data|file):/i.test(control.href))
  const named = links.filter(link => link.text && request.toLowerCase().includes(link.text.trim().toLowerCase()))
  const targets = named.length ? named : /\b(that|the|its)\s+(?:main\s+)?link\b/i.test(request) && links.length === 1 ? links : []
  const unique = [...new Map(targets.map(link => [link.href, link])).values()]
  if (unique.length !== 1) return null
  return { type: 'click', selector: 'a[href=' + JSON.stringify(unique[0].href) + ']' }
}
