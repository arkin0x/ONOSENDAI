/**
 * keyCube.test.tsx: a key with no model of its own is a real 1-gibson cube
 * in the world, exactly like a message's box (owner, 2026-11-22, after
 * #870). A key that wears a model draws as before; coins and Cyberspace TV's
 * finds keep their screen-sized marks; a held key keeps its half box.
 *
 * Mounted as the scene mounts it (WorldMessages, items from the store) in a
 * real R3F root (test/r3fRoot.ts): real three objects, frames, camera and
 * taps, so sizes are measured in the world, as drawn.
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

const hooks = vi.hoisted(() => ({ model: null as unknown, modelMarks: [] as Array<Record<string, unknown>> }))

vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
// Words are troika's, which fetches a font: a plain group stands in, so the label's own frame still runs.
vi.mock('@react-three/drei', async () => {
  const { createElement: h, forwardRef } = await import('react')
  // Its place is kept, so a credit line sits under its name as drawn.
  return { Text: forwardRef((props: { position?: unknown }, ref) => h('group', { name: 'text', ref, position: props.position })) }
})
// The mint is never asked: a coin here is one not yet spent.
vi.mock('../../hud/useCashu', () => ({ useCashu: () => ({ state: 'unspent' }) }))
vi.mock('../../hooks/useItemModel', () => ({ useItemModel: (ref: unknown) => (ref ? hooks.model : null) }))
// A model, once in hand, is handed to ItemModelMark: a stand-in records what it is given.
vi.mock('../ItemModel', async (real) => ({
  ...(await real<object>()),
  ItemModelMark: (props: Record<string, unknown>) => { hooks.modelMarks.push(props); return null },
}))

import { createElement } from 'react'
import { act } from '@react-three/fiber'
import { Box3, Vector3, type Camera, type Group, type LineSegments, type Material, type Mesh, type Object3D, type PerspectiveCamera } from 'three'
import type { NostrEvent } from '../../lib/events'
import type { KeyItem } from '../../lib/hidden'
import type { ViewAxes } from '../../lib/space'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards, type WorldItem } from '../../store/useShards'
import { ItemMark, keyBoxSide, markFadeLeft, MARK_FADE_MS, noteBoxSide, WorldMessages } from '../WorldMessages'
import { lettersDrawn, LETTER_GIBSONS } from '../LetterField'
import { ItemToken, TOKEN_CORE, TOKEN_OUTLINE } from '../ItemToken'
import { SEE_THROUGH_BLEND } from '../shardFaces'
import { useTakeVanish } from '../../store/useOpenCeremony'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
const HERE = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }
const OTHER = 'b'.repeat(64)
const MODEL = { address: `33331:${'e'.repeat(64)}:key` }
const TOKEN = `cashuBo2FteCJodHRwczovL21pbnQubWluaWJpdHMuY2FzaCIsInVuaXQiOiJzYXQiLCJwcm9v${'A'.repeat(1800)}`

let r: R3fRoot | null = null
afterEach(async () => {
  await r?.unmount()
  r = null
})
beforeEach(() => {
  hooks.model = null
  hooks.modelMarks.length = 0
  // The deploy cleared first: ending one moves the view (the store's BUILD focus), so the view is set after.
  useShards.setState({ pending: null, selectedSecret: null, mine: [], discovered: {}, curated: null } as never)
  useCyberspace.setState({ anchor: HERE, anchorPlane: 0, scaleExp: 0, focus: null })
  useInventory.setState({ owner: useCyberspace.getState().identity.pubkey, items: {}, storage: 'memory' })
  useTakeVanish.setState({ playing: {} })
})

function keyItem(model = false): KeyItem {
  return { name: 'Brass Key', about: '', itemPubkey: 'c'.repeat(64), secretHex: 'd'.repeat(64), ...(model ? { model: MODEL } : {}) }
}

/** A key lying in the world, hidden by someone else, not held. */
function worldKey(id: string, model = false): WorldItem {
  const event = { id, pubkey: OTHER, kind: 3340, created_at: 1, content: '', tags: [], sig: '' } as NostrEvent
  return { key: id, type: 'key', at: HERE, plane: 0, height: 0, mine: false, author: OTHER, keyItem: keyItem(model), event, lineage: id }
}

