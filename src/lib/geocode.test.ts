import { describe, expect, it } from 'vitest'
import { geocode, parseLatLon } from './geocode'

describe('parseLatLon', () => {
  it('reads the shapes people type, keeping the digits as typed', () => {
    expect(parseLatLon('37.7749, -122.4194')).toEqual({ lat: '37.7749', lon: '-122.4194' })
    expect(parseLatLon('37.7749 -122.4194')).toEqual({ lat: '37.7749', lon: '-122.4194' })
    expect(parseLatLon('37.7749N 122.4194W')).toEqual({ lat: '37.7749', lon: '-122.4194' })
    expect(parseLatLon(' 51.5007°N, 0.1246°W ')).toEqual({ lat: '51.5007', lon: '-0.1246' })
    expect(parseLatLon('-33.8568,151.2153')).toEqual({ lat: '-33.8568', lon: '151.2153' })
  })

  it('refuses what is not a pair on Earth', () => {
    expect(parseLatLon('Moscone Center')).toBeNull()
    expect(parseLatLon('91, 0')).toBeNull()
    expect(parseLatLon('0, 181')).toBeNull()
    expect(parseLatLon('37.7749')).toBeNull()
    expect(parseLatLon('')).toBeNull()
  })
})

describe('geocode', () => {
  it('takes the first match and its own name, and null for none', async () => {
    const ok = (async () => ({ ok: true, status: 200, json: async () => [{ lat: '37.784', lon: '-122.401', name: 'Moscone Center', display_name: 'Moscone Center, Howard Street, San Francisco' }] })) as unknown as typeof fetch
    expect(await geocode('Moscone Center', ok)).toEqual({ lat: '37.784', lon: '-122.401', name: 'Moscone Center' })
    const none = (async () => ({ ok: true, status: 200, json: async () => [] })) as unknown as typeof fetch
    expect(await geocode('nowhere at all', none)).toBeNull()
  })

  it('asks for one result and identifies the text it was given', async () => {
    let url = ''
    const spy = (async (u: string) => { url = u; return { ok: true, status: 200, json: async () => [] } }) as unknown as typeof fetch
    await geocode('Moscone Center', spy)
    expect(url).toContain('limit=1')
    expect(url).toContain('q=Moscone%20Center')
  })
})
