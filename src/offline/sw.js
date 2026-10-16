/**
 * sw.js - the service worker that lets ONOSENDAI open with no network.
 *
 * Not bundled: vite.config.ts (offlineShell) reads this file, fills in the
 * two placeholders below and writes it to the build as /sw.js.
 *
 * What it caches: every file of the build (the shell, each lazy chunk and
 * worker, the coastlines, the spawn model, the fonts, the icons), fetched at
 * install, so a panel never opened before still opens on an airplane.
 *
 * How it answers, freshest first, because the app has always been "the
 * deploy you just made, never an old one" (commit ac4e720):
 *
 * | Request | Answer |
 * |---|---|
 * | a page (any navigation: /, /demo, /c/...) | the network, the cached index.html if the network fails or takes over 4 s |
 * | /assets/* (content-hashed, so never changes) | the cache, the network if missing |
 * | any other file of this site | the network, the cache if the network fails or takes over 4 s |
 * | a fallback font for 3D text (FONT_CDN) | the cache, else the network, kept |
 * | another site (relays, GitHub, Blossom, HOSAKA) | not touched: the app handles those itself |
 *
 * The fallback fonts: the 3D text (troika, behind drei's Text) fetches a
 * font from a CDN for any character the world font lacks, and offline that
 * fetch fails and the label is not drawn. Its URLs carry a version and never
 * change, so each one fetched online is kept in FONT_CACHE, which no build
 * deletes, and answers offline.
 *
 * The cache is named by build. A new build's cache fills at install; on
 * activate, caches older than the previous build are deleted, so a page
 * still open on the previous build can load its lazy chunks.
 *
 * Kill switch: revert the feature, and the old index.html snippet
 * unregisters this worker; pages come from the network first, so the revert
 * reaches every browser on its next online visit. /sw.js is served uncached
 * (vercel.json) and registered with updateViaCache 'none', so a fixed worker
 * reaches them on their next visit too.
 */

/* global self, caches, fetch */

const BUILD = '__ONOSENDAI_BUILD__'
const FILES = __ONOSENDAI_FILES__
const PREFIX = 'onosendai-'
const CACHE = PREFIX + BUILD
/** troika-three-text's default data URL (unicode-font-resolver, versioned). */
const FONT_CDN = 'https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@'
/** Outside PREFIX, so the activate step never deletes it. */
const FONT_CACHE = 'onosendai.fonts'
/** How long a page waits for the network before the cached shell answers instead. */
const PAGE_TIMEOUT_MS = 4000

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    try {
      // One file at a time, each a fresh fetch: a file the browser had cached
      // under the old meta no-cache rules must not land here stale. A
      // redirected response is refused, because a browser will not use one
      // to answer a navigation.
      for (const path of FILES) {
        const res = await fetch(path, { cache: 'reload' })
        if (!res.ok || res.redirected) throw new Error(`precache ${path}: ${res.status}`)
        await cache.put(path, res)
      }
    } catch (err) {
      // A half-filled cache would sort as the newest build and push out the
      // one a page is really running (activate below).
      await caches.delete(CACHE)
      throw err
    }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Keep this build's cache and the newest other one (the build a still
    // open page may be running); delete the rest. Build ids start with the
    // build time, so they sort by age.
    const names = (await caches.keys()).filter((n) => n.startsWith(PREFIX) && n !== CACHE).sort()
    for (const n of names.slice(0, -1)) await caches.delete(n)
    await self.clients.claim()
  })())
})

/** The network, with the timeout, else null. */
async function network(request, timeoutMs) {
  const controller = new AbortController()
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    return await fetch(request, { signal: controller.signal, redirect: 'follow' })
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Any cached copy of this path, this build's first. */
async function cached(path) {
  const own = await (await caches.open(CACHE)).match(path, { ignoreSearch: true })
  return own ?? caches.match(path, { ignoreSearch: true })
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (request.url.startsWith(FONT_CDN)) {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE)
      const hit = await cache.match(request.url)
      if (hit) return hit
      const res = await fetch(request)
      if (res.ok) await cache.put(request.url, res.clone())
      return res
    })())
    return
  }
  if (url.origin !== self.location.origin) return
  if (url.pathname === '/sw.js') return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const res = await network(request, PAGE_TIMEOUT_MS)
      if (res && res.ok) return res
      return (await cached('/index.html')) ?? res ?? Response.error()
    })())
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => (await cached(url.pathname)) ?? fetch(request))())
    return
  }

  event.respondWith((async () => {
    const res = await network(request, PAGE_TIMEOUT_MS)
    if (res && res.ok) return res
    return (await cached(url.pathname)) ?? res ?? Response.error()
  })())
})
