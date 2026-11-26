/**
 * spatialAudio.test.tsx: the Settings row Spatial Audio (arkinox, 2026-11-22:
 * "It should be off by default, hiding the sound blocks and their spheres").
 * Mounted as the scene mounts them:
 *
 *  - off, the default: no sound's box (WorldMessages AudioMark) and no rings
 *    (AudioSpheres) in the world;
 *  - on: both;
 *  - off, while audio is being placed in BUILD: both, so the new sound goes
 *    in among the ones already there;
 *  - off: every sound still plays (HiddenAudio never reads the switch);
 *  - off, while one sound's card is open or a VIEW of it lasts: that sound
 *    alone, box and rings, gone again when the card closes or the look ends
 *    (arkinox, 2026-11-22: so VIEW lands on something you can see).
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

const frames = vi.hoisted(() => ({ list: [] as Array<(s: unknown) => void> }))
const ears = vi.hoisted(() => ({ started: [] as string[] }))

vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: (fn: (s: unknown) => void) => { frames.list.push(fn) },
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {} }),
}))
vi.mock('../TapTarget', async (real) => {
  const { createElement } = await import('react')
  return { ...(await real<object>()), TapTarget: (props: object) => createElement('taptarget', props) }
})
vi.mock('../WorldLabel', async (real) => {
  const { createElement } = await import('react')
  return { ...(await real<object>()), WorldLabel: (props: object) => createElement('worldlabel', props) }
})
// The world's voices, as HiddenAudio drives them: a listener is there, and a start is recorded.
vi.mock('../../store/useHiddenAudio', () => ({
  audioListener: () => ({}),
  moveListener: () => {},
  placeWorld: () => {},
  setWorldDuck: () => {},
  setWorldGain: () => {},
  startWorld: async (key: string) => { ears.started.push(key) },
  stopWorld: () => {},
  worldFailed: () => false,
  worldPending: () => new Set<string>(),
  worldVoices: () => new Set<string>(),
  // A sound's level ring asks whether it plays (LevelRing): nothing plays here.
  useHiddenAudio: (pick: (s: { entries: Record<string, unknown> }) => unknown) => pick({ entries: {} }),
  cardKey: (k: string) => `card:${k}`,
  worldKey: (k: string) => `world:${k}`,
}))

import { createElement } from 'react'
import type { ViewAxes } from '../../lib/space'
import { mount, settled, type Host, type Mounted } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useLayers } from '../../store/useLayers'
import { useShards } from '../../store/useShards'
import { WorldMessages } from '../WorldMessages'
import { AudioSpheres, NO_SPOT, spatialAudioShown, spotlit } from '../AudioSpheres'
import { HiddenAudio } from '../HiddenAudio'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
const HERE = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }
const hex = (c: string): string => c.repeat(64)

/** A found sound right here, AUTOPLAY on, a loop with a 2-gibson full-volume sphere in a 16-gibson region. */
function sound(id = '7', at = HERE): Record<string, unknown> {
  return {
    eventId: hex(id), inner: { id: hex(id), pubkey: hex('a'), tags: [], kind: 1, created_at: 5, content: '' }, keyHex: hex('b'), bagId: hex('c'), lookupId: hex('d'),
    author: hex('a'), at, plane: 0, height: 4, createdAt: 5, type: 'audio',
    audio: { title: `Rain Loop ${id}`, url: 'http://127.0.0.1/a.mp3', mime: 'audio/mpeg', autoplay: true, loop: true, fade: 2 },
  }
}

/** A second sound three gibsons along, in view: never the one looked at below. */
const NEXT_DOOR = { x: HERE.x + 3n, y: HERE.y, z: HERE.z }

const of = (m: Mounted, type: string): Host[] => m.all().filter((h) => h.type === type)
/** The sound's box: AudioMark's tap target, which only it mounts here. */
const boxes = (m: Mounted): number => of(m, 'taptarget').length
/** The rings: FadeRings' line loops (four to a sphere). */
const rings = (m: Mounted): number => of(m, 'lineLoop').length

async function world(): Promise<Mounted> {
  return mount(createElement('group', null, createElement(WorldMessages, { axes: AXES }), createElement(AudioSpheres, { axes: AXES })))
}

beforeEach(() => {
  frames.list.length = 0
  ears.started.length = 0
  useCyberspace.setState({ anchor: HERE, anchorPlane: 0, scaleExp: 0 })
  const s = sound()
  useShards.setState({ mine: [], curated: null, pending: null, discovered: { [s.eventId as string]: s } } as never)
})

afterEach(() => {
  useLayers.setState({ spatialAudio: false })
  useShards.setState({ pending: null, selectedSecret: null } as never)
  useCyberspace.setState({ focus: null })
})

/** Two sounds in view: this one and NEXT_DOOR's. */
function twoSounds(): void {
  const a = sound('7')
  const b = sound('8', NEXT_DOOR)
  useShards.setState({ discovered: { [a.eventId as string]: a, [b.eventId as string]: b } } as never)
}

/** The tap targets' places: which boxes are drawn. */
const boxAt = (m: Mounted): unknown[] => of(m, 'taptarget').map((h) => h.props.at)

