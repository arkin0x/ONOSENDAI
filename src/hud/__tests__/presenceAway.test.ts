/**
 * presenceAway.test.ts: "N IN THIS SECTOR" counts your own sector only
 * (arkinox, 2026-10-11), so the chip steps aside while spectating someone or
 * while the cursor is in another sector than your position.
 */

import { describe, expect, it } from 'vitest'
// The store first: PresenceChip imports it, and its import cycle needs the store built.
import '../../store/useCyberspace'
import { awayFromOwnSector } from '../PresenceChip'

const SECTOR = 1n << 30n
const at = (x: bigint, y = 5n, z = 5n) => ({ x, y, z, plane: 0 } as never)

describe('the sector chip counts your own sector only', () => {
  it('shows at home: cursor and position in one sector', () => {
    expect(awayFromOwnSector({ spectate: null, position: at(5n), cursor: at(SECTOR - 1n) })).toBe(false)
  })
  it('steps aside when the cursor is in another sector', () => {
    expect(awayFromOwnSector({ spectate: null, position: at(5n), cursor: at(SECTOR + 1n) })).toBe(true)
  })
  it('steps aside while spectating, wherever the cursor is', () => {
    expect(awayFromOwnSector({ spectate: { pubkey: 'x' }, position: at(5n), cursor: at(5n) })).toBe(true)
  })
})