function worldMessage(id: string, text: string): WorldItem {
  return { key: id, type: 'message', at: HERE, plane: 0, height: 0, mine: false, author: OTHER, text }
}

/** Every object three would draw: it and every parent visible, with a material. */
function drawn(scene: Object3D): Array<Object3D & { material: Material }> {
  const out: Array<Object3D & { material: Material }> = []
  scene.traverse((o) => {
    for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return
    if ((o as { material?: unknown }).material) out.push(o as Object3D & { material: Material })
  })
  return out
}

/** The one line drawing in the scene: the item's mark. */
function markEdges(scene: Object3D): LineSegments {
  const lines = drawn(scene).filter((o) => o.type === 'LineSegments') as unknown as LineSegments[]
  expect(lines).toHaveLength(1)
  return lines[0]
}

/** The mark's box in the world, from its drawn geometry. */
function worldBox(edges: LineSegments): Box3 {
  edges.updateWorldMatrix(true, false)
  return new Box3().setFromObject(edges)
}

/** Its width on screen, CSS pixels, from its eight drawn corners. */
function screenWidth(edges: LineSegments, camera: Camera, width: number): number {
  const b = worldBox(edges)
  const xs: number[] = []
  for (let i = 0; i < 8; i++) {
    const v = new Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera)
    xs.push(((v.x + 1) / 2) * width)
  }
  return Math.max(...xs) - Math.min(...xs)
}

/** The camera `back` units out from the mark's centre (and a little up), looking at it. */
async function lookFrom(root: R3fRoot, centre: Vector3, back: number): Promise<Camera> {
  const camera = root.state().camera
  camera.position.set(centre.x + back * 0.2, centre.y + back * 0.3, centre.z + back)
  camera.lookAt(centre)
  camera.updateMatrixWorld()
  await root.frame()
  return camera
}

async function scene(items: WorldItem[]): Promise<R3fRoot> {
  useShards.setState({ drawnItems: () => items } as never)
  const root = await r3fRoot()
  await root.render(createElement(WorldMessages, { axes: AXES }))
  return root
}

/** The mark's world edge and its screen widths from near to far; a cube's box is checked to be one. */
async function measure(root: R3fRoot, backs: number[], cube = true): Promise<{ edges: number[]; widths: number[]; centre: Vector3 }> {
  const lines = markEdges(root.state().scene)
  const centre = worldBox(lines).getCenter(new Vector3())
  const edges: number[] = []
  const widths: number[] = []
  for (const back of backs) {
    const camera = await lookFrom(root, centre, back)
    const size = worldBox(lines).getSize(new Vector3())
    if (cube) {
      expect(size.x).toBeCloseTo(size.y, 6)
      expect(size.y).toBeCloseTo(size.z, 6)
    }
    edges.push(Math.max(size.x, size.y, size.z))
    widths.push(screenWidth(lines, camera, root.state().size.width))
  }
  return { edges, widths, centre }
}

const BACKS = [2.5, 8, 30, 120]

/** The model-less item's token (ItemToken): its group, its core and its line material. */
function token(root: R3fRoot): { group: Group; core: Mesh; lines: LineSegments } {
  let group: Group | undefined, core: Mesh | undefined, lines: LineSegments | undefined
  root.state().scene.traverse((o) => {
    if (o.name === 'item-token') group = o as Group
    if (o.name === 'item-token-core') core = o as Mesh
    if (o.name === 'item-token-lines') lines = o as LineSegments
  })
  expect(group).toBeDefined()
  return { group: group!, core: core!, lines: lines! }
}

/** The token's width on screen, CSS pixels, from its drawn core's box. */
function tokenScreenWidth(root: R3fRoot, camera: Camera): number {
  const { core } = token(root)
  core.updateWorldMatrix(true, false)
  return screenWidth(core as unknown as LineSegments, camera, root.state().size.width)
}

