import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { LineBasicMaterial, MeshBasicMaterial, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { mount, type Host } from '../../test/elementRoot'

/** Every frame callback mounted, caught so a test can run them against real three objects. */
const frames: Array<(state: unknown) => void> = []
vi.mock('@react-three/fiber', () => ({ useFrame: (cb: (state: unknown) => void) => { frames.push(cb) }, useThree: () => undefined }))
// A label is a host element here, so a test can read what it is handed.
vi.mock('../WorldLabel', async (real) => {
  const { createElement } = await import('react')
  return { ...(await real<object>()), WorldLabel: (props: object) => createElement('worldlabel', props) }
})

// Loaded once, here, not inside a test's time limit: WorldMessages pulls in much of the scene.
import { AudioMark, ENCOMPASS_ORDER, PlacedBox, placedBoxProps, placedBoxSide, setBoxLook } from '../WorldMessages'
import { ItemVanish } from '../ItemVanish'
import { TAG_BLEND, TRANSLUCENT_ORDER } from '../shardFaces'
import { VANISH_MS } from '../../lib/ceremony'
import { useCyberspace } from '../../store/useCyberspace'

/** The host records this renderer makes stand in for three objects: give one what a frame writes. */
function asObject(h: Host): Host & { position: Vector3; scale: Vector3; quaternion: Quaternion } {
  return Object.assign(h, { position: new Vector3(), scale: new Vector3(1, 1, 1), quaternion: new Quaternion() })
}

describe('the box of a held item and of a sound', () => {
  const source = readFileSync(new URL('../WorldMessages.tsx', import.meta.url), 'utf8')

  it('is half a gibson at every scale: a scene unit is 2^scaleExp gibsons', async () => {
    expect(placedBoxSide(0)).toBe(0.5)
    expect(placedBoxSide(3) * 2 ** 3).toBe(0.5)
    expect(placedBoxSide(10) * 2 ** 10).toBe(0.5)
  })

  it('draws round an item you made and hold, at half, and for a sound, and is not sized to the screen', () => {
    // The fixed box while a held item's model loads or when it has none; a
    // held item you made with its model drawn has the model's own box (heldItems.test).
    expect(source).toMatch(/\{box === 'placed' && <PlacedBox at=\{at\} opacity=\{HELD_OPACITY\} appear=\{appear\} \/>\}/)
    expect(source).toMatch(/encompass=\{box === 'model' \? \(s\) => <PlacedBox at=\{s\.centre\} size=\{s\.size\} opacity=\{HELD_OPACITY\} appear=\{appear\} \/> : undefined\}/)
    expect(source).toMatch(/<PlacedBox at=\{at\} opacity=\{opacity\} \/>\s*<AudioNote/)
    const body = source.slice(source.indexOf('function PlacedBox'), source.indexOf('The line color and opacity'))
    // Its size is the world's, never the screen's: its one frame is TAKE's fade, which sizes nothing.
    expect(body).not.toMatch(/perPixel|markRecede|state\.size|scale\.set/)
  })

  it('is opaque and out of the bloom: its faces and edges write depth and the tag (white and vanishing, 2026-11-01)', async () => {
    const props = placedBoxProps(1)
    expect(props).toMatchObject({ transparent: true, opacity: 1, forceSinglePass: true, ...TAG_BLEND })
    expect(props.depthWrite).not.toBe(false)
  })

  it('draws its faces, its edges and a sound’s note with those props, the faces under the edges', async () => {
    const m = await mount(createElement(AudioMark, { title: 'Rain Loop', at: [1, 2, 3] }))
    const want = placedBoxProps(1)
    const faces = m.all().filter((h) => h.type === 'meshBasicMaterial')
    const edges = m.all().filter((h) => h.type === 'lineBasicMaterial')
    // The box's fill, and the note's head, stem and flag.
    expect(faces).toHaveLength(4)
    expect(edges).toHaveLength(1)
    for (const h of [...faces, ...edges]) expect(h.props).toMatchObject(want)
    expect(faces.filter((h) => h.props.polygonOffset === true)).toHaveLength(1)
    await m.unmount()
  })

  it('stands a sound’s note outside the box, toward the camera, from any side', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    const at: [number, number, number] = [1, 2, 3]
    frames.length = 0
    const m = await mount(createElement(AudioMark, { title: 'Rain Loop', at }))
    // The note is the group of three flat shapes: head, stem and flag.
    const note = m.all().find((h) => h.type === 'group' && h.children.filter((c) => typeof c !== 'string' && c.type === 'mesh').length === 3)!
    const g = asObject(note)
    const side = placedBoxSide(0)
    const centre = new Vector3(...at)
    for (const eye of [[1, 2, 20], [-9, 8, -4], [14, -3, 3], [1, 30, 3]] as const) {
      const camera = new PerspectiveCamera(50, 1, 0.1, 6000)
      camera.position.set(eye[0], eye[1], eye[2])
      for (const frame of frames) frame({ camera, size: { width: 600, height: 600 } })
      const off = g.position.clone().sub(centre)
      // Past the farthest corner of the box (half its diagonal), so its faces never cover it.
      expect(off.length()).toBeGreaterThan((side * Math.sqrt(3)) / 2)
      expect(off.length()).toBeLessThan(side)
      // On the camera's side, straight toward it.
      const toward = camera.position.clone().sub(centre).normalize()
      expect(off.normalize().dot(toward)).toBeCloseTo(1, 9)
    }
    await m.unmount()
  })
})

