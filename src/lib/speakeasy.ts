/**
 * speakeasy.ts - the speakeasies your chain head stands in (speakeasy step 7,
 * relay-speakeasies design, 2026-11-04).
 *
 * A speakeasy is a paid, location-gated relay on the canonical relay's host:
 * wss://relay.onosendai.tech/<region> or /<name>. Only an AUTHed pubkey whose
 * valid chain head is inside the region may read or write there. The region
 * is exactly the /C/ prefix form (coordRoute.ts, ruling D7): every coordinate
 * whose 64 hex start with it, in both planes.
 *
 * The relay says which speakeasies hold a coordinate:
 * GET <https base>/.well-known/cyberspace-speakeasies?coord=<64 hex> answers
 * 200 with {"speakeasies":[{region, name, url, created_at}]}, longest prefix
 * first, and 400 for a bad coord.
 *
 * Asked only when the head moves into another cell of CACHE_PREFIX_HEX, never
 * per frame: a change of coordinate waits DEBOUNCE_MS for the head to settle,
 * and each cell's answer is kept for a while. A failure shows nothing and says
 * nothing.
 */

import { DEFAULT_RELAY, normalizeRelay } from '../store/useRelays'

/** One speakeasy as the relay lists it. */
export interface Speakeasy {
  /** The region, normalized: 1 to 64 lowercase hex, a prefix of the coordinate asked. */
  region: string
  /** The name bought for it, or null. */
  name: string | null
  /** The relay address, wss:// on the relay's own host. */
  url: string
  created_at: number
}

/**
 * How many leading hex characters name a cached cell: 33, a cube whose side
 * is 2^41 gibsons (256 m at 2^33 to the meter). A move inside one cell asks
 * nothing; a move into another asks again. A speakeasy smaller than a cell
 * that you walk into without leaving the cell is seen when the cell's answer
 * expires. One you walk out of is dropped at once (inRegion).
 */
export const CACHE_PREFIX_HEX = 33
/** How long the head must stay in a new cell before it is asked about. */
export const DEBOUNCE_MS = 2000
/** How long a cell's answer is kept. */
export const ANSWER_TTL_MS = 10 * 60_000
/** How long a failed ask counts as "none here" before the cell is asked again. */
export const FAILURE_TTL_MS = 60_000
/** Cells kept at once; the oldest goes first. */
const MAX_CELLS = 64

const COORD = /^[0-9a-f]{64}$/
const REGION = /^[0-9a-f]{1,64}$/

/** The relay's web address, from DEFAULT_RELAY: wss://host becomes https://host. */
export function speakeasyBase(relay: string = DEFAULT_RELAY): string {
  return relay.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '')
}

/** The discovery URL for one coordinate. */
export function lookupUrl(coord: string, base: string = speakeasyBase()): string {
  return `${base}/.well-known/cyberspace-speakeasies?coord=${coord}`
}

/** The region's page on the relay, in a browser. */
export function dashboardUrl(region: string, base: string = speakeasyBase()): string {
  return `${base}/${region}`
}

/** What a speakeasy is called on screen: its name, or its region shortened. */
export function speakeasyLabel(s: Speakeasy): string {
  if (s.name) return s.name
  return s.region.length > 12 ? `${s.region.slice(0, 6)}…${s.region.slice(-4)}` : s.region
}

/** Whether the coordinate is inside the speakeasy's region. */
export function inRegion(s: Speakeasy, coord: string): boolean {
  return coord.startsWith(s.region)
}

/**
 * The relay's answer, read strictly: null when it is not the contract's shape
 * at all, else the entries that hold up, longest region first. An entry is
 * dropped when its region is not hex, is not a prefix of `coord`, or its url
 * is not a wss:// address on the relay's own host (`base`): a press of ADD
 * RELAY adds exactly that url, so it must be the relay's.
 */
