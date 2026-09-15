/**
 * What would fail silently without these tests: a stale focus surviving into a
 * spectate hides the avatar and pins the rig to the old point, so a friend's
 * chain "never loads" while every store field looks plausible; and an exit
 * path that clears a focus it does not own would yank the camera out of a
 * shard inspection. These pin the ownership rules down.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useCyberspace } from './useCyberspace'
import { exitHyperspaceView, ownHyperspaceView, useHyperspace } from './useHyperspace'

const PK = 'ab'.repeat(32)

beforeEach(() => {
  useCyberspace.getState().endSpectate()
  useCyberspace.getState().clearFocus()
  useHyperspace.setState({ scrubHeight: null, viewOwned: false })
})

describe('spectate vs focus', () => {
  it('beginSpectate clears a standing focus', () => {
    useCyberspace.getState().focusOn({ x: 5n, y: 6n, z: 7n }, 0, 'EARTH', 52)
    expect(useCyberspace.getState().focus).not.toBeNull()
    useCyberspace.getState().beginSpectate(PK)
    expect(useCyberspace.getState().focus).toBeNull()
    expect(useCyberspace.getState().spectate?.pubkey).toBe(PK)
  })

  it('a new spectate closes the scrubber and drops hyperspace view ownership', () => {
    useHyperspace.setState({ scrubHeight: 1234, viewOwned: true })
    useCyberspace.getState().beginSpectate(PK)
    expect(useHyperspace.getState().scrubHeight).toBeNull()
    expect(useHyperspace.getState().viewOwned).toBe(false)
  })
})

describe('exitHyperspaceView', () => {
  it('clears a focus hyperspace owns and returns the anchor home', () => {
    ownHyperspaceView()
    useCyberspace.getState().focusOn({ x: 5n, y: 6n, z: 7n }, 0, 'BLOCK 42 · PORT', 34)
    exitHyperspaceView()
    expect(useCyberspace.getState().focus).toBeNull()
    expect(useHyperspace.getState().viewOwned).toBe(false)
    expect(useHyperspace.getState().scrubHeight).toBeNull()
  })

  it('leaves a foreign focus alone', () => {
    useCyberspace.getState().focusOn({ x: 5n, y: 6n, z: 7n }, 0, 'SHARD', 20)
    exitHyperspaceView()
    expect(useCyberspace.getState().focus).not.toBeNull()
    useCyberspace.getState().clearFocus()
  })

  it('never clears focus while a spectate is running', () => {
    ownHyperspaceView()
    useCyberspace.getState().beginSpectate(PK)
    // ownership was already dropped by the subscription; even if it were not,
    // exiting must not touch the spectate's state
    useHyperspace.setState({ viewOwned: true })
    exitHyperspaceView()
    expect(useCyberspace.getState().spectate?.pubkey).toBe(PK)
  })
})

describe('closing the overlay gives the camera back', () => {
  beforeEach(() => {
    useHyperspace.setState({ scrubHeight: null, viewOwned: false, returnScaleExp: null, returnFocus: null, viewedStop: null })
    useCyberspace.setState({ focus: null, focusReturnScale: null, spectate: null, scaleExp: 10 })
  })

  it('returns to the place you were viewing, at the zoom you were at', () => {
    // arkinox's repro: type a place, zoom out to find a block, tap it, close.
    const place = { x: 5n, y: 6n, z: 7n }
    useCyberspace.getState().focusOn(place, 0, '44.97, -93.27', 38, true)
    useCyberspace.setState({ scaleExp: 46 }) // zoomed out to find a block
    ownHyperspaceView()
    useCyberspace.getState().focusOn({ x: 99n, y: 99n, z: 99n }, 0, 'BLOCK 60908 · LANDFALL')
    exitHyperspaceView()
    const s = useCyberspace.getState()
    expect(s.focus?.label).toBe('44.97, -93.27')
    expect(s.focus?.position).toEqual(place)
    expect(s.focus?.drive).toBe(true)
    // Not 10, which is where the session began and where it used to land.
    expect(s.scaleExp).toBe(46)
  })

  it('still goes home when hyperspace took the camera from nobody', () => {
    useCyberspace.setState({ scaleExp: 30 })
    ownHyperspaceView()
    useCyberspace.getState().focusOn({ x: 1n, y: 2n, z: 3n }, 0, 'BLOCK 7 · PORT')
    exitHyperspaceView()
    const s = useCyberspace.getState()
    expect(s.focus).toBeNull()
    expect(s.scaleExp).toBe(30)
  })

  it('reads the scale fresh rather than from a snapshot taken before clearFocus', () => {
    // clearFocus writes a scale of its own. Comparing the target against a
    // stale copy let the two disagree and the restore silently do nothing.
    useCyberspace.setState({ scaleExp: 20 })
    ownHyperspaceView()
    useCyberspace.getState().focusOn({ x: 1n, y: 1n, z: 1n }, 0, 'BLOCK 1 · PORT', 52)
    exitHyperspaceView()
    expect(useCyberspace.getState().scaleExp).toBe(20)
  })

  it('takes the focus it borrowed from, not one from earlier in the session', () => {
    useCyberspace.getState().focusOn({ x: 1n, y: 1n, z: 1n }, 0, 'A SHARD', 20)
    useCyberspace.getState().focusOn({ x: 2n, y: 2n, z: 2n }, 0, 'A PLACE', 44, true)
    ownHyperspaceView()
    useCyberspace.getState().focusOn({ x: 3n, y: 3n, z: 3n }, 0, 'BLOCK 9 · LANDFALL')
    exitHyperspaceView()
    expect(useCyberspace.getState().focus?.label).toBe('A PLACE')
    expect(useCyberspace.getState().scaleExp).toBe(44)
  })
})
