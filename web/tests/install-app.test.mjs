import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
const manifestSrc = read('../src/app/manifest.ts')
const middleware = read('../src/middleware.ts')
const sw = read('../public/sw.js')
const offline = read('../src/app/offline/route.ts')
const layout = read('../src/app/layout.tsx')
const nextConfig = read('../next.config.mjs')
const settings = read('../src/app/(app)/settings/page.tsx')

/** Width and height of a PNG, read from its header. */
function pngSize(rel) {
  const b = readFileSync(new URL(rel, import.meta.url))
  assert.equal(b.subarray(1, 4).toString(), 'PNG', `${rel} is a PNG`)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

test('the icons are real PNGs at the sizes the manifest promises', () => {
  assert.deepEqual(pngSize('../public/icons/icon-192.png'), { w: 192, h: 192 })
  assert.deepEqual(pngSize('../public/icons/icon-512.png'), { w: 512, h: 512 })
  assert.deepEqual(pngSize('../public/icons/maskable-512.png'), { w: 512, h: 512 })
  assert.deepEqual(pngSize('../public/icons/apple-touch-icon.png'), { w: 180, h: 180 })
  for (const src of manifestSrc.matchAll(/src: '(\/icons\/[a-z0-9-]+\.png)'/g)) {
    assert.doesNotThrow(() => pngSize(`../public${src[1]}`), `${src[1]} exists`)
  }
})

test('the manifest opens the app full screen on Today, under its own name', () => {
  assert.match(manifestSrc, /display: 'standalone'/)
  assert.match(manifestSrc, /start_url: '\/dashboard'/)
  assert.match(manifestSrc, /name: 'Alpha Desk'/)
  assert.match(manifestSrc, /purpose: 'maskable'/)
  assert.match(manifestSrc, /sizes: '192x192'/)
  assert.match(manifestSrc, /sizes: '512x512'/)
  // no shop's name, phone or address belongs in a file served to everyone
  assert.doesNotMatch(manifestSrc, /Alpha International|Houston|713/)
})

test('the layout tells phones the app can be added, and registers the offline worker', () => {
  assert.match(layout, /appleWebApp: \{ capable: true, title: 'Alpha Desk'/)
  assert.match(layout, /apple-touch-icon\.png/)
  assert.match(layout, /<InstallBridge \/>/)
})

test('what a phone needs to install is reachable without signing in', () => {
  for (const path of ["'/manifest.webmanifest'", "'/sw.js'", "'/offline'", "'/icons/'"]) {
    assert.ok(middleware.includes(path), `${path} is allowed through`)
  }
})

test('the customer booking page, calendar feed and status link are reachable without signing in', () => {
  assert.match(middleware, /pathname\.startsWith\('\/book\/'\)/)
  assert.match(middleware, /^\s*'\/api\/book',$/m)
  assert.match(middleware, /^\s*'\/api\/status',$/m)
  // and they were not opened by accident to the shop-side routes next to them
  assert.doesNotMatch(middleware, /'\/api\/booking/)
  assert.doesNotMatch(middleware, /'\/api\/jobflow'/)
})

test('the service worker only ever answers page loads, and never stores shop data', () => {
  assert.match(sw, /request\.mode !== 'navigate'\) return/)
  assert.equal((sw.match(/cache\.add\(/g) || []).length, 1, 'exactly one thing is cached')
  assert.match(sw, /cache\.add\(new Request\(OFFLINE_URL/)
  assert.doesNotMatch(sw, /cache\.put|addAll|\/api\//)
})

test('the service worker file is always fetched fresh', () => {
  assert.match(nextConfig, /source: '\/sw\.js'/)
  assert.match(nextConfig, /no-cache, no-store, must-revalidate/)
})

test('the offline screen is one self-contained page with a way back', () => {
  assert.doesNotMatch(offline, /<script|<link |src="/)
  assert.match(offline, /You are offline/)
  assert.match(offline, /href="\/dashboard"/)
  assert.match(offline, /prefers-color-scheme: dark/)
  assert.doesNotMatch(offline, /Alpha International|Houston|713/)
})

test('Settings has an Install on your phone section', () => {
  assert.match(settings, /id: 'install', label: 'Install on your phone'/)
  assert.match(settings, /\{s\.id === 'install' && <InstallSection \/>\}/)
})

test('the Unsubscribe link in a marketing email works for a customer who is not signed in, and opens nothing else', () => {
  assert.match(middleware, /^\s*'\/api\/outreach\/unsubscribe',$/m)
  assert.doesNotMatch(middleware, /'\/api\/outreach'/)
  assert.doesNotMatch(middleware, /'\/api\/outreach\/'/)
  const route = read('../src/app/api/outreach/unsubscribe/route.ts')
  // A mail scanner opening the link must not unsubscribe anyone: only POST does the work, and the signed link names who.
  assert.match(route, /export async function GET[\s\S]*?return page\(\{ state: 'confirm'/)
  assert.doesNotMatch(route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST')), /recordEmailOptOut/)
  assert.match(route, /verifyUnsubscribeToken\(token\)/)
})
