// Lets a test call a Next route handler directly: next/server, sign-in and the database are small stand-ins; everything else is real.
import { resolve as base, load } from './browser-ui-hooks.mjs'

const STUBS = {
  'next/server': new URL('./route-stubs/next-server.mjs', import.meta.url).href,
  '@/lib/api-auth': new URL('./route-stubs/api-auth.mjs', import.meta.url).href,
  '@/lib/supabase': new URL('./route-stubs/supabase.mjs', import.meta.url).href,
}

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true }
  return base(specifier, context, nextResolve)
}
export { load }
