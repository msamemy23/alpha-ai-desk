// Lets `node --test` load app files that import through the "@/" shortcut.
const SRC = new URL('../../src/', import.meta.url)

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const rest = specifier.slice(2)
    return nextResolve(new URL(/\.[a-z]+$/.test(rest) ? rest : `${rest}.ts`, SRC).href, context)
  }
  return nextResolve(specifier, context)
}
