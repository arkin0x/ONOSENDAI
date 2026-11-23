/**
 * What would fail silently without these tests: a stale focus surviving into a
 * spectate hides the avatar and pins the rig to the old point, so a friend's
 * chain "never loads" while every store field looks plausible; and an exit
 * path that clears a focus it does not own would yank the camera out of a
 * shard inspection. These pin the ownership rules down.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useCyberspace } from '../useCyberspace'
import { closeScrubber, exitHyperspaceView, ownHyperspaceView, useHyperspace, viewHyperspace } from '../useHyperspace'

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

describe('RETURN always goes home (arkinox, 2026-11-11, D1)', () => {
  beforeEach(() => {
    useHyperspace.setState({ scrubHeight: null, viewOwned: false, viewedStop: null })
    useCyberspace.setState({ focus: null, focusReturnScale: null, spectate: null, scaleExp: 10 })
  })

  it('goes home from a block viewed out of a place, at the zoom from before any look', () => {
    // Type a place, zoom out to find a block, tap it, RETURN: home, not back to the place.
    useCyberspace.getState().viewAt({ x: 5n, y: 6n, z: 7n }, 0, '44.97, -93.27', 38)
    useCyberspace.setState({ scaleExp: 46 })
    viewHyperspace({ x: 99n, y: 99n, z: 99n }, 0, 'BLOCK 60908 · LANDFALL', 52, 60908)
    expect(useHyperspace.getState().viewedStop).toBe(60908)
    exitHyperspaceView()
    const s = useCyberspace.getState()
    expect(s.focus).toBeNull()
    expect(s.scaleExp).toBe(10)
  })

  it('RECALL ends the hyperspace view with the focus: no bar, block or scrubber left', () => {
    useHyperspace.setState({ scrubHeight: 42 })
    viewHyperspace({ x: 5n, y: 6n, z: 7n }, 0, 'BLOCK 42 · PORT', 34, 42)
    expect(useCyberspace.getState().viewing()).toBe(true)
    useCyberspace.getState().cancel()
    expect(useCyberspace.getState().focus).toBeNull()
    expect(useHyperspace.getState()).toMatchObject({ viewOwned: false, viewedStop: null, scrubHeight: null })
  })

  it('another VIEW taking its place drops the ownership; the next block takes it again', () => {
    viewHyperspace({ x: 5n, y: 6n, z: 7n }, 0, 'BLOCK 1 · PORT', 34, 1)
    viewHyperspace({ x: 8n, y: 6n, z: 7n }, 0, 'BLOCK 2 · PORT', 34, 2)
    expect(useHyperspace.getState()).toMatchObject({ viewOwned: true, viewedStop: 2 })
    useCyberspace.getState().viewAt({ x: 1n, y: 1n, z: 1n }, 0, 'GRAND CANYON')
    expect(useHyperspace.getState()).toMatchObject({ viewOwned: false, viewedStop: null })
    expect(useCyberspace.getState().focus?.label).toBe('GRAND CANYON')
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

})

describe('closing the hyperspace chip (arkinox, 2026-10-15)', () => {
  it('closes only the chip: the block on screen stays until RETURN', () => {
    useHyperspace.setState({ scrubHeight: 42 })
    ownHyperspaceView()
    useCyberspace.getState().focusOn({ x: 5n, y: 6n, z: 7n }, 1, 'BLOCK 42 · PORT', 34)
    closeScrubber()
    expect(useHyperspace.getState().scrubHeight).toBeNull()
    expect(useHyperspace.getState().viewOwned).toBe(true)
    expect(useCyberspace.getState().focus?.label).toBe('BLOCK 42 · PORT')
    // RETURN on the viewing bar still ends it.
    exitHyperspaceView()
    expect(useCyberspace.getState().focus).toBeNull()
    expect(useHyperspace.getState().viewOwned).toBe(false)
  })
})
