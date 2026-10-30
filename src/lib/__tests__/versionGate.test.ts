/**
 * versionGate.test.ts - what the deploy's /version.json does to this tab
 * (lib/versionGate.ts, lib/chainRulesEpoch.ts; the owner's ruling of
 * 2026-10-30, before the hop proof v2 cutover).
 *
 * What would go wrong silently: a stale tab that keeps signing old-format
 * hops after the cutover (the deploy's epoch is higher and nothing stops
 * it), or the opposite, a tab frozen by a network error, a missing file or
 * a slow answer, which would take offline play down with it. And a look
 * before every move that is not cached would slow WALK to the network's
 * pace. fetch is a stub in every test: nothing here reaches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAIN_RULES_EPOCH, VERSION_FILE, parseVersionFile, versionFileOf } from '../chainRulesEpoch'
import {
  BACKGROUND_TIMEOUT_MS,
  OWN_BUILD,
  PRE_MOVE_MAX_AGE_MS,
  PRE_MOVE_TIMEOUT_MS,
  checkVersion,
  mayMove,
  movementBlocked,
  reloadStreamOnBlock,
  resetVersionGateForTests,
  startVersionGate,
  useVersionGate,
  verdictOf,
} from '../versionGate'

type Answer = () => Promise<Response>
let answer: Answer
const fetchStub = vi.fn((_url: string, _init?: RequestInit) => answer())
const json = (body: unknown, status = 200): Answer => () => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
const sameEpoch = json(versionFileOf(OWN_BUILD))
const newerEpoch = json(versionFileOf('cutover-build', CHAIN_RULES_EPOCH + 1))
const offline: Answer = () => Promise.reject(new TypeError('fetch failed'))
const never: Answer = () => new Promise<Response>(() => {})
/** The fetch's own signal, as the gate handed it over: whether the look was cut short. */
const signalOf = (call: number): AbortSignal | undefined => fetchStub.mock.calls[call]?.[1]?.signal ?? undefined

beforeEach(() => {
  resetVersionGateForTests(true)
  fetchStub.mockClear()
  answer = sameEpoch
  vi.stubGlobal('fetch', fetchStub)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetVersionGateForTests(false)
})

describe('the version file', () => {
  it('is the build id and the epoch this build requires', () => {
    expect(versionFileOf('abc123')).toEqual({ build: 'abc123', minChainEpoch: CHAIN_RULES_EPOCH })
    expect(VERSION_FILE).toBe('version.json')
  })

  it('reads back only a real one', () => {
    expect(parseVersionFile({ build: 'abc', minChainEpoch: 2 })).toEqual({ build: 'abc', minChainEpoch: 2 })
    expect(parseVersionFile({ build: 'abc', minChainEpoch: '2' })).toBeNull()
    expect(parseVersionFile({ build: '', minChainEpoch: 1 })).toBeNull()
    expect(parseVersionFile({ build: 'abc', minChainEpoch: 1.5 })).toBeNull()
    expect(parseVersionFile('<!doctype html>')).toBeNull()
    expect(parseVersionFile(null)).toBeNull()
  })
})

describe('the verdict', () => {
  const own = { build: 'mine', epoch: 1 }
  it('equal epoch, same build: ok', () => expect(verdictOf({ build: 'mine', minChainEpoch: 1 }, own)).toBe('ok'))
  it('equal epoch, another build: a hint, nothing blocked', () => expect(verdictOf({ build: 'theirs', minChainEpoch: 1 }, own)).toBe('hint'))
  it('a higher deployed epoch: blocked', () => expect(verdictOf({ build: 'theirs', minChainEpoch: 2 }, own)).toBe('blocked'))
  it('a lower deployed epoch (a revert): not blocked', () => expect(verdictOf({ build: 'old', minChainEpoch: 0 }, { build: 'mine', epoch: 1 })).toBe('hint'))
  it('no answer: ok', () => expect(verdictOf(null, own)).toBe('ok'))
})

