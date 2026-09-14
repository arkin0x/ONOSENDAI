/**
 * geocode.ts - a place typed by hand, as a latitude and longitude.
 *
 * Two shapes are accepted. A pair of numbers is taken as it stands: "37.7749,
 * -122.4194", "37.7749 -122.4194", "37.7749N 122.4194W", degree signs
 * tolerated. Anything else is asked of OpenStreetMap's Nominatim, one request
 * per press of GO TO, which is inside its usage policy for a client like
 * this: the browser identifies the site through the Referer it sends, the
 * rate is human, and nothing is bulk.
 *
 * The digits are kept as typed. They are handed to the canonical mapping as
 * strings, so what you typed is what is converted, not a double's idea of it.
 */

export interface LatLon {
  lat: string
  lon: string
}

const PAIR = /^\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[, ]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i

/** A typed pair of coordinates, or null when the text is not one. */
export function parseLatLon(text: string): LatLon | null {
  const m = PAIR.exec(text)
  if (!m) return null
  let lat = m[1]
  let lon = m[3]
  if (m[2]?.toUpperCase() === 'S' && !lat.startsWith('-')) lat = '-' + lat.replace(/^\+/, '')
  if (m[4]?.toUpperCase() === 'W' && !lon.startsWith('-')) lon = '-' + lon.replace(/^\+/, '')
  const la = Number(lat), lo = Number(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null
  return { lat, lon }
}

export interface Place extends LatLon {
  /** The place's own name, for the focus label. */
  name: string
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

/** The first match Nominatim has for the text, or null. */
export async function geocode(text: string, fetchFn: typeof fetch = fetch): Promise<Place | null> {
  const url = `${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(text.trim())}`
  const res = await fetchFn(url, { headers: { accept: 'application/json', 'accept-language': 'en' } })
  if (!res.ok) throw new Error(`the place service answered ${res.status}`)
  const list = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string; name?: string }>
  const hit = list[0]
  if (!hit || typeof hit.lat !== 'string' || typeof hit.lon !== 'string') return null
  const name = (hit.name && hit.name.length > 0 ? hit.name : (hit.display_name ?? '').split(',')[0]).trim()
  return { lat: hit.lat, lon: hit.lon, name: name || text.trim() }
}