describe('a key with no model of its own', () => {
  it('is sized one gibson, as a message’s box is; a key that wears a model is not', () => {
    for (const scaleExp of [0, 1, 2, 5]) expect(keyBoxSide(undefined, scaleExp)).toBe(noteBoxSide(scaleExp))
    expect(keyBoxSide({ model: MODEL, animation: [] }, 0)).toBeUndefined()
  })

  it('is a token one gibson across in the world at 2^0 and 2^1, near or far, centred where a message’s letter would be (owner, 2026-11-27)', async () => {
    for (const scaleExp of [0, 1]) {
      useCyberspace.setState({ scaleExp })
      r = await scene([worldKey('1'.repeat(64))])
      await r.frame()
      const { group } = token(r)
      expect(group.scale.x).toBeCloseTo(noteBoxSide(scaleExp), 9)
      const centre = group.position.clone()
      const widths: number[] = []
      for (const back of BACKS) widths.push(tokenScreenWidth(r, await lookFrom(r, centre, back)))
      // Nearer is larger on screen, farther smaller: a thing in the place.
      for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1])
      await r.unmount()

      // A message is a letter (LetterField), one gibson wide, centred where the token is, give or take the token's bob.
      r = await scene([worldMessage('2'.repeat(64), 'hello')])
      await r.frame()
      const [letter] = lettersDrawn()
      expect(letter.width).toBeCloseTo(noteBoxSide(scaleExp) * LETTER_GIBSONS, 9)
      expect(new Vector3(...letter.centre).distanceTo(centre)).toBeLessThan(0.05 * noteBoxSide(scaleExp))
      await r.unmount()
      r = null
    }
  })

  it('is a dark solid core that writes depth, so it reads on a white wall, edged in light that glows, so it reads in the dark; no blue wire cube', async () => {
    r = await scene([worldKey('1'.repeat(64))])
    await r.frame()
    const { core, lines } = token(r)
    const coreMat = core.material as Material & { color: { getHexString: () => string } }
    expect(coreMat.depthWrite).not.toBe(false)
    expect(`#${coreMat.color.getHexString()}`).toBe(TOKEN_CORE)
    expect((lines.material as Material).depthWrite).toBe(false)
    // No one-gibson wire cube left in the scene.
    const cubes = drawn(r.state().scene).filter((o) => o.type === 'LineSegments' && o.name !== 'item-token-lines' && o.name !== 'letter-fold-lines')
    expect(cubes).toEqual([])
  })

  it('follows the scale as it changes, still one gibson', async () => {
    r = await scene([worldKey('1'.repeat(64))])
    await r.frame()
    expect(token(r).group.scale.x).toBeCloseTo(1, 6)
    useCyberspace.setState({ scaleExp: 1 })
    await r.render(createElement(WorldMessages, { axes: AXES }))
    await r.frame()
    expect(token(r).group.scale.x).toBeCloseTo(0.5, 6)
  })

  it('stands its name and who left it just over the token as drawn, clear of its highest point on screen, near or far', async () => {
    r = await scene([worldKey('1'.repeat(64))])
    await r.frame()
    const scene3 = r.state().scene
    const size = r.state().size
    const { group } = token(r)
    const centre = group.position.clone()
    const texts: Object3D[] = []
    scene3.traverse((o) => { if (o.name === 'text') texts.push(o) })
    // The name and, under it, who left it, the same size (subScale 1).
    expect(texts).toHaveLength(2)
    for (const back of [1.5, 2.5, 8, 20, 40]) {
      const camera = await lookFrom(r, centre, back)
      group.updateWorldMatrix(true, false)
      const highest = Math.min(...TOKEN_OUTLINE.map((p) => ((1 - new Vector3(p[0], p[1], p[2]).applyMatrix4(group.matrixWorld).project(camera).y) / 2) * size.height))
      for (const text of texts) {
        const world = text.getWorldPosition(new Vector3())
        const along = -world.clone().applyMatrix4(camera.matrixWorldInverse).z
        const unitPx = (new Vector3().setFromMatrixScale(text.matrixWorld).y * size.height) / (2 * Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360) * along)
        const y = ((1 - world.clone().project(camera).y) / 2) * size.height
        expect(y + unitPx / 2).toBeLessThanOrEqual(highest + 0.5)
      }
    }
  })

  it('resting on the ground, its name and credit line are never behind the ground, from any camera above it', async () => {
    r = await scene([worldKey('1'.repeat(64))])
    const lines = markEdges(r.state().scene)
    const b = worldBox(lines)
    const centre = b.getCenter(new Vector3())
    // The ground, its top face the cube's bottom face, added to the same scene.
    const { Mesh, BoxGeometry, MeshBasicMaterial, Raycaster } = await import('three')
    const ground = new Mesh(new BoxGeometry(400, 0.1, 400), new MeshBasicMaterial())
    ground.position.set(centre.x, b.min.y - 0.05, centre.z)
    r.state().scene.add(ground)
    ground.updateMatrixWorld()
    const texts: Object3D[] = []
    r.state().scene.traverse((o) => { if (o.name === 'text') texts.push(o) })
    for (const [up, back] of [[0.2, 3], [1.5, 1.5], [6, 2], [0.3, 12], [12, 0.5], [20, 30], [2, 60]]) {
      const camera = r.state().camera
      camera.position.set(centre.x, centre.y + up, centre.z + back)
      camera.lookAt(centre)
      camera.updateMatrixWorld()
      await r.frame()
      for (const text of texts) {
        const at = text.getWorldPosition(new Vector3())
        const hit = new Raycaster(camera.position.clone(), at.clone().sub(camera.position).normalize()).intersectObject(ground, false)[0]
        expect(hit === undefined || hit.distance > camera.position.distanceTo(at)).toBe(true)
      }
    }
  })

  it('takes a tap anywhere over the cube up close, and a fingertip’s worth off it far away', async () => {
    const id = '1'.repeat(64)
    r = await scene([worldKey(id)])
    const lines = markEdges(r.state().scene)
    const centre = worldBox(lines).getCenter(new Vector3())
    const camera = r.state().camera
    const tapAt = async (dx: number): Promise<void> => {
      const v = centre.clone().project(camera)
      const { width, height } = r!.state().size
      await r!.tap(((v.x + 1) / 2) * width + dx, ((1 - v.y) / 2) * height)
    }
    // Straight on, 2 units out: the cube is hundreds of pixels across; 150 px off its middle is still on it.
    camera.position.set(centre.x, centre.y, centre.z + 2); camera.lookAt(centre); camera.updateMatrixWorld()
    await r.frame()
    await tapAt(150)
    expect(useShards.getState().selectedSecret).toBe(id)
    useShards.setState({ selectedSecret: null } as never)
    // Far off: a few pixels of cube, and a tap 15 px off it still opens it.
    camera.position.set(centre.x, centre.y, centre.z + 150); camera.lookAt(centre); camera.updateMatrixWorld()
    await r.frame()
    await tapAt(15)
    expect(useShards.getState().selectedSecret).toBe(id)
  })

  it('being moved, keeps its token, faint', async () => {
    const id = '1'.repeat(64)
    const w = worldKey(id)
    r = await scene([w])
    await r.frame()
    const full = (token(r).lines.material as Material).opacity
    // Aiming a deploy brings the view to you (the store's BUILD focus); this view stays where the key is.
    await act(async () => {
      useShards.setState({ pending: { type: 'key', key: w.keyItem, move: { eventId: id } } } as never)
      useCyberspace.setState({ anchor: HERE, anchorPlane: 0, scaleExp: 0 })
    })
    await r.frame()
    expect(token(r).group.scale.x).toBeCloseTo(noteBoxSide(0), 6)
    expect((token(r).lines.material as Material).opacity).toBeLessThan(full)
  })
})

