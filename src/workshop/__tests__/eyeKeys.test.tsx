/**
 * eyeKeys.test.tsx - SET EYE on a mounted bench (avatar eye, UI A): the keys
 * by keydown on the bench's own handler (E toggles with nothing held, never
 * while FACE has corners picked, still turns what SELECT holds; the move
 * keys step the eye), WHAT YOU SEE unmounted while folded and drawn from
 * WALK's own optics, and the frame end to end: the eye the bench draws is
 * the eye WALK looks from, Z included.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera } from 'three'

const camera = new PerspectiveCamera(50, 375 / 812, 0.1, 1000)
camera.position.set(10, 9, 12)
camera.lookAt(0, 0, 0)
camera.updateMatrixWorld()

// Only the canvas is stood in for: the bench's keys read the camera, the picture's canvas draws nothing here.
vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: () => undefined,
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {}, invalidate: () => undefined, controls: null, camera, size: { width: 375, height: 812 } }),
  Canvas: (props: { camera?: { fov?: number; near?: number } }) => <div className="r3f-canvas" data-fov={props.camera?.fov} data-near={props.camera?.near} />,
}))

const { createElement } = await import('react')
const { mount } = await import('../../test/elementRoot')
const { Keys } = await import('../Bench')
const { EyePreview, eyeBenchInset, previewSize } = await import('../EyePreview')
const { useWorkshop } = await import('../../store/useWorkshop')
const { newShard, toRender, TICKS_PER_UNIT } = await import('sno-core/shards')
const { benchEye, walkEyeLocal, withEye } = await import('../../lib/avatarEye')
const { avatarScale } = await import('../../lib/avatar')
const { CAMERA_NEAR, FOV } = await import('../../scene/camera')

/** A shard one unit across, its automatic eye 105 ticks up. */
function cube() {
  return {
    ...newShard('Cube'),
    vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]].map((p) => ({ p: p as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
    faces: [[0, 1, 2], [0, 2, 3]] as Array<[number, number, number]>,
  }
}

/** The window's keydown listeners, called as a key press would. */
const listeners = new Set<(e: unknown) => void>()
const press = (code: string): void => {
  const e = { code, key: code, target: null, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault: () => {} }
  for (const f of [...listeners]) f(e)
}

beforeEach(() => {
  listeners.clear()
  vi.stubGlobal('window', { addEventListener: (t: string, f: (e: unknown) => void) => { if (t === 'keydown') listeners.add(f) }, removeEventListener: (t: string, f: (e: unknown) => void) => { if (t === 'keydown') listeners.delete(f) }, innerWidth: 375, innerHeight: 812 })
  const s = cube()
  useWorkshop.setState({ open: true, shards: [s], currentId: s.id, tool: 'view', selection: [], partSel: [], selectedFaces: [], facePick: [], past: [], future: [], eyeEdit: false, division: 1, notice: null })
})
afterEach(() => {
  useWorkshop.setState({ open: false, eyeEdit: false })
  vi.unstubAllGlobals()
})

describe('the bench\'s keys and SET EYE', () => {
  it('E takes the eye up and puts it down with nothing held', async () => {
    const m = await mount(createElement(Keys))
    press('KeyE')
    expect(useWorkshop.getState().eyeEdit).toBe(true)
    press('KeyE')
    expect(useWorkshop.getState().eyeEdit).toBe(false)
    await m.unmount()
  })

  it('E does nothing while FACE has corners picked, and still turns what SELECT holds', async () => {
    const m = await mount(createElement(Keys))
    useWorkshop.setState({ tool: 'face', facePick: [0, 1] })
    press('KeyE')
    expect(useWorkshop.getState().eyeEdit).toBe(false)
    useWorkshop.setState({ tool: 'select', facePick: [], selection: [0, 1] })
    const before = useWorkshop.getState().current()
    press('KeyE')
    expect(useWorkshop.getState().eyeEdit).toBe(false)
    expect(useWorkshop.getState().current()).not.toBe(before)
    await m.unmount()
  })

  it('the move keys step the eye a grid step, in any tool, LOOK included', async () => {
    const m = await mount(createElement(Keys))
    useWorkshop.getState().setEyeEdit(true)
    // W is up on screen: +Y, from AUTO's 105 to the grid's 120.
    press('KeyW')
    expect(useWorkshop.getState().current()!.extra?.eye).toEqual([0, 120, 0])
    press('ArrowUp')
    expect(useWorkshop.getState().current()!.extra?.eye).toEqual([0, 240, 0])
    // Nothing held moved: the eye is what the keys hold.
    expect(useWorkshop.getState().current()!.vertices.map((v) => v.p)).toEqual(cube().vertices.map((v) => v.p))
    await m.unmount()
  })
})

describe('WHAT YOU SEE', () => {
  it('draws with WALK\'s field of view and near plane, upright as the phone is, and is gone while folded', async () => {
    useWorkshop.getState().setEyeEdit(true)
    const m = await mount(createElement(EyePreview))
    const canvas = (): Array<{ props: Record<string, unknown> }> => m.all().filter((h) => h.props.className === 'r3f-canvas')
    expect(canvas()).toHaveLength(1)
    expect(canvas()[0].props['data-fov']).toBe(FOV)
    expect(canvas()[0].props['data-near']).toBe(CAMERA_NEAR)
    const pic = m.all().find((h) => h.props.className === 'ws__eyeview-pic')!
    const style = pic.props.style as { width: number; height: number }
    expect(style.height).toBeGreaterThan(style.width)
    // The fold and the zoom are buttons beside the canvas, never around it.
    expect(m.all().filter((h) => h.type === 'button').every((b) => !b.children.some((c) => typeof c !== 'string' && c.props.className === 'r3f-canvas'))).toBe(true)
    await m.press('WHAT YOU SEE')
    expect(canvas()).toHaveLength(0)
    await m.press('WHAT YOU SEE')
    expect(canvas()).toHaveLength(1)
    await m.unmount()
  })

  it('gives the bench one right inset for the whole of SET EYE: the small picture, whatever the picture is doing', () => {
    // 12px gap, the small picture 90 wide, its 2px frame.
    expect(eyeBenchInset(12, 375, 812)).toBe(12 + previewSize(375, 812, false).width + 2)
    expect(eyeBenchInset(12, 375, 812)).toBe(104)
  })

  it('follows the window: a resize gives a new size', async () => {
    useWorkshop.getState().setEyeEdit(true)
    const resize = new Set<() => void>()
    vi.stubGlobal('window', { addEventListener: (t: string, f: () => void) => { if (t === 'resize') resize.add(f) }, removeEventListener: (t: string, f: () => void) => { if (t === 'resize') resize.delete(f) }, innerWidth: 375, innerHeight: 812 })
    const m = await mount(createElement(EyePreview))
    const pic = (): { width: number; height: number } => m.all().find((h) => h.props.className === 'ws__eyeview-pic')!.props.style as { width: number; height: number }
    expect(pic()).toEqual(previewSize(375, 812, false))
    ;(window as unknown as { innerWidth: number; innerHeight: number }).innerWidth = 1440
    ;(window as unknown as { innerWidth: number; innerHeight: number }).innerHeight = 900
    for (const f of resize) f()
    await new Promise((r) => setTimeout(r, 5))
    expect(pic()).toEqual(previewSize(1440, 900, false))
    await m.unmount()
  })

  it('keeps the screen\'s shape, within a share of its height', () => {
    expect(previewSize(375, 812, false)).toEqual({ width: 90, height: 195 })
    const big = previewSize(375, 812, true)
    expect(big.height / big.width).toBeCloseTo(812 / 375, 1)
    expect(previewSize(1440, 900, false).width).toBeGreaterThan(previewSize(1440, 900, false).height)
  })
})

describe('the frame, end to end', () => {
  it('draws the eye on the bench where WALK looks from, Z included, also after a +Z step', () => {
    const near = (a: number[], b: number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9))
    const check = (s: ReturnType<typeof cube>): void => {
      const k = avatarScale(s)
      near(toRender(benchEye(s)), walkEyeLocal(s, 0, 1).map((g) => g / k))
    }
    useWorkshop.getState().setEye([30, 150, -120])
    const s = useWorkshop.getState().current()!
    expect(benchEye(s)).toEqual([30, 150, 120])
    check(s)
    // One +Z step on the bench: the model's +Z, the payload's -Z, render -Z.
    useWorkshop.getState().moveEye(2, TICKS_PER_UNIT)
    const t = useWorkshop.getState().current()!
    expect(t.extra?.eye).toEqual([30, 150, -240])
    check(t)
    expect(toRender(benchEye(t))[2]).toBeLessThan(toRender(benchEye(s))[2])
    check(withEye(cube(), undefined))
  })
})
