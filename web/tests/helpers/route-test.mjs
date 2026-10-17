import { register } from 'node:module'

register('./route-hooks.mjs', import.meta.url)
// Import this file first in a test that calls a Next route handler directly.
