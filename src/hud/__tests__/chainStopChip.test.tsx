/**
 * chainStopChip.test.tsx: the broken-chain chip and its modal for a chain the
 * relay's rules stop (the owner's ruling of 2026-11-12). The owner's real
 * chain: CHAIN STOPS AT 2026-09-04, a tap opens where and why, and RESPAWN is
 * the same respawn as for a broken chain. A clean chain: nothing. A tall hop:
 * the relay's ceiling, and nothing to tap. The 5.13 list loading: nothing,
 * then the chip. Spectating: no chip of yours, and their stop as a plain fact.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The modal portals into document.body: a host record here, read like the mounted tree.
const body = vi.hoisted(() => Object.defineProperty({ type: 'body', props: {}, children: [] as unknown[] }, 'nodeType', { value: 1 }))
;(globalThis as { document?: unknown }).document ??= { addEventListener: () => undefined, removeEventListener: () => undefined, body }

// Your chain, as the store gives it: one array per chain, as parsedChain does.
const cs = vi.hoisted(() => ({
  events: [] as unknown[],
  actions: [] as unknown[],
  spectate: null as null | { actions: unknown[] },
  respawnFromBrokenChain: vi.fn(async () => undefined),
}))
vi.mock('../../store/useCyberspace', () => {
  const state = () => ({
    events: cs.events,
    actions: () => cs.actions,
    spectate: cs.spectate,
    identity: { pubkey: 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a' },
    respawnFromBrokenChain: cs.respawnFromBrokenChain,
  })
  return { useCyberspace: Object.assign((sel: (s: ReturnType<typeof state>) => unknown) => sel(state()), { getState: state }) }
})
vi.mock('../../store/useBuilder', () => ({ walkChain: vi.fn() }))
// The 5.13 list: the real one, behind a gate a test can hold shut.
const v1 = vi.hoisted(() => ({ gate: Promise.resolve() as Promise<void> }))
vi.mock('../../lib/v1HopList', () => ({
  loadV1HopList: async () => {
    await v1.gate
    return (await import('../../../node_modules/cyberspace-core/dist/grandfathered_v1_hops.js')).GRANDFATHERED_V1_HOPS
  },
}))

import { mount, settled, textOf, type Host } from '../../test/elementRoot'
import { mountHook, settle } from '../../test/hookRoot'
import { BrokenChainChip, BrokenChainModal } from '../BrokenChain'
import { spectatedStopWords } from '../../lib/chainBreak'
import { useChainStopOf } from '../../hooks/useChainStop'
import { useChainUi } from '../../store/useChainUi'
import { resetChainStops } from '../../lib/chainStop'
import { buildChain, type ActionEvent, type NostrEvent } from '../../lib/events'
import owner from '../../lib/__tests__/vectors/owner-chain-e8ed3798-through-2026-09-04.json'

const OWNER = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const ownerChain = buildChain(owner as NostrEvent[], OWNER)
const V2 = { mn: '0'.repeat(16), mp: 'ab' }
function move(id: string, type: string, extra: Partial<ActionEvent> = {}): ActionEvent {
  return { id, type, coordHex: id.padEnd(64, '0'), role: 'base', createdAt: 1_790_000_000, ...extra } as unknown as ActionEvent
}
const at = (x: bigint): ActionEvent['position'] => ({ x, y: 0n, z: 0n })

/** The modal, as the portal drew it: its words, and a press on one of its buttons. */
const modalText = (): string => textOf(body as unknown as Host)
function modalButtons(): Host[] {
  const out: Host[] = []
  const walk = (h: Host | string): void => { if (typeof h === 'string') return; if (h.type === 'button') out.push(h); h.children.forEach(walk) }
  walk(body as unknown as Host)
  return out
}
async function pressInModal(words: string): Promise<void> {
  const b = modalButtons().find((h) => textOf(h) === words)
  if (!b) throw new Error(`no modal button says ${words}; there are: ${modalButtons().map(textOf).join(' | ')}`)
  ;(b.props.onClick as () => void)()
  await settled()
}

function yourChain(actions: unknown[]): void {
  cs.actions = actions
  cs.events = [...actions]
}

beforeEach(() => {
  resetChainStops()
  v1.gate = Promise.resolve()
  cs.spectate = null
  useChainUi.getState().setBrokenView(null)
})

