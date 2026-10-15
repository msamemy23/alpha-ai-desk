import { register } from 'node:module'

register('./browser-ui-hooks.mjs', import.meta.url)
// Import this file first in a test that draws the Browser screen's React files.
