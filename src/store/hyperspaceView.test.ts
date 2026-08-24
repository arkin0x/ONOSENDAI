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