describe('the box under TAKE', () => {
  const at: [number, number, number] = [0, 0, 0]

  it('fades in as the item fades out: see-through and writing no depth until the fade ends, then the solid tagged box', async () => {
    let now = 1000
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    frames.length = 0
    const m = await mount(createElement(PlacedBox, { at, appear: { at: 1000, calm: false } }))
    const fillHost = m.all().find((h) => h.type === 'mesh')!
    const edgeHost = m.all().find((h) => h.type === 'lineSegments')!
    // Its first frame: not there yet, and out of the way of what is fading inside it.
    const first = m.all().find((h) => h.type === 'meshBasicMaterial')!.props
    expect(first.opacity).toBe(0)
    expect(first.depthWrite).toBe(false)
    expect(fillHost.props.renderOrder).toBe(TRANSLUCENT_ORDER)
    // Frames from here: real materials on the records, as three's would be.
    const fill = Object.assign(fillHost, { material: new MeshBasicMaterial(placedBoxProps(0)), renderOrder: TRANSLUCENT_ORDER })
    const edges = Object.assign(edgeHost, { material: new LineBasicMaterial(placedBoxProps(0)), renderOrder: TRANSLUCENT_ORDER })
    const run = (): void => { for (const frame of frames) frame({}) }

    now = 1000 + VANISH_MS / 2
    run()
    for (const o of [fill, edges]) {
      expect(o.material.opacity).toBeCloseTo(0.5, 9)
      expect(o.material.depthWrite).toBe(false)
      expect(o.renderOrder).toBe(TRANSLUCENT_ORDER)
      // The see-through blend keeps the tag under it (blendDstAlpha One).
      expect(o.material.blendDstAlpha).not.toBe(TAG_BLEND.blendDstAlpha)
    }

    now = 1000 + VANISH_MS
    run()
    for (const o of [fill, edges]) {
      expect(o.material).toMatchObject({ opacity: 1, depthWrite: true, ...TAG_BLEND })
      expect(o.renderOrder).toBe(0)
    }
    clock.mockRestore()
    await m.unmount()
  })

  it('an item with no model has its fading name lifted clear above the box', async () => {
    const clear = { trueSide: 0.5, minPx: 0 }
    const label = { text: '⚷ Silver Key', color: '#fff', sub: 'by someone', subColor: '#fff' }
    const axes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } } as const
    const m = await mount(createElement(ItemVanish, { id: 'k', label, at, region: null, axes, minPx: 24, play: { at: 0, calm: true }, clear }))
    const words = m.all().filter((h) => h.type === 'worldlabel')
    expect(words).toHaveLength(1)
    expect(words[0].props.clear).toBe(clear)
    await m.unmount()
  })

  it('is handed TAKE and its clear by the world’s items', () => {
    const source = readFileSync(new URL('../WorldMessages.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/<HeldItemMark id=\{w\.key\} own=\{draw === 'own'\} [^\n]*appear=\{play\} \/>/)
    expect(source).toMatch(/\{draw !== 'item' && play && <ItemVanish /)
    expect(source).toMatch(/<ItemVanish [^\n]*clear=\{\{ trueSide: placedBoxSide\(scaleExp\), minPx: 0 \}\}/)
  })
})

describe('the box at half (a held item you made, arkinox 2026-11-06)', () => {
  it('fades in under TAKE only up to its half, see-through and drawn after the opaque faces, never solid', async () => {
    let now = 1000
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    frames.length = 0
    const m = await mount(createElement(PlacedBox, { at: [0, 0, 0], opacity: 0.5, appear: { at: 1000, calm: false } }))
    const fill = Object.assign(m.all().find((h) => h.type === 'mesh')!, { material: new MeshBasicMaterial(placedBoxProps(0)), renderOrder: TRANSLUCENT_ORDER })
    const edges = Object.assign(m.all().find((h) => h.type === 'lineSegments')!, { material: new LineBasicMaterial(placedBoxProps(0)), renderOrder: TRANSLUCENT_ORDER })
    now = 1000 + VANISH_MS * 2
    for (const frame of frames) frame({})
    for (const o of [fill, edges]) {
      expect(o.material.opacity).toBeCloseTo(0.5, 9)
      expect(o.material.depthWrite).toBe(false)
      expect(o.renderOrder).toBe(TRANSLUCENT_ORDER)
    }
    clock.mockRestore()
    await m.unmount()
  })

  it('with a size, is that size in its parent\u2019s frame instead of the fixed side (the model\u2019s own box, 2026-11-08)', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    const sized = await mount(createElement(PlacedBox, { at: [0, 0.1, 0], opacity: 0.5, size: [2, 1.5, 0.75] }))
    expect(sized.all().find((h) => h.type === 'group')!.props).toMatchObject({ position: [0, 0.1, 0], scale: [2, 1.5, 0.75] })
    await sized.unmount()
    const fixed = await mount(createElement(PlacedBox, { at: [0, 0, 0], opacity: 0.5 }))
    expect(fixed.all().find((h) => h.type === 'group')!.props.scale).toBe(placedBoxSide(0))
    await fixed.unmount()
  })

  it('still, it draws after the opaque faces, so a room sorted nearer cannot paint over it', async () => {
    const m = await mount(createElement(PlacedBox, { at: [0, 0, 0], opacity: 0.5 }))
    expect(m.all().find((h) => h.type === 'mesh')!.props.renderOrder).toBe(TRANSLUCENT_ORDER)
    await m.unmount()
  })

  it('sized round a model, it draws after the model at half, still and through TAKE; the fixed box keeps its order (review of #617)', async () => {
    const order = (m: Awaited<ReturnType<typeof mount>>): unknown[] => m.all().filter((h) => h.type === 'mesh' || h.type === 'lineSegments').map((h) => h.props.renderOrder)
    const sized = await mount(createElement(PlacedBox, { at: [0, 0, 0], opacity: 0.5, size: [1, 4, 1] }))
    expect(order(sized)).toEqual([ENCOMPASS_ORDER, ENCOMPASS_ORDER])
    await sized.unmount()
    const fixed = await mount(createElement(PlacedBox, { at: [0, 0, 0], opacity: 0.5 }))
    expect(order(fixed)).toEqual([TRANSLUCENT_ORDER, TRANSLUCENT_ORDER])
    await fixed.unmount()
    // setBoxLook: see-through at the order handed it, TRANSLUCENT_ORDER by default, solid at 0.
    const o = { renderOrder: 0 }
    setBoxLook(new MeshBasicMaterial(), o, 0.25, ENCOMPASS_ORDER)
    expect(o.renderOrder).toBe(ENCOMPASS_ORDER)
    setBoxLook(new MeshBasicMaterial(), o, 0.25)
    expect(o.renderOrder).toBe(TRANSLUCENT_ORDER)
    setBoxLook(new MeshBasicMaterial(), o, 1, ENCOMPASS_ORDER)
    expect(o.renderOrder).toBe(0)
  })
})
