/**
 * tvTerrain.test.ts - TERRAIN on Cyberspace TV, the engine
 * (store/useTvTerrain.ts) and where it is drawn, against a mock canonical
 * relay (throwaway keys; nothing reaches a real relay; no worker in Node, so
 * the blocks jobs run on the page, the same code).
 *
 * - A shot coming is read ahead: its beats flagged TERRAIN, the chunks round
 *   them read.
 * - On screen, a TERRAIN shot draws its avatar's chunk and neighbours (27 at
 *   most) with their meshes; asked again, nothing is meshed twice; off
 *   TERRAIN, nothing is drawn; TV's region keys go when TV ends.
 * - Block shading: the site's /tv lights each chunk by the viewer's Block
 *   shading setting (its light worked out and cached, the chunk drawn once
 *   it is in); the stream never does, and no light job runs there.
 * - The viewer's own field is never drawn during TV: the TV scene does not
 *   mount it, and it stays hidden while TV is on however it is mounted.
 */

import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/relay', () => ({
  CYBERSPACE_RELAY: 'wss://relay.test',
  queryAnyChecked: vi.fn(async () => ({ events: [], trouble: 'not in tests' })),
  query: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
  subscribe: vi.fn(() => () => {}),
}))

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import { chunkKey, type ChunkBase } from '../../lib/terrain/coords'
import { generate } from '../../lib/terrain/generate'
import { LAYER_KIND, encodePlane, layerTags, plaintextJson } from '../../lib/terrain/blockLayer'
import { encryptForRegion } from '../../lib/shardCrypto'
import type { NostrEvent } from '../../lib/events'
import { chunkRegionKeyOf, type TvTerrainDeps } from '../../lib/tv/terrainReader'
import type { Beat, Shot } from '../../lib/tv/director'
import { MAX_DRAWN, readRing, tvRegionKeysHeld, tvTerrainReader, setTvTerrainDeps, startTvTerrain, stopTvTerrain, terrainOn, tvLighting, tvTerrainIdle, tvTerrainLightsKept, tvTerrainMeshesKept, tvTerrainTick, useTvTerrain, type TvTerrainFrame } from '../useTvTerrain'
import { setBroadcastForTest } from '../../lib/tv/broadcast'
import { useLayers } from '../useLayers'
import { LIGHT_BYTES } from '../../lib/terrain/light'
import { fieldVisible } from '../../scene/TerrainLayer'

const BASE: ChunkBase = { x: 0x468ace02468ace024680n, y: 0x13579bdf13579bdf13560n, z: 0x0abcdef0abcdef0abce0n, plane: 0 }
const settle = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function until(ok: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out')
    await settle()
  }
}

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const builder = generateSecretKey()
const builderPk = getPublicKey(builder)

async function surveyLayer(base: ChunkBase, createdAt: number): Promise<NostrEvent> {
  const g = generate(base, null, 2).blocks
  const plane = encodePlane(0, true, g, g, { revision: 2, surveyed: createdAt })
  const { key, lookupId } = chunkRegionKeyOf(base)
  return finalizeEvent({ kind: LAYER_KIND, created_at: createdAt, tags: layerTags({ lookupId, author: pk, encrypted: await encryptForRegion(key, plaintextJson({ planes: [plane], cobuilders: [] })) }), content: '' }, builder) as unknown as NostrEvent
}

function mockDeps(events: NostrEvent[]): { deps: Partial<TvTerrainDeps>; asked: Filter[] } {
  const asked: Filter[] = []
  return {
    asked,
    deps: {
      query: async (f) => {
        asked.push(f)
        const d = (f as { '#d'?: string[] })['#d']
        return events
          .filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (f.until === undefined || e.created_at <= f.until))
          .filter((e) => !d || e.tags.some((t) => t[0] === 'd' && d.includes(t[1])))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, f.limit ?? Infinity)
      },
      keyStatus: async (_a, keys) => new Map(keys.map((k) => [k, k === builderPk ? 'valid' as const : 'void' as const])),
      ground: async (b, r) => generate(b, null, r).blocks,
      verify: (e) => verifyEvent(e as Parameters<typeof verifyEvent>[0]),
      muted: () => new Set(),
      now: () => 1_800_000_000_000,
    },
  }
}

function beat(t: number, from: number, to: number): Beat {
  const p = (dx: number) => ({ x: BASE.x + BigInt(dx), y: BASE.y + 20n, z: BASE.z + 10n })
  return { id: `${t.toString(16)}`.padStart(64, 'c'), pubkey: pk, at: t, action: { type: 'hop', position: p(to), plane: 0 } as unknown as Beat['action'], from: { position: p(from), plane: 0 } }
}

