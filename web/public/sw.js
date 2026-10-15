/*
  Alpha Desk service worker.

  It does one job: when a page cannot load because the phone has no connection, show a plain "You are offline"
  screen instead of the browser's error. It never stores or serves shop data. Pages, API answers, customer
  records and photos always come from the network, so nothing can be stale or leak between people sharing a phone.
*/
const SHELL = 'alpha-desk-shell-v1'
const OFFLINE_URL = '/offline'

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL)
      .then(cache => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('alpha-desk-shell-') && key !== SHELL).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  // Only page loads. Everything else (API calls, scripts, images, uploads) goes straight to the network.
  if (request.mode !== 'navigate') return
  event.respondWith(
    fetch(request).catch(async () => {
      const offline = await caches.match(OFFLINE_URL)
      return offline || new Response('You are offline. Check your connection and try again.', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }),
  )
})