describe('TAKE on a key with no model', () => {
  it('fades the cube out over about 200 ms', () => {
    expect(MARK_FADE_MS).toBe(200)
    expect(markFadeLeft(0)).toBe(1)
    expect(markFadeLeft(100)).toBeCloseTo(0.5, 9)
    expect(markFadeLeft(200)).toBe(0)
    expect(markFadeLeft(5000)).toBe(0)
    expect(markFadeLeft(-5)).toBe(1)
  })

  it('the token fades out where it stood rather than going in one frame; the half box comes in; the name keeps its place', async () => {
    const id = '1'.repeat(64)
    const w = worldKey(id)
    let now = performance.now()
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    try {
      r = await scene([w])
      await r.frame()
      const full = (token(r).lines.material as Material).opacity
      const centre = token(r).group.position.clone()
      await lookFrom(r, centre, 4)
      const nameAt = (): number[] => {
        const ys: number[] = []
        r!.state().scene.traverse((o) => { if (o.name === 'text') ys.push(o.parent!.position.y) })
        return ys
      }
      const nameBefore = nameAt()
      expect(nameBefore.length).toBeGreaterThan(0)

      // TAKE: held, and the vanish begins at this moment (store/useOpenCeremony takeAndVanish).
      const me = useCyberspace.getState().identity.pubkey
      await act(async () => {
        useInventory.setState({ owner: me, items: { [id]: { rowKey: `${me}/${id}`, owner: me, id, type: 'key', name: 'Brass Key', event: w.event as NostrEvent, author: OTHER, verified: true, source: 'found', place: null, from: null, at: 1, key: w.keyItem } }, storage: 'memory' } as never)
        useTakeVanish.getState().begin(me, id, false, now)
      })
      // The first frame: still the whole token, at full, where it stood.
      await r.frame()
      expect(token(r).group.visible).toBe(true)
      expect((token(r).lines.material as Material).opacity).toBeCloseTo(full, 6)
      expect(token(r).group.position.distanceTo(centre)).toBeLessThan(0.05)
      // Over the token as drawn, which turns a hair between frames: where it stood, to a hundredth.
      expect(nameAt()[0]).toBeCloseTo(nameBefore[0], 1)
      // Half way: half as bright.
      now += 100
      await r.frame()
      expect((token(r).lines.material as Material).opacity).toBeCloseTo(full / 2, 6)
      // Past 200 ms: gone. The half box is what marks the place.
      now += 150
      await r.frame()
      expect(token(r).group.visible).toBe(false)
      const half = (drawn(r.state().scene).filter((o) => o.type === 'LineSegments') as unknown as LineSegments[])
        .filter((l) => Math.abs(worldBox(l).getSize(new Vector3()).x - 0.5) < 1e-6)
      expect(half).toHaveLength(1)
    } finally {
      clock.mockRestore()
    }
  })
})

