/**
 * coordRoute.test.ts - opening /C/<hex>: a full coordinate becomes a free
 * view of the place, a prefix becomes the yellow region and a view framing
 * it, nonsense becomes a toast, and ending the view puts the address back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

import { useCyberspace } from '../useCyberspace'
import { startCoordRoute, useCoordRoute } from '../useCoordRoute'
import { useToast } from '../useToast'
import { coordPlace, prefixRegion } from '../../lib/coordRoute'

const FULL = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9f'

function open(pathname: string) {
  const replaceState = vi.fn()
  const stop = startCoordRoute({ pathname, search: '', hash: '' }, { replaceState })
  return { replaceState, stop }
}

beforeEach(() => {
  useCyberspace.getState().clearFocus()
  useCoordRoute.setState({ region: null, label: null })
  useToast.getState().dismiss()
})

describe('startCoordRoute', () => {
  it('does nothing away from /C/', () => {
    const { replaceState } = open('/')
    expect(useCyberspace.getState().focus).toBeNull()
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('a full coordinate opens a free view there, in its own plane, and the scan follows the anchor', () => {
    const { stop } = open(`/C/${FULL}`)
    const s = useCyberspace.getState()
    const want = coordPlace(FULL)
    expect(s.focus?.position).toEqual(want.position)
    expect(s.focus?.plane).toBe(1)
    expect(s.focus?.drive).toBe(true)
    // useDiscovery scans wherever the anchor is.
    expect(s.anchor).toEqual(want.position)
    expect(s.anchorPlane).toBe(1)
    expect(s.atHead()).toBe(false)
    stop()
  })

  it('a prefix draws its region and frames the middle of it', () => {
    const { stop } = open('/C/f0')
    const r = useCoordRoute.getState().region
    expect(r?.prefix).toBe('f0')
    const want = prefixRegion('f0')
    expect(useCyberspace.getState().focus?.position).toEqual(want.center)
    expect(useCyberspace.getState().scaleExp).toBe(want.maxHeight - 3)
    stop()
  })

  it('nonsense says so and puts the address back', () => {
    const { replaceState } = open('/C/nothex')
    expect(useToast.getState().toast?.label).toBe('Not a coordinate')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
    expect(useCyberspace.getState().focus).toBeNull()
  })

  it('ending the view clears the region and the address', () => {
    const { replaceState } = open('/C/f0')
    useCyberspace.getState().clearFocus()
    expect(useCoordRoute.getState().region).toBeNull()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })
})
