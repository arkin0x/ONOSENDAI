/**
 * events.worker.test.ts - the worker file itself: it answers, one request at a
 * time in the order they came, and one answer that cannot be sent does not
 * silence the ones after it. A stand-in `self`, and stand-in ops the test
 * releases one at a time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventDbRequest, EventDbResponse } from '../../lib/eventDb/ops'

interface FakeSelf { onmessage?: (m: { data: EventDbRequest }) => void; postMessage: (r: EventDbResponse) => void }

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5))
const request = (call: number): { data: EventDbRequest } => ({ data: { call, op: 'budget', args: [] } })

let posted: EventDbResponse[]
let ran: number[]
let release: Map<number, () => void>
let fakeSelf: FakeSelf

beforeEach(async () => {
  posted = []
  ran = []
  release = new Map()
  fakeSelf = { postMessage: (r) => { posted.push(r) } }
  vi.stubGlobal('self', fakeSelf)
  vi.resetModules()
  vi.doMock('../../lib/eventDb/ops', () => ({
    answer: (r: EventDbRequest) => {
      ran.push(r.call)
      return new Promise<EventDbResponse>((resolve) => { release.set(r.call, () => resolve({ call: r.call, ok: true, value: r.call })) })
    },
  }))
  await import('../events.worker')
})
afterEach(() => { vi.doUnmock('../../lib/eventDb/ops'); vi.unstubAllGlobals() })

describe('events.worker', () => {
  it('answers what it was asked', async () => {
    fakeSelf.onmessage!(request(1))
    await settle()
    release.get(1)!()
    await settle()
    expect(posted).toEqual([{ call: 1, ok: true, value: 1 }])
  })

  it('runs one request at a time, in the order they came', async () => {
    fakeSelf.onmessage!(request(1))
    fakeSelf.onmessage!(request(2))
    await settle()
    expect(ran).toEqual([1])
    expect(posted).toEqual([])
    release.get(1)!()
    await settle()
    expect(ran).toEqual([1, 2])
    expect(posted.map((r) => r.call)).toEqual([1])
    release.get(2)!()
    await settle()
    expect(posted.map((r) => r.call)).toEqual([1, 2])
  })

  it('an answer that cannot be sent says so, and the requests after it are still answered', async () => {
    let first = true
    fakeSelf.postMessage = (r) => {
      if (first) { first = false; throw new DOMException('could not be cloned', 'DataCloneError') }
      posted.push(r)
    }
    fakeSelf.onmessage!(request(1))
    fakeSelf.onmessage!(request(2))
    await settle()
    release.get(1)!()
    await settle()
    release.get(2)!()
    await settle()
    expect(posted[0]).toMatchObject({ call: 1, ok: false, name: 'DataCloneError' })
    expect(posted[1]).toEqual({ call: 2, ok: true, value: 2 })
  })
})
