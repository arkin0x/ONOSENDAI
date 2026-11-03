/**
 * audioSpheres.test.ts: each hidden sound's full-volume sphere in the world
 * (arkinox, 2026-11-01). The radius is the one the ears use (fadeRadius), in
 * scene units at the zoom on screen, about where the note is drawn; only
 * sounds, only on the plane in view, only at the zooms the notes are drawn
 * at, and none with no room for a sphere.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@react-three/fiber', () => ({ useFrame: () => undefined, useThree: () => undefined }))

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { itemCentre, type ViewAxes } from '../../lib/space'
import type { WorldItem } from '../../store/useShards'
import { fadeRadius, sourceLocal } from '../../lib/audioItem'

const FRONT: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
const ORIGIN = { x: 1024n, y: 1024n, z: 1024n }
// Height 4: a 16-gibson region; 3 gibsons into it on every axis.
const AT = { x: 1027n, y: 1027n, z: 1027n }

function sound(key: string, fade: number | undefined, extra: Partial<WorldItem> = {}): WorldItem {
  return { key, type: 'audio', at: AT, plane: 0, height: 4, mine: false, audio: { title: key, ...(fade === undefined ? {} : { fade }) }, ...extra } as unknown as WorldItem
}

describe('the sound spheres', () => {
  it('ring each sound where its note is, with the radius the ears use, in scene units', async () => {
    const { audioSpheres } = await import('../AudioSpheres')
    const auto = fadeRadius(undefined, sourceLocal(AT, 4), 4)
    expect(auto).toBeGreaterThan(0)
    const [a, b] = audioSpheres([sound('auto', undefined), sound('two', 2)], 0, ORIGIN, 0, FRONT)
    // Centred where the note is drawn (itemCentre, as WorldMessages places it).
    expect(a).toEqual({ key: 'auto', centre: itemCentre(AT, ORIGIN, 0, FRONT), radius: auto })
    expect(b.radius).toBe(2)
    // At 2^1 a scene unit is two gibsons: the same sphere is half as many units.
    const [c] = audioSpheres([sound('two', 2)], 0, ORIGIN, 1, FRONT)
    expect(c.radius).toBe(1)
  })

  it('leave out what is not a sound, a sound on the other plane, and one with no room', async () => {
    const { audioSpheres } = await import('../AudioSpheres')
    const note = { ...sound('note', 2), type: 'message', audio: undefined } as unknown as WorldItem
    const other = sound('ideaspace', 2, { plane: 1 } as Partial<WorldItem>)
    const none = sound('zero', 0)
    expect(audioSpheres([note, other, none], 0, ORIGIN, 0, FRONT)).toEqual([])
  })

  it('stand down past the zoom where the notes stop being drawn', async () => {
    const { audioSpheres } = await import('../AudioSpheres')
    expect(audioSpheres([sound('two', 2)], 0, ORIGIN, 2, FRONT)).toEqual([])
  })
})

describe('the spheres the world draws: every sound you can hear (review of #584)', () => {
  const hex = (c: string): string => c.repeat(64)
  const row = (id: string, type: string, body: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    eventId: hex(id), inner: { id: hex(id), pubkey: hex('a'), tags: [], kind: 1, created_at: 5, content: '' }, keyHex: hex('b'), bagId: hex('c'), lookupId: hex('d'),
    author: hex('a'), at: AT, plane: 0, height: 4, createdAt: 5, type, ...body, ...extra,
  })
  const audio = (title: string, autoplay: boolean) => ({ audio: { title, url: 'http://127.0.0.1/a.mp3', mime: 'audio/mpeg', autoplay, loop: true, fade: 2 } })

  it('includes a sound kept in an opened chest, which is heard but not drawn on its own, and leaves out one that never plays', async () => {
    const { worldSpheres } = await import('../AudioSpheres')
    const { useShards } = await import('../../store/useShards')
    const chest = row('5', 'chest', { chest: { name: 'Box', lockPubkey: hex('9'), senderPubkey: hex('8'), requires: '', payload: '' } })
    const inChest = row('6', 'audio', audio('In The Box', true), { chestId: hex('5') })
    const loose = row('7', 'audio', audio('Loose', true))
    const silent = row('8', 'audio', audio('Tap To Play', false))
    useShards.setState({ mine: [], curated: null, discovered: Object.fromEntries([chest, inChest, loose, silent].map((r) => [r.eventId, r])) } as never)
    // The chest's sound is heard, not drawn: the reason spheres follow what is heard.
    expect(useShards.getState().drawnItems().map((w) => w.key)).not.toContain(hex('6'))
    expect(useShards.getState().heardAudio().map((w) => w.key)).toContain(hex('6'))

    const keys = worldSpheres(true, ORIGIN, 0, 0, FRONT).map((s) => s.key).sort()
    expect(keys).toEqual([hex('6'), hex('7')])
    // Still only at the zooms the notes are drawn at, and never with the switch off.
    expect(worldSpheres(true, ORIGIN, 0, 1, FRONT)).toHaveLength(2)
    expect(worldSpheres(true, ORIGIN, 0, 2, FRONT)).toEqual([])
    expect(worldSpheres(false, ORIGIN, 0, 0, FRONT)).toEqual([])
  })
})