describe('the look before a move', () => {
  it('epoch equal: the move is allowed', async () => {
    expect(await mayMove()).toBe(true)
    expect(useVersionGate.getState().verdict).toBe('ok')
    expect(fetchStub).toHaveBeenCalledTimes(1)
    const [url, init] = fetchStub.mock.calls[0]
    expect(url).toMatch(/^\/version\.json\?t=\d+$/)
    expect(init?.cache).toBe('no-store')
  })

  it('deployed epoch higher: the move is refused, and the verdict the chip reads is blocked', async () => {
    answer = newerEpoch
    expect(await mayMove()).toBe(false)
    expect(movementBlocked()).toBe(true)
    expect(useVersionGate.getState().verdict).toBe('blocked')
    expect(useVersionGate.getState().deployed).toEqual({ build: 'cutover-build', minChainEpoch: CHAIN_RULES_EPOCH + 1 })
  })

  it('a fetch error (offline): allowed', async () => {
    answer = offline
    expect(await mayMove()).toBe(true)
    expect(movementBlocked()).toBe(false)
  })

  it('a 404, or a page that is not a version file: allowed', async () => {
    answer = json({ nope: true }, 404)
    expect(await mayMove()).toBe(true)
    resetVersionGateForTests(true)
    answer = () => Promise.resolve(new Response('<!doctype html><html></html>', { status: 200 }))
    expect(await mayMove()).toBe(true)
    resetVersionGateForTests(true)
    answer = json({ build: 'x' })
    expect(await mayMove()).toBe(true)
  })

  it('a timeout: allowed, after no more than PRE_MOVE_TIMEOUT_MS', async () => {
    vi.useFakeTimers()
    answer = never
    let result: boolean | undefined
    void mayMove().then((r) => { result = r })
    await vi.advanceTimersByTimeAsync(PRE_MOVE_TIMEOUT_MS - 1)
    expect(result).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBe(true)
    expect(movementBlocked()).toBe(false)
  })

  it('uses a cached recent answer: a second move within PRE_MOVE_MAX_AGE_MS asks nobody', async () => {
    vi.useFakeTimers()
    expect(await mayMove()).toBe(true)
    // The deploy changed meanwhile, but a recent answer is trusted for a minute.
    answer = newerEpoch
    await vi.advanceTimersByTimeAsync(PRE_MOVE_MAX_AGE_MS - 1000)
    expect(await mayMove()).toBe(true)
    expect(fetchStub).toHaveBeenCalledTimes(1)
    // Past it, the next move asks again, and learns.
    await vi.advanceTimersByTimeAsync(1000)
    expect(await mayMove()).toBe(false)
    expect(fetchStub).toHaveBeenCalledTimes(2)
  })

  it('a cached block refuses at once, without asking again', async () => {
    answer = newerEpoch
    expect(await mayMove()).toBe(false)
    expect(await mayMove()).toBe(false)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('a failed look is cached as well: a flaky network costs one wait, not one per move', async () => {
    answer = offline
    expect(await mayMove()).toBe(true)
    expect(await mayMove()).toBe(true)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('a move joins a background look already out, and waits for it no longer than its own timeout', async () => {
    vi.useFakeTimers()
    answer = never
    void checkVersion()
    let result: boolean | undefined
    void mayMove().then((r) => { result = r })
    await vi.advanceTimersByTimeAsync(PRE_MOVE_TIMEOUT_MS)
    expect(result).toBe(true)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('a block learned from a real answer stays when a later look fails; an error never lifts or makes one', async () => {
    vi.useFakeTimers()
    answer = newerEpoch
    expect(await mayMove()).toBe(false)
    answer = offline
    await vi.advanceTimersByTimeAsync(PRE_MOVE_MAX_AGE_MS)
    expect(await mayMove()).toBe(false)
    expect(fetchStub).toHaveBeenCalledTimes(2)
    // A later real answer with the old epoch (a revert) lifts it.
    answer = sameEpoch
    await vi.advanceTimersByTimeAsync(PRE_MOVE_MAX_AGE_MS)
    expect(await mayMove()).toBe(true)
  })

  it('a slow link (an answer in 3 s): the move goes ahead at 1.5 s, the look is not cut short, and the late answer refuses the next move (review of #530)', async () => {
    vi.useFakeTimers()
    answer = () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response(JSON.stringify(versionFileOf('cutover-build', CHAIN_RULES_EPOCH + 1)), { status: 200 })), 3_000))
    let first: boolean | undefined
    void mayMove().then((r) => { first = r })
    await vi.advanceTimersByTimeAsync(PRE_MOVE_TIMEOUT_MS)
    // The move did not wait past its 1.5 s, and nothing was known yet.
    expect(first).toBe(true)
    expect(movementBlocked()).toBe(false)
    // The fetch is still out: not aborted at the move's timeout.
    expect(signalOf(0)?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(3_000 - PRE_MOVE_TIMEOUT_MS)
    expect(movementBlocked()).toBe(true)
    // The next move is refused from the answer in hand, with no second look.
    expect(await mayMove()).toBe(false)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('a look that never answers is given up on at BACKGROUND_TIMEOUT_MS, not at a move\'s 1.5 s', async () => {
    vi.useFakeTimers()
    answer = never
    void mayMove()
    await vi.advanceTimersByTimeAsync(PRE_MOVE_TIMEOUT_MS)
    expect(signalOf(0)?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(BACKGROUND_TIMEOUT_MS - PRE_MOVE_TIMEOUT_MS)
    expect(signalOf(0)?.aborted).toBe(true)
    expect(movementBlocked()).toBe(false)
  })

  it('before the gate is started (tests, and before boot) nothing is fetched', async () => {
    resetVersionGateForTests(false)
    expect(await mayMove()).toBe(true)
    expect(fetchStub).not.toHaveBeenCalled()
  })
})

describe('the soft hint', () => {
  it('another build at the same epoch is a hint, never a block', async () => {
    answer = json(versionFileOf('a-newer-build'))
    expect(await mayMove()).toBe(true)
    expect(useVersionGate.getState().verdict).toBe('hint')
  })

  it('dismissing it remembers that build', async () => {
    answer = json(versionFileOf('a-newer-build'))
    await checkVersion()
    useVersionGate.getState().dismissHint()
    expect(useVersionGate.getState().hintDismissed).toBe('a-newer-build')
  })
})

describe('when the tab looks', () => {
  it('at boot, on focus, on a return to the tab, and when the network comes back', async () => {
    const win = Object.assign(new EventTarget(), { setInterval: () => 0 })
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', doc)
    resetVersionGateForTests(false)
    vi.useFakeTimers()
    startVersionGate()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchStub).toHaveBeenCalledTimes(1)
    // Focus, visibility and the network coming back each look, past the
    // few seconds in which one look answers all of them.
    for (const [target, type] of [[win, 'focus'], [doc, 'visibilitychange'], [win, 'online']] as const) {
      await vi.advanceTimersByTimeAsync(6_000)
      const before = fetchStub.mock.calls.length
      target.dispatchEvent(new Event(type))
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchStub.mock.calls.length, type).toBe(before + 1)
    }
  })
})

describe('the TV stream', () => {
  it('reloads when it learns of a block, once, and not for a hint', () => {
    const reload = vi.fn()
    reloadStreamOnBlock({ verdict: 'hint' }, { verdict: 'ok' }, reload)
    expect(reload).not.toHaveBeenCalled()
    reloadStreamOnBlock({ verdict: 'blocked' }, { verdict: 'ok' }, reload)
    expect(reload).toHaveBeenCalledTimes(1)
    reloadStreamOnBlock({ verdict: 'blocked' }, { verdict: 'blocked' }, reload)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