function tripOf(beats: Beat[]): Shot {
  return { id: beats[0].id, kind: 'trip', pubkey: pk, beats, start: beats[0].at, end: beats[beats.length - 1].at, offsets: beats.map((_, i) => 1.2 + i), length: beats.length + 4 }
}

afterEach(() => {
  stopTvTerrain()
  setTvTerrainDeps(null)
  setBroadcastForTest(null)
  useLayers.setState({ blockShading: true })
})

/** A TERRAIN shot over BASE read ahead and put on screen at 1101; resolves once its chunks are drawn and nothing is left to do. */
async function onScreen(): Promise<TvTerrainFrame> {
  const m = mockDeps([await surveyLayer(BASE, 1000), finalizeEvent({ kind: 3333, created_at: 990, tags: [['A', 'hop']], content: '' }, sk) as unknown as NostrEvent])
  setTvTerrainDeps(m.deps)
  startTvTerrain()
  const shot = tripOf([beat(1100, 4, 5), beat(1101, 5, 6)])
  tvTerrainTick({ shot: null, tapeTime: null, avatars: {}, terrain: null }, [shot])
  await until(() => shot.beats.every((b) => b.terrain) && tvTerrainIdle())
  const frame: TvTerrainFrame = { shot, tapeTime: 1101, avatars: { [pk]: { position: shot.beats[1].action.position, plane: 0 } }, terrain: { mode: 'orbit', shot: shot.id } }
  await until(() => { tvTerrainTick(frame, []); return useTvTerrain.getState().drawn.length > 0 && tvTerrainIdle() })
  return frame
}

describe('block lighting: the site\'s /tv lights its blocks, the stream never does', () => {
  it('on the site, with Block shading on, each chunk is drawn with its light, worked out once', async () => {
    setBroadcastForTest(false)
    useLayers.setState({ blockShading: true })
    expect(tvLighting()).toBe(true)
    const frame = await onScreen()
    const d = useTvTerrain.getState().drawn[0]
    expect(d.light).not.toBeNull()
    expect(d.light!.length).toBe(LIGHT_BYTES)
    const kept = tvTerrainLightsKept()
    expect(kept).toBeGreaterThan(0)
    tvTerrainTick({ ...frame, tapeTime: 1100 }, [])
    expect(tvTerrainIdle()).toBe(true)
    expect(tvTerrainLightsKept()).toBe(kept)
  }, 30_000)

  it('on the site, with Block shading off, no light', async () => {
    setBroadcastForTest(false)
    useLayers.setState({ blockShading: false })
    expect(tvLighting()).toBe(false)
    await onScreen()
    expect(useTvTerrain.getState().drawn[0].light).toBeNull()
    expect(tvTerrainLightsKept()).toBe(0)
  }, 30_000)

  it('on the stream, never: no light job runs even with Block shading on', async () => {
    setBroadcastForTest(true)
    useLayers.setState({ blockShading: true })
    expect(tvLighting()).toBe(false)
    await onScreen()
    const d = useTvTerrain.getState().drawn[0]
    expect(d.light).toBeNull()
    expect(d.lightKey).toBeNull()
    expect(tvTerrainLightsKept()).toBe(0)
  }, 30_000)
})