describe("the owner's chain: the chip says where it stops, and RESPAWN", () => {
  it('CHAIN STOPS AT 2026-09-04, TAP FOR WHY AND RESPAWN; the tap opens where and why, then the respawn', async () => {
    yourChain(ownerChain)
    const chip = await mount(<BrokenChainChip />)
    await settled()
    expect(chip.says('CHAIN STOPS AT 2026-09-04')).toBe(true)
    expect(chip.says('TAP FOR WHY AND RESPAWN')).toBe(true)
    await chip.press('CHAIN STOPS AT 2026-09-04')
    expect(useChainUi.getState().brokenView).toBe('notice')

    const modal = await mount(<BrokenChainModal />)
    const said = modalText()
    expect(said).toContain('Your chain stops at 2026-09-04')
    expect(said).toContain('YOUR CHAIN STOPS AT ROW 23')
    expect(said).toContain('row 23, event d334293b… (SIDESTEP)')
    expect(said).toContain('It is a sidestep in the old proof format, and those stopped counting on 2026-09-07.')
    expect(said).toContain('Nothing after it counts, so your chain ends where row 22 left you on 2026-09-04. ONOSENDAI will not sign a move onto this chain. Respawn to move again.')
    expect(said).toContain('It was valid when you signed it. The rules changed on 2026-09-07. Sorry.')
    expect(said).not.toContain('—')
    expect(modalButtons().map(textOf)).toEqual(['SHOW THE ROW', 'CLOSE', 'RESPAWN'])
    await pressInModal('RESPAWN')
    expect(useChainUi.getState().brokenView).toBe('confirm')
    expect(modalText()).toContain('A respawn starts you over.')
    expect(modalText()).toContain('End of Chain daf16062')
    await pressInModal('RESPAWN NOW')
    expect(cs.respawnFromBrokenChain).toHaveBeenCalledWith(OWNER)
    await modal.unmount()
    await chip.unmount()
  })

  it('while the 5.13 list loads: no chip, no flash; then the chip', async () => {
    let open: () => void = () => undefined
    v1.gate = new Promise<void>((r) => { open = r })
    yourChain(ownerChain)
    const chip = await mount(<BrokenChainChip />)
    expect(chip.all()).toHaveLength(0)
    open()
    await settled(30)
    expect(chip.says('CHAIN STOPS AT 2026-09-04')).toBe(true)
    await chip.unmount()
  })
})

describe('other chains', () => {
  it('a clean chain: no chip', async () => {
    yourChain([move('k0', 'spawn'), move('k1', 'hop', V2)])
    const chip = await mount(<BrokenChainChip />)
    expect(chip.all()).toHaveLength(0)
    await chip.unmount()
  })

  it('a tall hop: the relay ceiling, with nothing to tap and no modal', async () => {
    yourChain([move('t0', 'spawn', { position: at(0n) }), move('t1', 'hop', { ...V2, position: at(1n << 30n) })])
    const chip = await mount(<BrokenChainChip />)
    expect(chip.says('RELAY CHECKS HOPS UP TO H24')).toBe(true)
    expect(chip.says('IT READS YOUR CHAIN UP TO 2026-09-21 · NO RESPAWN NEEDED')).toBe(true)
    expect(chip.buttons(/./)).toHaveLength(0)
    useChainUi.getState().setBrokenView('notice')
    const modal = await mount(<BrokenChainModal />)
    expect(modalText()).toBe('')
    await modal.unmount()
    await chip.unmount()
    // The tutorial shows only chips that stop you: this one stands down there.
    const tutorial = await mount(<BrokenChainChip stopsOnly />)
    expect(tutorial.all()).toHaveLength(0)
    await tutorial.unmount()
  })

  it('the tutorial still shows a chain that stops', async () => {
    yourChain(ownerChain)
    const chip = await mount(<BrokenChainChip stopsOnly />)
    await settled(30)
    expect(chip.says('CHAIN STOPS AT 2026-09-04')).toBe(true)
    await chip.unmount()
  })

  it('spectating: your chip stands down, and their stop is a plain fact with no respawn', async () => {
    yourChain(ownerChain)
    cs.spectate = { actions: ownerChain }
    const chip = await mount(<BrokenChainChip />)
    expect(chip.all()).toHaveLength(0)
    await chip.unmount()

    const theirs = mountHook((c: ActionEvent[]) => useChainStopOf(c, 'spectate'), ownerChain)
    await settle(20)
    const stop = theirs.current()
    expect(stop).toBeTruthy()
    const words = spectatedStopWords(stop!)
    expect(words.text).toBe('CHAIN STOPS AT 2026-09-04')
    expect(`${words.text} ${words.title}`).not.toMatch(/respawn/i)
    await theirs.unmount()
  })

  it('spectating a tall hop or a fork: neutral words too', () => {
    const tall = spectatedStopWords({ source: 'relay', stop: { index: 1, action: move('s1', 'hop'), lastValid: move('s0', 'spawn'), kind: 'tall', rule: 'tall-hop', reason: '' } })
    expect(tall.text).toBe('RELAY READS IT UP TO 2026-09-21')
    const forked = spectatedStopWords({ source: 'rules', broken: { index: 0, action: move('f0', 'spawn', { fork: { previousId: 'f0', branchIds: ['a', 'b'] } }), lastValid: null } })
    expect(forked.text).toBe('CHAIN FORKED')
    for (const w of [tall, forked]) expect(`${w.text} ${w.title}`).not.toMatch(/respawn/i)
  })
})