describe('what keeps its look', () => {
  it('a key that wears a model draws its model, as before, and no world cube', async () => {
    hooks.model = { shard: { unit: 0 }, extent: { centre: [0, 0, 0], half: [0.5, 0.25, 0.1], aroundY: 0.5, aroundX: 0.27, radius: 0.57 } }
    r = await scene([worldKey('1'.repeat(64), true)])
    await r.frame()
    expect(hooks.modelMarks.length).toBeGreaterThan(0)
    expect(hooks.modelMarks.at(-1)!).not.toHaveProperty('minPx')
    expect(drawn(r.state().scene).filter((o) => o.type === 'LineSegments')).toHaveLength(0)
  })

  it('a key that wears a model, while it loads or if it never comes, is the token one gibson across, not the blue cube', async () => {
    r = await scene([worldKey('1'.repeat(64), true)])
    await r.frame()
    expect(token(r).group.scale.x).toBeCloseTo(noteBoxSide(0), 9)
    const cubes = drawn(r.state().scene).filter((o) => o.type === 'LineSegments' && o.name !== 'item-token-lines')
    expect(cubes).toEqual([])
  })

  it('fading out under TAKE, the token’s core is see-through, so its opacity takes (the tag blend ignores it)', async () => {
    const id = '1'.repeat(64)
    r = await r3fRoot()
    await r.render(createElement(ItemToken, { id, at: [0, 0, 0], side: 1, colour: '#ffcf6b', fadeOut: performance.now() }))
    const m = token(r).core.material as Material & { blendDst: number }
    expect(m).toMatchObject(SEE_THROUGH_BLEND)
    expect(m.depthWrite).toBe(false)
  })

  it('a coin keeps its screen-sized diamond', async () => {
    r = await scene([worldMessage('3'.repeat(64), TOKEN)])
    const { edges, widths } = await measure(r, BACKS.slice(0, 2), false)
    // It turns, so its outline's width wobbles a little frame to frame; its size on screen holds while it stands three times as far.
    expect(Math.abs(widths[1] - widths[0]) / widths[0]).toBeLessThan(0.05)
    expect(edges[1]).toBeGreaterThan(edges[0] * 2)
  })

  it('a Cyberspace TV find (ItemMark, as TvFinds draws it, no side) keeps its screen-sized cube', async () => {
    r = await r3fRoot()
    await r.render(createElement(ItemMark, { text: '⚷ Brass Key', sub: 'tv', at: [0, 0, 0], axes: AXES }))
    const { edges, widths } = await measure(r, BACKS.slice(0, 2))
    expect(widths[1]).toBeCloseTo(widths[0], 3)
    expect(edges[1]).toBeGreaterThan(edges[0])
  })

  /** Holds `w` in ITEMS. */
  function hold(w: WorldItem): void {
    const me = useCyberspace.getState().identity.pubkey
    useInventory.setState({ owner: me, items: { [w.key]: { rowKey: `${me}/${w.key}`, owner: me, id: w.key, type: 'key', name: 'Brass Key', event: w.event as NostrEvent, author: OTHER, verified: true, source: 'found', place: null, from: null, at: 1, key: w.keyItem } }, storage: 'memory' } as never)
  }

  it('a held key with no model keeps its half box, and its tap stays a fingertip', async () => {
    const w = worldKey('1'.repeat(64))
    hold(w)
    r = await scene([w])
    // The half box (PlacedBox): its faces and edges, half a gibson on a side at 2^0, at half; no one-gibson cube.
    const faces = drawn(r.state().scene).filter((o) => o.type === 'Mesh')
    expect(faces).toHaveLength(1)
    const size = (await measure(r, [10, 40])).edges
    for (const e of size) expect(e).toBeCloseTo(0.5, 6)
    // Up close, 2 units out: a tap 150 px off its middle is past the half box and past a fingertip, and opens nothing.
    const centre = worldBox(markEdges(r.state().scene)).getCenter(new Vector3())
    const camera = r.state().camera
    camera.position.set(centre.x, centre.y, centre.z + 2); camera.lookAt(centre); camera.updateMatrixWorld()
    await r.frame()
    const v = centre.clone().project(camera)
    const { width, height } = r.state().size
    await r.tap(((v.x + 1) / 2) * width + 150, ((1 - v.y) / 2) * height)
    expect(useShards.getState().selectedSecret).toBeNull()
    // On it, it opens.
    await r.tap(((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height)
    expect(useShards.getState().selectedSecret).toBe(w.key)
  })

  it('a held key with no model, being moved, keeps its half box, faint', async () => {
    const id = '1'.repeat(64)
    const w = worldKey(id)
    hold(w)
    r = await scene([w])
    await act(async () => {
      useShards.setState({ pending: { type: 'key', key: w.keyItem, move: { eventId: id } } } as never)
      useCyberspace.setState({ anchor: HERE, anchorPlane: 0, scaleExp: 0 })
    })
    for (const e of (await measure(r, [10])).edges) expect(e).toBeCloseTo(0.5, 6)
  })
})
