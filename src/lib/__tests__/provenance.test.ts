/**
 * provenance.test.ts: where a held item was obtained, as its details show
 * it (arkinox, 2026-10-30): taken out of a chest, the chest, its place and
 * coordinate, and when; found in a bag, the bag's place; pasted from another
 * device, nothing. The record is the identity's own inventory row, so
 * another identity on the same device has none of it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { messageInnerTemplate } from '../hidden'
import { heldFromEntry, type HeldPlace } from '../inventory'
import type { NostrEvent } from '../events'
import { positionHex } from '../events'
import { provenanceOf } from '../provenance'
import { useInventory } from '../../store/useInventory'
import { useCyberspace } from '../../store/useCyberspace'

const at = { x: 10n, y: 20n, z: 30n }
const place: HeldPlace = { lookupId: 'l', bagId: 'b', at: { x: '10', y: '20', z: '30' }, plane: 1, height: 6 }
const from = { chestId: 'c'.repeat(64), chestName: 'Strongbox' }
const note = finalizeEvent(messageInnerTemplate('inside', at, 1, 1), generateSecretKey()) as NostrEvent
const entry = { id: note.id, event: note, verified: true, body: { type: 'message' as const, text: 'inside' } }

describe('where an item was obtained', () => {
  it('out of a chest: the chest, where it stands, its coordinate, and when', () => {
    const p = provenanceOf(heldFromEntry('a'.repeat(64), entry, from, place, 1_800_000_000))
    expect(p).toEqual({ chest: { id: from.chestId, name: 'Strongbox' }, at, plane: 1, height: 6, coordinate: positionHex(at, 1), when: 1_800_000_000 })
    expect(p?.coordinate).toMatch(/^[0-9a-f]{64}$/)
  })

  it('found in a bag: the place, no chest', () => {
    expect(provenanceOf({ place, from: null, at: 5 })).toMatchObject({ chest: null, at, plane: 1 })
  })

  it('pasted from another device: nothing to show', () => {
    expect(provenanceOf({ place: null, from: null, at: 5 })).toBeNull()
  })
})

describe('kept per identity', () => {
  beforeEach(() => { useInventory.setState({ owner: '', items: {}, storage: 'memory' }) })

  it('TAKE records it under the identity that took it, and another identity sees none of it', async () => {
    const a = 'a'.repeat(64), b = 'b'.repeat(64)
    useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: a } })
    await useInventory.getState().load(a)
    useInventory.getState().take([entry], from, place)
    const row = useInventory.getState().items[note.id]
    expect(row.rowKey).toBe(`${a}/${note.id}`)
    expect(provenanceOf(row)?.chest?.name).toBe('Strongbox')
    await useInventory.getState().load(b)
    expect(useInventory.getState().owner).toBe(b)
    expect(useInventory.getState().items[note.id]).toBeUndefined()
  })
})
