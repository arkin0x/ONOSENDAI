/**
 * trueSizeAtZoom.test.tsx: a chest, a door, an item's model and a coin keep
 * their size against the blocks around them at every distance and zoom
 * (arkinox, 2026-11-26, BUILD at 2^0 zoomed far out: "doors and chests are
 * not scaling with the view zoom? getting way too big"; coins the same way,
 * owner, 2026-11-27).
 *
 * They were held to the note's old cube on screen, 24.5 CSS pixels, so far
 * off a one-gibson chest stood many times its size beside a one-gibson
 * block; a coin was a 40 pixel diamond at any distance. Here a one-gibson reference block stands beside each, and the
 * camera pulls back from 4 to BUILD's 1280 cells on a phone (375 by 812, FOV
 * 55): what the thing draws, measured against the block, is the same at
 * every distance, and once that is under FAR_DOT_PX on screen the thing is
 * hidden and its dot, never larger than FAR_DOT_PX, stands in its place.
 *
 * Driven through R3F's own frame loop (test/r3fRoot.ts) with real three
 * objects; ShardMesh draws a solid box of the model's bounds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
// A label sized on screen draws nothing here; one that is a size in the world (`side`: the coin's ₿) is a group of that scale, so it can be measured.
vi.mock('../WorldLabel', async (real) => {
  const { createElement } = await import('react')
  return { ...(await real<object>()), WorldLabel: ({ side, at }: { side?: number; at?: [number, number, number] }) => side === undefined ? null : createElement('group', { name: 'glyph', scale: side, position: at }) }
})
vi.mock('../TapTarget', async (real) => ({ ...(await real<object>()), TapTarget: () => null }))
vi.mock('../ShardMesh', async (real) => {
  const { createElement } = await import('react')
  const { flatten } = await import('sno-core/shards')
  const { extentOf } = await import('../../lib/itemModel')
  return {
    ...(await real<object>()),
    ShardMesh: ({ shard }: { shard: import('sno-core/shards').ShardModel }) => {
      const e = extentOf(flatten(shard).positions, null)!
      return createElement('mesh', { position: e.centre, name: 'drawn' }, createElement('boxGeometry', { args: e.half.map((h: number) => 2 * h) }), createElement('meshBasicMaterial'))
    },
  }
})

import { createElement, Fragment, type ReactNode } from 'react'
import { Box3, PerspectiveCamera, ShaderMaterial, Vector3, type BufferGeometry, type Object3D } from 'three'
import { flatten } from 'sno-core/shards'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { builtInLook } from '../../lib/looks'
import { extentOf, trueScale } from '../../lib/itemModel'
import { FAR_DOT_PX, farDotShown, perPixelAt } from '../../lib/markerSize'
import type { ViewAxes } from '../../lib/space'
import { useCyberspace } from '../../store/useCyberspace'
import { LookMark } from '../LookMark'
import { ItemModelMark } from '../ItemModel'
import { CoinMark } from '../WorldMessages'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
const PHONE = { width: 375, height: 812 }
const FOV = 55
/** From a chest at your feet out to BUILD's farthest orbit at 2^0 (buildZoom BUILD_MAX_GIBSONS). */
const DISTANCES = [4, 12, 40, 96, 320, 1280]

let r: R3fRoot

beforeEach(async () => {
  r = await r3fRoot(PHONE)
})

afterEach(async () => {
  await r.unmount()
})

/** Draws `children` and gives the camera a phone's FOV, reaching past BUILD's farthest orbit. */
async function draw(...children: ReactNode[]): Promise<void> {
  await r.render(createElement(Fragment, null, ...children))
  const cam = r.state().camera as PerspectiveCamera
  cam.fov = FOV
  cam.far = 1e5
  cam.updateProjectionMatrix()
}

/** Whether `o` and everything above it is drawn. */
function shown(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false
  return true
}

function named(name: string): Object3D[] {
  const out: Object3D[] = []
  r.state().scene.traverse((o) => { if (o.name === name) out.push(o) })
  return out
}

function longestOf(o: Object3D): number {
  const s = new Box3().expandByObject(o).getSize(new Vector3())
  return Math.max(s.x, s.y, s.z)
}

/**
 * The longest side of what `o` draws in its own frame, at its world scale:
 * the same however it is turned, for a coin's diamond, which tumbles.
 */
function trueLongestOf(o: Object3D): number {
  const g = (o as Object3D & { geometry: BufferGeometry }).geometry
  g.computeBoundingBox()
  const s = g.boundingBox!.getSize(new Vector3())
  return Math.max(s.x, s.y, s.z) * o.getWorldScale(new Vector3()).x
}

/** CSS pixels a length of `side` render units spans `depth` from the camera. */
function px(side: number, depth: number): number {
  return side / perPixelAt(depth, FOV, PHONE.height)
}

/** A one-gibson block at this zoom, beside the thing: the reference everything is measured by. */
function block(scaleExp: number): ReactNode {
  const g = trueScale(0, scaleExp)
  return createElement('mesh', { key: 'block', name: 'block', position: [3 * g, 0, 0] }, createElement('boxGeometry', { args: [g, g, g] }), createElement('meshBasicMaterial'))
}

const treasure = builtInLook('treasure')
const door = builtInLook('door')
const itemShard = builtInLook('treasure').closed
const item = { shard: itemShard, extent: extentOf(flatten(itemShard).positions, null)! }

