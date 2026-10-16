// Register after browser-ui-render.mjs. Sends "next/link" to a plain stand-in (see next-link-stub.mjs); everything else is left alone.
const STUB = new URL('./next-link-stub.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/link') return { url: STUB, shortCircuit: true }
  return nextResolve(specifier, context)
}
