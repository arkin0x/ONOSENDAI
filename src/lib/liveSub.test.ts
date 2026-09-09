import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveRegistry, backoffFor, resumedFilter, RESUME_OVERLAP_S, type Transport } from './liveSub'
import type { Filter } from 'nostr-tools/filter'
import type { NostrEvent } from './events'

/** A pool that remembers every open, and lets the test end a subscription. */
function fakeTransport() {
  const opens: Array<{ filter: Filter; emit: (ev: NostrEvent) => void; end: (reason: string) => void; closed: boolean; failed?: boolean }> = []
  let failNext = false
  const transport: Transport = {
    open: async (filter, handlers, onClose) => {
      if (failNext) { failNext = false; throw new Error('relay down') }
      const rec = { filter, emit: handlers.onEvent, end: onClose, closed: false }
      opens.push(rec)
      return () => { rec.closed = true }
    },
  }
  return { transport, opens, failNext: () => { failNext = true } }
}

const ev = (created_at: number): NostrEvent => ({ id: String(created_at), kind: 1, created_at, pubkey: 'p', content: '', tags: [], sig: 's' })

describe('the resumed filter', () => {
  it('leaves a subscription that has seen nothing alone', () => {
    expect(resumedFilter({ kinds: [1], since: 5 }, null)).toEqual({ kinds: [1], since: 5 })
  })

  it('moves since up to a minute before the last event seen', () => {
    expect(resumedFilter({ kinds: [1] }, 1000).since).toBe(1000 - RESUME_OVERLAP_S)
  })

  it('never moves since backwards', () => {
    expect(resumedFilter({ kinds: [1], since: 2000 }, 1000).since).toBe(2000)
  })
})

describe('the backoff', () => {
  it('starts at a second and tops out at thirty', () => {
    expect(backoffFor(1)).toBe(1_000)
    expect(backoffFor(3)).toBe(5_000)
    expect(backoffFor(50)).toBe(30_000)
  })
})

describe('a live subscription', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('delivers events and remembers the newest', async () => {
    const { transport, opens } = fakeTransport()
    const reg = new LiveRegistry(transport)
    const got: number[] = []
    reg.subscribe({ kinds: [1] }, { onEvent: (e) => got.push(e.created_at) })
    await vi.runAllTicks()
    opens[0].emit(ev(10)); opens[0].emit(ev(30)); opens[0].emit(ev(20))
    expect(got).toEqual([10, 30, 20])
    expect(reg.list()[0].lastSeen).toBe(30)
  })

  it('reopens after the relay ends it, with since moved up', async () => {
    const { transport, opens } = fakeTransport()
    const reg = new LiveRegistry(transport)
    reg.subscribe({ kinds: [1] }, { onEvent: () => {} })
    await vi.runAllTicks()
    opens[0].emit(ev(500))
    opens[0].end('connection closed')
    expect(opens).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(opens).toHaveLength(2)
    expect(opens[1].filter.since).toBe(500 - RESUME_OVERLAP_S)
    expect(reg.list()[0].reopens).toBe(1)
  })

  it('backs off across repeated closes and resets once something arrives', async () => {
    const { transport, opens } = fakeTransport()
    const reg = new LiveRegistry(transport)
    reg.subscribe({ kinds: [1] }, { onEvent: () => {} })
    await vi.runAllTicks()
    opens[0].end('x')
    await vi.advanceTimersByTimeAsync(1_000)   // 1 s
    opens[1].end('x')
    await vi.advanceTimersByTimeAsync(1_999)
    expect(opens).toHaveLength(2)              // not yet: second wait is 2 s
    await vi.advanceTimersByTimeAsync(1)
    expect(opens).toHaveLength(3)
    opens[2].emit(ev(1))                       // life: the count resets
    opens[2].end('x')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(opens).toHaveLength(4)
  })

  it('a failed open is retried too', async () => {
    const { transport, opens, failNext } = fakeTransport()
    failNext()
    const reg = new LiveRegistry(transport)
    reg.subscribe({ kinds: [1] }, { onEvent: () => {} })
    await vi.runAllTicks()
    expect(opens).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(opens).toHaveLength(1)
    expect(reg.list()).toHaveLength(1)
  })

  it('a closer ends it for good: no reopen, and a late close is ignored', async () => {
    const { transport, opens } = fakeTransport()
    const reg = new LiveRegistry(transport)
    const stop = reg.subscribe({ kinds: [1] }, { onEvent: () => {} })
    await vi.runAllTicks()
    stop()
    expect(opens[0].closed).toBe(true)
    opens[0].end('closed by us')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(opens).toHaveLength(1)
    expect(reg.list()).toHaveLength(0)
  })

  it('resumeAll drops the sockets once and reissues every record at once', async () => {
    const { transport, opens } = fakeTransport()
    const reg = new LiveRegistry(transport)
    reg.subscribe({ kinds: [1] }, { onEvent: () => {} })
    reg.subscribe({ kinds: [2] }, { onEvent: () => {} })
    await vi.runAllTicks()
    opens[0].emit(ev(900))
    let drops = 0
    reg.resumeAll(() => { drops++ })
    await vi.runAllTicks()
    expect(drops).toBe(1)
    expect(opens).toHaveLength(4)
    expect(reg.list().map((l) => l.reopens)).toEqual([1, 1])
    expect(opens[2].filter).toMatchObject({ kinds: [1], since: 900 - RESUME_OVERLAP_S })
    expect(opens[3].filter).toEqual({ kinds: [2] })
  })

  it('a close from the socket that was replaced does not reopen again', async () => {
    const { transport, opens } = fakeTransport()
    const reg = new LiveRegistry(transport)
    reg.subscribe({ kinds: [1] }, { onEvent: () => {} })
    await vi.runAllTicks()
    reg.resumeAll(() => {})
    await vi.runAllTicks()
    expect(opens).toHaveLength(2)
    opens[0].end('late close of the old socket')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(opens).toHaveLength(2)
  })
})
