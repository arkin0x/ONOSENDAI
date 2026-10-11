/**
 * agentTalk.test.ts: the TALK modal's quick orders are plain messages
 * (arkinox, 2026-10-10, operator and agent DMs), and COME TO ME carries the
 * operator's coordinate so the agent knows where to ride.
 */
import { describe, expect, it } from 'vitest'
import '../../store/useCyberspace'
import { DM_INBOX_TIP, quickOrders } from '../AgentTalk'

describe('quick orders', () => {
  const coord = '0123456789abcdef'.repeat(4)
  const orders = quickOrders(coord)

  it('are COME TO ME, REPORT, HOLD and KEEP GOING, uppercase, each a message that names itself', () => {
    expect(orders.map((o) => o.label)).toEqual(['COME TO ME', 'REPORT', 'HOLD', 'KEEP GOING'])
    for (const o of orders) expect(o.text.startsWith(o.label)).toBe(true)
  })

  it('COME TO ME carries my coordinate hex, and only it', () => {
    expect(orders[0].text).toContain(coord)
    expect(orders.slice(1).some((o) => o.text.includes(coord))).toBe(false)
  })

  it('only KEEP GOING carries the continue marker (arkinox, 2026-10-11)', () => {
    expect(orders.map((o) => !!o.keepGoing)).toEqual([false, false, false, true])
  })

  it('no em or en dash in anything shown', () => {
    for (const t of [DM_INBOX_TIP, ...orders.flatMap((o) => [o.text, o.title])]) expect(t).not.toMatch(/[\u2013\u2014]/)
  })
})
