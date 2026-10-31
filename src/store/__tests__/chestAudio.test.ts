/**
 * chestAudio.test.ts: audio sealed in a chest autoplays at the chest once
 * the chest is opened, as it did before the chest ceremony (#533). The
 * ceremony draws what stays in an opened chest as loot floating out of it,
 * so drawnItems leaves those out of the world; what is heard (heardAudio,
 * read by scene/HiddenAudio) does not. Its card and ITEMS still play it
 * (worldItems, secretByEvent). No relay is touched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../lib/contacts', () => ({ GENERAL_RELAYS: [], followsOf: async () => [], fetchContacts: async () => [] }))

import type { AudioItem } from '../../lib/audioItem'
import type { ChestItem } from '../../lib/hidden'
import { NOTHING_MUTED } from '../../lib/muteList'
import { useMutes } from '../useMutes'
import { useShards } from '../useShards'

const AUTHOR = 'b'.repeat(64)
const at = { x: 1n << 30n, y: 2n << 30n, z: 3n << 30n }
const audio: AudioItem = { url: 'https://blossom.test/x', sha256: 'a'.repeat(64), size: 10, mime: 'audio/wav', keyHex: '00'.repeat(32), title: 'Drone', about: '', autoplay: true, loop: true, retrigger: 'once', walkOnly: false } as unknown as AudioItem
const chest: ChestItem = { name: 'Old Chest', lockPubkey: 'c'.repeat(64), senderPubkey: 'd'.repeat(64), requires: '', payload: '' }
const base = { bagId: 'b', lookupId: 'l', author: AUTHOR, plane: 1 as const, height: 6, createdAt: 1 }
const chestFound = { ...base, eventId: 'e'.repeat(64), at, type: 'chest' as const, chest, inner: { id: 'e'.repeat(64), pubkey: AUTHOR, created_at: 1, kind: 3341, tags: [['title', 'Old Chest']], content: '' } }
/** Audio that came out of the opened chest, at the chest's own place: kept in it, floating out as loot. */
const inChest = { ...base, eventId: 'f'.repeat(64), at, type: 'audio' as const, audio, chestId: chestFound.eventId }
/** Audio hidden on its own, elsewhere. */
const loose = { ...base, eventId: '1'.repeat(64), at: { ...at, x: at.x + 5n }, type: 'audio' as const, audio }

beforeEach(() => {
  useMutes.setState({ muted: NOTHING_MUTED })
  useShards.setState({ mine: [], curated: null, discovered: { [chestFound.eventId]: chestFound, [inChest.eventId]: inChest, [loose.eventId]: loose } as never })
})

describe('audio sealed in an opened chest', () => {
  it('is not drawn in the world (it floats out as loot) but is heard there, autoplay on', () => {
    const sh = useShards.getState()
    expect(sh.drawnItems().map((w) => w.key)).not.toContain(inChest.eventId)
    const heard = sh.heardAudio()
    expect(heard.map((w) => w.key).sort()).toEqual([inChest.eventId, loose.eventId].sort())
    const w = heard.find((x) => x.key === inChest.eventId)!
    expect(w.audio?.autoplay).toBe(true)
    // Heard at the chest's own place.
    expect(w.at).toEqual(chestFound.at)
  })

  it('heard audio is audio only, and a muted author is not heard', () => {
    expect(useShards.getState().heardAudio().every((w) => w.type === 'audio')).toBe(true)
    useMutes.setState({ muted: { ...NOTHING_MUTED, pubkeys: new Set([AUTHOR]) } })
    expect(useShards.getState().heardAudio()).toEqual([])
  })

  it('still plays from its card: the card finds it', () => {
    expect(useShards.getState().secretByEvent(inChest.eventId)?.audio?.title).toBe('Drone')
  })

  it('the scene\'s hidden audio reads heardAudio, never drawnItems', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'scene', 'HiddenAudio.tsx'), 'utf8')
    expect(src).toContain('sh.heardAudio()')
    expect(src).not.toContain('drawnItems()')
  })
})