describe('the TV terrain engine', () => {
  it('reads a shot ahead, flags its TERRAIN beats, draws its avatar\'s chunks with meshes, and meshes nothing twice', async () => {
    const m = mockDeps([await surveyLayer(BASE, 1000), finalizeEvent({ kind: 3333, created_at: 990, tags: [['A', 'hop']], content: '' }, sk) as unknown as NostrEvent])
    setTvTerrainDeps(m.deps)
    startTvTerrain()
    const shot = tripOf([beat(1100, 4, 5), beat(1101, 5, 6), beat(1102, 6, 7)])
    const empty: TvTerrainFrame = { shot: null, tapeTime: null, avatars: {}, terrain: null }
    tvTerrainTick(empty, [shot])
    await until(() => shot.beats.every((b) => b.terrain) && tvTerrainIdle())
    // The ring beyond was read for the borders: 125 chunks in batches of 25 at most.
    const layerAsks = m.asked.filter((f) => f.kinds?.[0] === LAYER_KIND)
    expect(layerAsks.length).toBeGreaterThan(1)
    expect(layerAsks.every((f) => ((f as { '#d': string[] })['#d']).length <= 25)).toBe(true)

    const frame: TvTerrainFrame = { shot, tapeTime: 1101, avatars: { [pk]: { position: shot.beats[1].action.position, plane: 0 } }, terrain: { mode: 'orbit', shot: shot.id } }
    expect(terrainOn(frame)).toBe(true)
    await until(() => { tvTerrainTick(frame, []); return useTvTerrain.getState().drawn.length > 0 && tvTerrainIdle() })
    const drawn = useTvTerrain.getState().drawn
    expect(drawn.length).toBeLessThanOrEqual(MAX_DRAWN)
    expect(drawn.map((d) => d.key)).toEqual([chunkKey(BASE)])
    expect(drawn[0].mesh.quads).toBeGreaterThan(0)
    const kept = tvTerrainMeshesKept()
    // Asked again, at another moment with the same blocks: the same mesh, nothing made.
    tvTerrainTick({ ...frame, tapeTime: 1102 }, [])
    expect(tvTerrainIdle()).toBe(true)
    expect(tvTerrainMeshesKept()).toBe(kept)
    expect(useTvTerrain.getState().drawn[0].meshKey).toBe(drawn[0].meshKey)
    // Before the survey on tape: nothing to draw.
    tvTerrainTick({ ...frame, tapeTime: 900 }, [])
    expect(useTvTerrain.getState().drawn).toHaveLength(0)
    // Not a TERRAIN shot: nothing drawn.
    tvTerrainTick({ ...frame, terrain: null }, [])
    expect(useTvTerrain.getState().drawn).toHaveLength(0)
    expect(tvRegionKeysHeld()).toBeGreaterThan(0)
    stopTvTerrain()
    expect(tvRegionKeysHeld()).toBe(0)
  }, 30_000)

  it('reads nothing for a trip of long hops', async () => {
    const m = mockDeps([])
    setTvTerrainDeps(m.deps)
    startTvTerrain()
    const far = tripOf([beat(1100, 0, 4000), beat(1101, 4000, 8000)])
    tvTerrainTick({ shot: null, tapeTime: null, avatars: {}, terrain: null }, [far])
    await settle(50)
    expect(m.asked).toHaveLength(0)
  })

  it('a TERRAIN camera named for another shot is not on', () => {
    const shot = tripOf([beat(1100, 1, 2)])
    expect(terrainOn({ shot, terrain: { mode: 'orbit', shot: 'another' } })).toBe(false)
    expect(terrainOn({ shot: null, terrain: { mode: 'orbit', shot: shot.id } })).toBe(false)
  })
})

describe('what is read round a TERRAIN shot', () => {
  it('on the stream, only the drawn ring and its face neighbours (81); on the site, lit, every neighbour and the rows over the sky (175)', () => {
    expect(readRing(BASE, false)).toHaveLength(81)
    expect(readRing(BASE, true)).toHaveLength(175)
  })

  it('stopping TV mid-read leaves no region key and asks nothing more', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((res) => { release = res })
    let asked = 0
    const m = mockDeps([await surveyLayer(BASE, 1000)])
    setTvTerrainDeps({ ...m.deps, query: async (f) => { asked++; await held; return m.deps.query!(f) } })
    startTvTerrain()
    const reader = tvTerrainReader()!
    tvTerrainTick({ shot: null, tapeTime: null, avatars: {}, terrain: null }, [tripOf([beat(1100, 4, 5)])])
    await settle(10)
    const before = asked
    expect(before).toBeGreaterThan(0)
    stopTvTerrain()
    release()
    await settle(50)
    expect(asked).toBe(before)
    expect(reader.keysHeld()).toBe(0)
    expect(tvRegionKeysHeld()).toBe(0)
  })
})

describe('the viewer\'s own field during TV', () => {
  it('is never drawn while TV is on', () => {
    const s = { plane: 0 }
    expect(fieldVisible(s, 0, 0, false)).toBe(true)
    expect(fieldVisible(s, 0, 0, true)).toBe(false)
    expect(fieldVisible(s, 1, 0, false)).toBe(false)
    expect(fieldVisible(null, 0, 0, false)).toBe(false)
  })

  it('is not mounted in the TV scene, which draws the tape\'s blocks instead', () => {
    const scene = readFileSync('src/scene/Scene.tsx', 'utf8')
    const start = scene.indexOf('if (tv) {')
    expect(start).toBeGreaterThan(0)
    const tvBranch = scene.slice(start, scene.indexOf('\n  }\n', start))
    expect(tvBranch).toContain('<TvLayer')
    expect(tvBranch).not.toContain('<TerrainLayer')
    expect(readFileSync('src/scene/TvLayer.tsx', 'utf8')).toContain('<TvTerrain axes={axes} />')
  })
})