describe('Spatial Audio', () => {
  it('starts off, and off hides both the sound\'s box and its rings', async () => {
    expect(useLayers.getState().spatialAudio).toBe(false)
    // The sound is in the world, drawn and heard: only the switch keeps it off screen.
    expect(useShards.getState().drawnItems().map((w) => w.key)).toEqual([hex('7')])
    const m = await world()
    expect(boxes(m)).toBe(0)
    expect(rings(m)).toBe(0)
    await m.unmount()
  })

  it('on shows both, and they go again when it is turned off', async () => {
    useLayers.getState().setLayer('spatialAudio', true)
    const m = await world()
    expect(boxes(m)).toBe(1)
    expect(rings(m)).toBe(4)
    await m.unmount()
    useLayers.getState().setLayer('spatialAudio', false)
    const again = await world()
    expect(boxes(again)).toBe(0)
    expect(rings(again)).toBe(0)
    await again.unmount()
  })

  it('follows the switch live, on a world already mounted', async () => {
    const m = await world()
    expect([boxes(m), rings(m)]).toEqual([0, 0])
    useLayers.getState().setLayer('spatialAudio', true)
    await settled()
    expect([boxes(m), rings(m)]).toEqual([1, 4])
    useLayers.getState().setLayer('spatialAudio', false)
    await settled()
    expect([boxes(m), rings(m)]).toEqual([0, 0])
    await m.unmount()
  })

  it('shows both while audio is being placed in BUILD, whatever the switch says', async () => {
    useShards.setState({ pending: { type: 'audio', audio: { title: 'New', url: 'http://127.0.0.1/b.mp3', mime: 'audio/mpeg', autoplay: true, loop: true } } } as never)
    // A deploy aims from where you stand: the view back on the sound for the test.
    useCyberspace.setState({ anchor: HERE, anchorPlane: 0, scaleExp: 0 })
    const m = await world()
    expect(boxes(m)).toBe(1)
    expect(rings(m)).toBe(4)
    await m.unmount()
    // Placing something else is not placing audio.
    expect(spatialAudioShown(false, { type: 'message', text: 'hi' } as never)).toBe(false)
    expect(spatialAudioShown(false, null)).toBe(false)
    expect(spatialAudioShown(true, null)).toBe(true)
  })

  it('off, the sound still plays where it is hidden', async () => {
    expect(useLayers.getState().spatialAudio).toBe(false)
    vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
    const m = await mount(createElement(HiddenAudio, { axes: AXES }))
    expect(frames.list).toHaveLength(1)
    // The camera at the sound's own cell: well inside its full-volume sphere.
    const camera = { position: { x: 0.5, y: 0.5, z: -0.5 }, quaternion: {} }
    frames.list[0]({ camera })
    expect(ears.started).toEqual([hex('7')])
    await m.unmount()
    vi.restoreAllMocks()
  })

  it('off, shows the one sound whose card is open, and only that one, until the card closes', async () => {
    twoSounds()
    const m = await world()
    expect([boxes(m), rings(m)]).toEqual([0, 0])
    useShards.getState().selectSecret(hex('7'))
    await settled()
    expect([boxes(m), rings(m)]).toEqual([1, 4])
    const only = boxAt(m)
    useShards.getState().selectSecret(hex('8'))
    await settled()
    expect([boxes(m), rings(m)]).toEqual([1, 4])
    expect(boxAt(m)).not.toEqual(only)
    useShards.getState().selectSecret(null)
    await settled()
    expect([boxes(m), rings(m)]).toEqual([0, 0])
    await m.unmount()
  })

  it('off, shows the one sound a VIEW went to while the view lasts, as it is driven about, and not after RETURN', async () => {
    twoSounds()
    const m = await world()
    // VIEW from the card or from Nearby SOUNDS: the card closes, the look begins (SecretModal goTo, NearbyLootModal view).
    useShards.getState().selectSecret(null)
    useCyberspace.getState().viewAt(HERE, 0, 'RAIN LOOP 7', 0, { item: true })
    await settled()
    expect([boxes(m), rings(m)]).toEqual([1, 4])
    const viewed = boxAt(m)
    // The view driven a step, onto the other sound's cell: it is still a look at the first one (the place VIEW went to, CyberFocus named).
    const f = useCyberspace.getState().focus!
    useCyberspace.setState({ focus: { ...f, position: NEXT_DOOR }, anchor: HERE })
    await settled()
    expect([boxes(m), rings(m)]).toEqual([1, 4])
    expect(boxAt(m)).toEqual(viewed)
    // RETURN ends it; the scene put back over the sounds to see that both are gone.
    useCyberspace.getState().clearFocus()
    useCyberspace.setState({ anchor: HERE, anchorPlane: 0, scaleExp: 0 })
    await settled()
    expect([boxes(m), rings(m)]).toEqual([0, 0])
    await m.unmount()
  })

  it('a look at a place that is not a sound, or not on the sound\'s plane, shows none', async () => {
    const m = await world()
    useCyberspace.getState().viewAt(NEXT_DOOR, 0, 'SOMEWHERE', 0, { item: true })
    useCyberspace.setState({ anchor: HERE })
    await settled()
    expect([boxes(m), rings(m)]).toEqual([0, 0])
    await m.unmount()
    expect(spotlit({ key: 'x', at: HERE, plane: 0 }, { key: null, at: HERE, plane: 1 })).toBe(false)
    expect(spotlit({ key: 'x', at: HERE, plane: 0 }, { key: null, at: { ...HERE }, plane: 0 })).toBe(true)
    expect(spotlit({ key: 'x', at: HERE, plane: 0 }, NO_SPOT)).toBe(false)
  })
})