export function parseSpeakeasies(body: unknown, coord: string, base: string = speakeasyBase()): Speakeasy[] | null {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { speakeasies?: unknown }).speakeasies)) return null
  let host: string
  try { host = new URL(base).host } catch { return null }
  const out: Speakeasy[] = []
  for (const raw of (body as { speakeasies: unknown[] }).speakeasies) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    if (typeof e.region !== 'string' || !REGION.test(e.region) || !coord.startsWith(e.region)) continue
    if (e.name !== null && e.name !== undefined && typeof e.name !== 'string') continue
    if (typeof e.created_at !== 'number' || !Number.isFinite(e.created_at)) continue
    if (typeof e.url !== 'string' || !/^wss:\/\//i.test(e.url)) continue
    const url = normalizeRelay(e.url)
    if (!url) continue
    try { if (new URL(url).host !== host) continue } catch { continue }
    const name = typeof e.name === 'string' && e.name.trim() ? e.name.trim() : null
    out.push({ region: e.region, name, url, created_at: e.created_at })
  }
  return out.sort((a, b) => b.region.length - a.region.length)
}

/** Ask the relay about one coordinate. Null on any failure: no answer, a 400, a bad payload. */
export async function fetchSpeakeasies(coord: string, fetchFn: typeof fetch, base: string = speakeasyBase(), signal?: AbortSignal): Promise<Speakeasy[] | null> {
  try {
    const res = await fetchFn(lookupUrl(coord, base), { headers: { accept: 'application/json' }, signal })
    if (res.status !== 200) return null
    return parseSpeakeasies(await res.json(), coord, base)
  } catch {
    return null
  }
}

export interface SpeakeasyLookupOptions {
  fetchFn: typeof fetch
  base?: string
  now?: () => number
  debounceMs?: number
}

export interface SpeakeasyLookup {
  /** The head moved (or is gone: null). Cheap: call it on every change. */
  update: (coord: string | null) => void
  /** The speakeasies the head stands in now, longest region first. */
  current: () => Speakeasy[]
  subscribe: (fn: () => void) => () => void
}

const NONE: Speakeasy[] = []

/**
 * The lookup: a cache per cell and a debounce. What it shows is always
 * filtered to the head as it stands, so leaving a region is seen at once.
 */
export function createSpeakeasyLookup(opts: SpeakeasyLookupOptions): SpeakeasyLookup {
  const now = opts.now ?? Date.now
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS
  const base = (): string => opts.base ?? speakeasyBase()
  const cells = new Map<string, { list: Speakeasy[]; until: number }>()
  const asking = new Set<string>()
  const listeners = new Set<() => void>()
  let coord: string | null = null
  let shown: Speakeasy[] = NONE
  let timer: ReturnType<typeof setTimeout> | null = null

  const show = (list: Speakeasy[]): void => {
    const next = coord ? list.filter((s) => inRegion(s, coord as string)) : NONE
    if (next.length === shown.length && next.every((s, i) => s.url === shown[i].url)) return
    shown = next.length ? next : NONE
    for (const fn of [...listeners]) fn()
  }

  const fresh = (cell: string): Speakeasy[] | null => {
    const hit = cells.get(cell)
    if (!hit) return null
    if (hit.until > now()) return hit.list
    cells.delete(cell)
    return null
  }

  const keep = (cell: string, list: Speakeasy[], ttl: number): void => {
    cells.delete(cell)
    cells.set(cell, { list, until: now() + ttl })
    while (cells.size > MAX_CELLS) cells.delete(cells.keys().next().value as string)
  }

  const ask = (at: string): void => {
    const cell = at.slice(0, CACHE_PREFIX_HEX)
    if (asking.has(cell) || fresh(cell)) return
    asking.add(cell)
    void fetchSpeakeasies(at, opts.fetchFn, base()).then((list) => {
      asking.delete(cell)
      keep(cell, list ?? NONE, list ? ANSWER_TTL_MS : FAILURE_TTL_MS)
      if (coord && coord.slice(0, CACHE_PREFIX_HEX) === cell) show(list ?? NONE)
    })
  }

  return {
    update: (next) => {
      const c = next && COORD.test(next) ? next : null
      if (c === coord) return
      coord = c
      if (timer) { clearTimeout(timer); timer = null }
      if (!c) { show(NONE); return }
      const hit = fresh(c.slice(0, CACHE_PREFIX_HEX))
      if (hit) { show(hit); return }
      // Not asked yet: what was shown stays while it still holds the head.
      show(shown)
      timer = setTimeout(() => { timer = null; if (coord) ask(coord) }, debounceMs)
    },
    current: () => shown,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}
