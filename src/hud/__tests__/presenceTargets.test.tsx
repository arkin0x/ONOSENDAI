/**
 * presenceTargets.test.tsx: "N IN THIS SECTOR" counts and lists the avatars
 * you already target like everyone else nearby (arkinox, 2026-11-14: "even if
 * I'm targeting them I still want to know which avatars are nearby -- it
 * serves a different purpose"). Their row's button reads TARGETED, as it does
 * in TARGETS and on a person's card, and tapping it stops targeting them.
 * You and anyone blocked stay out. No network: profiles are stand-ins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  ;(globalThis as { window?: unknown }).window ??= globalThis
})

vi.mock('../../hooks/useProfile', () => ({ useProfile: () => null }))
vi.mock('../ProfileBadge', () => ({ ProfilePic: () => null }))

// The store first: PresenceChip imports it, and its import cycle needs the store built.
import { useCyberspace } from '../../store/useCyberspace'
import { usePresence, type Person } from '../../store/usePresence'
import { useMutes } from '../../store/useMutes'
import { PresenceChip } from '../PresenceChip'
import { mount, textOf, type Mounted } from '../../test/elementRoot'
import type { Position } from '../../lib/space'

const ME = 'a'.repeat(64)
const FRIEND = 'b'.repeat(64)
const STRANGER = 'c'.repeat(64)
const BLOCKED = 'd'.repeat(64)
const here: Position = { x: 5n, y: 5n, z: 5n }

const person = (pubkey: string, lastActive: number): Person => ({
  pubkey, position: { ...here, x: here.x + 1n }, plane: 0, lastActive, type: 'hop', checkedAt: lastActive, actionId: pubkey.slice(0, 8), frozen: false,
} as Person)

const targetRow = (pubkey: string) => ({ pubkey, npub: 'npub1x', name: null, position: here, plane: 0 as const, lastActive: null, status: 'live' as const })

let chip: Mounted | null = null

beforeEach(() => {
  useCyberspace.setState({
    identity: { ...useCyberspace.getState().identity, pubkey: ME },
    spectate: null, position: here, headPlane: 0, anchor: here, anchorPlane: 0, cursor: here, plane: 0,
    targets: { [FRIEND]: targetRow(FRIEND) },
  } as never)
  useMutes.setState({ muted: { ...useMutes.getState().muted, pubkeys: new Set([BLOCKED]) } } as never)
  usePresence.setState({
    loading: false,
    people: { [ME]: person(ME, 400), [FRIEND]: person(FRIEND, 200), [STRANGER]: person(STRANGER, 300), [BLOCKED]: person(BLOCKED, 500) },
  })
})

afterEach(async () => {
  await chip?.unmount()
  chip = null
  usePresence.setState({ people: {} })
  useCyberspace.setState({ targets: {} } as never)
  useMutes.setState({ muted: { ...useMutes.getState().muted, pubkeys: new Set() } } as never)
})

const rowButtons = (m: Mounted) => m.all().filter((h) => h.type === 'button' && String(h.props.className).includes('presence__target'))

describe('your targets in "N IN THIS SECTOR"', () => {
  it('counts a target with everyone else nearby, never you or anyone blocked', async () => {
    chip = await mount(<PresenceChip />)
    expect(chip.says('2 IN THIS SECTOR')).toBe(true)
    expect(usePresence.getState().others().map((p) => p.pubkey).sort()).toEqual([FRIEND, STRANGER])
  })

  it('lists a target in recency order, not first, its button reading TARGETED', async () => {
    chip = await mount(<PresenceChip />)
    await chip.press('IN THIS SECTOR')
    const buttons = rowButtons(chip)
    // The stranger acted more recently, so stands above the target.
    expect(buttons.map(textOf)).toEqual(['TARGET', 'TARGETED'])
    expect(buttons[1].props['aria-pressed']).toBe(true)
    expect(String(buttons[1].props.className)).toContain('is-on')
    expect(buttons[0].props['aria-pressed']).toBe(false)
    expect(String(buttons[0].props.className)).not.toContain('is-on')
  })

  it('tapping TARGETED stops targeting and the row stays, now TARGET; TARGET targets', async () => {
    chip = await mount(<PresenceChip />)
    await chip.press('IN THIS SECTOR')
    await chip.press(/^TARGETED$/)
    expect(useCyberspace.getState().targets[FRIEND]).toBeUndefined()
    expect(rowButtons(chip).map(textOf)).toEqual(['TARGET', 'TARGET'])
    expect(chip.says('2 IN THIS SECTOR')).toBe(true)
    // The friend's row is the second; press its button directly.
    ;(rowButtons(chip)[1].props.onClick as () => void)()
    await vi.waitFor(() => expect(rowButtons(chip!).map(textOf)).toEqual(['TARGET', 'TARGETED']))
    expect(useCyberspace.getState().targets[FRIEND]).toBeDefined()
    expect(useCyberspace.getState().targets[STRANGER]).toBeUndefined()
  })

  it('shows the chip when the only one here is a target', async () => {
    usePresence.setState({ people: { [FRIEND]: person(FRIEND, 300) } })
    chip = await mount(<PresenceChip />)
    expect(chip.says('1 IN THIS SECTOR')).toBe(true)
  })
})