/** What is measured of each: `thing`, the object it draws (ShardMesh's 'drawn' by default), by `measure`. */
const MARKS: Array<{ name: string; draw: () => ReactNode; thing?: string; measure?: (o: Object3D) => number }> = [
  { name: 'a chest', draw: () => createElement(LookMark, { key: 'm', look: treasure, model: treasure.closed, at: [0, 0, 0], axes: AXES }) },
  { name: 'a door', draw: () => createElement(LookMark, { key: 'm', look: door, model: door.closed, at: [0, 0, 0], axes: AXES }) },
  { name: 'an item wearing a model', draw: () => createElement(ItemModelMark, { key: 'm', id: 'item', model: item, animation: [], at: [0, 0, 0], region: null, axes: AXES }) },
  { name: 'a coin', draw: () => createElement(CoinMark, { key: 'm', id: 'c', kind: 'coin', at: [0, 0, 0], onTap: () => {} }), thing: 'coin-mark', measure: trueLongestOf },
  { name: 'a spent coin', draw: () => createElement(CoinMark, { key: 'm', id: 'c', kind: 'spent', at: [0, 0, 0], onTap: () => {} }), thing: 'coin-mark', measure: trueLongestOf },
]

describe('drawn at its true size against a block at every distance (LookMark, ItemModelMark, CoinMark)', () => {
  for (const mark of MARKS) {
    for (const scaleExp of [0, 1]) {
      it(`${mark.name} at 2^${scaleExp}: the same size against a one-gibson block from 4 to 1280 cells, and a dot no larger than ${FAR_DOT_PX} px once it is too small`, async () => {
        useCyberspace.setState({ scaleExp })
        await draw(block(scaleExp), mark.draw())
        const cam = r.state().camera
        const ratios: number[] = []
        let sawThing = false
        let sawDot = false
        for (const d of DISTANCES) {
          cam.position.set(0, 0, d)
          cam.lookAt(0, 0, 0)
          cam.updateMatrixWorld(true)
          await r.frame()
          await r.frame()
          const [thing] = named(mark.thing ?? 'drawn')
          const [ref] = named('block')
          const [dot] = named('far-dot')
          expect(thing && ref && dot).toBeTruthy()
          const side = (mark.measure ?? longestOf)(thing)
          const gibson = longestOf(ref)
          ratios.push(side / gibson)
          const truePx = px(side, d)
          // Exactly one of the two is drawn: the thing while it is at least FAR_DOT_PX, the dot under that.
          expect(shown(thing)).toBe(!farDotShown(side, perPixelAt(d, FOV, PHONE.height)))
          expect(shown(dot)).toBe(!shown(thing))
          if (shown(thing)) {
            sawThing = true
            expect(truePx).toBeGreaterThanOrEqual(FAR_DOT_PX)
          } else {
            sawDot = true
            expect(truePx).toBeLessThan(FAR_DOT_PX)
            // The dot is FAR_DOT_PX across, floor and ceiling: never the old 24.5 px floor.
            const u = (dot as unknown as { material: ShaderMaterial }).material.uniforms
            expect(u.uMaxPx.value).toBe(FAR_DOT_PX)
            expect(u.uMinPx.value).toBe(FAR_DOT_PX)
          }
        }
        // Its size against the block never changes with the distance: no floor makes it larger far off.
        for (const k of ratios) expect(k).toBeCloseTo(ratios[0], 6)
        expect(sawThing).toBe(true)
        // A one-gibson thing at BUILD's far orbit on a phone is under a pixel or two: a dot by then.
        if (scaleExp === 0) expect(sawDot).toBe(true)
      })
    }
  }

  for (const scaleExp of [0, 1]) {
    it(`a coin at 2^${scaleExp} is one gibson tip to tip, as the block beside it, and its ₿ keeps its share of it and goes with it into the dot`, async () => {
      useCyberspace.setState({ scaleExp })
      await draw(block(scaleExp), MARKS[3].draw())
      const cam = r.state().camera
      const glyphs: number[] = []
      let hidden = false
      for (const d of DISTANCES) {
        cam.position.set(0, 0, d)
        cam.lookAt(0, 0, 0)
        cam.updateMatrixWorld(true)
        await r.frame()
        const [coin] = named('coin-mark')
        const [ref] = named('block')
        const [glyph] = named('glyph')
        expect(trueLongestOf(coin) / longestOf(ref)).toBeCloseTo(1, 6)
        glyphs.push(glyph.getWorldScale(new Vector3()).x / trueLongestOf(coin))
        // The ₿ is part of the coin: drawn with it, hidden with it once the dot stands in.
        expect(shown(glyph)).toBe(shown(coin))
        if (!shown(glyph)) hidden = true
      }
      for (const k of glyphs) expect(k).toBeCloseTo(glyphs[0], 6)
      if (scaleExp === 0) expect(hidden).toBe(true)
    })
  }

  it('the chest at 1280 cells is its true size, not held to the old 24.5 px', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    await draw(block(0), MARKS[0].draw())
    const cam = r.state().camera
    cam.position.set(0, 0, 1280)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true)
    await r.frame()
    const [thing] = named('drawn')
    expect(px(longestOf(thing), 1280)).toBeLessThan(1)
  })
})

describe('farDotShown', () => {
  it('only under FAR_DOT_PX on screen, and never for a thing or a camera that measures nothing', () => {
    expect(farDotShown(1, 1 / 2)).toBe(true)
    expect(farDotShown(1, 1 / FAR_DOT_PX)).toBe(false)
    expect(farDotShown(1, 1 / 10)).toBe(false)
    expect(farDotShown(0, 1)).toBe(false)
    expect(farDotShown(1, 0)).toBe(false)
    expect(farDotShown(Number.NaN, 1)).toBe(false)
  })
})
