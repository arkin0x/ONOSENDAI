/**
 * audioModeration.test.ts: hidden audio's card carries MUTE THIS AUDIO and
 * BLOCK AUTHOR in its own row (AudioCard `moderation`), once, never on your
 * own; and a muted audio item, or a blocked hider's, leaves the world and
 * closes its card (the card's sound stops with it).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AudioCard } from '../AudioCard'
import { audioModeration, muteIdOf } from '../SecretModal'
import { useShards } from '../../store/useShards'
import { useCyberspace } from '../../store/useCyberspace'
import { useMutes } from '../../store/useMutes'
import { NOTHING_MUTED } from '../../lib/muteList'
import type { AudioItem } from '../../lib/audioItem'
import type { Hidden } from '../../lib/hidden'

const ME = '1'.repeat(64)
const HIDER = '2'.repeat(64)
const ID = '3'.repeat(64)
const audio: AudioItem = {
  title: 'Water trickling', about: '', url: 'https://blossom.test/' + 'ab'.repeat(32), mime: 'audio/mpeg', hash: 'ab'.repeat(32),
  originalHash: '', size: 1024, keyHex: 'ef'.repeat(32), nonceHex: '01'.repeat(12), autoplay: true, loop: true, retrigger: 'once', walkOnly: false,
}
const find = (author: string): Hidden => ({ eventId: ID, bagId: 'bag', lookupId: 'look', author, at: { x: 0n, y: 0n, z: 0n }, plane: 0, height: 5, createdAt: 1, type: 'audio', audio })
const audioCard = (mine: boolean): string => renderToString(createElement(AudioCard, { id: ID, triggerId: ID, audio, moderation: audioModeration({ key: ID }, HIDER, mine, () => {}) }))
const count = (html: string, s: string): number => html.split(s).length - 1
const source = readFileSync(join(__dirname, '..', 'SecretModal.tsx'), 'utf8')
const cardSource = readFileSync(join(__dirname, '..', 'AudioCard.tsx'), 'utf8')
const itemsSource = readFileSync(join(__dirname, '..', 'InventoryPanel.tsx'), 'utf8')

let identity: ReturnType<typeof useCyberspace.getState>['identity']
beforeEach(() => {
  identity = useCyberspace.getState().identity
  useCyberspace.setState({ identity: { ...identity, pubkey: ME } })
  useMutes.setState({ muted: NOTHING_MUTED })
})
afterEach(() => {
  useShards.setState({ discovered: {}, selectedSecret: null })
  useMutes.setState({ muted: NOTHING_MUTED })
  useCyberspace.setState({ identity })
})

describe('the audio card', () => {
  it('offers MUTE THIS AUDIO and BLOCK AUTHOR once, in its own row after PLAY', () => {
    const html = audioCard(false)
    expect(html).toContain('audio__moderation')
    expect(count(html, 'MUTE THIS AUDIO')).toBe(1)
    expect(count(html, 'BLOCK AUTHOR')).toBe(1)
    expect(html).not.toContain('MUTE THIS ITEM')
    expect(html.indexOf('audio__moderation')).toBeGreaterThan(html.indexOf('PLAY'))
    expect(html.indexOf('MUTE THIS AUDIO')).toBeGreaterThan(html.indexOf('audio__moderation'))
  })

  it('offers neither on your own audio', () => {
    const html = audioCard(true)
    expect(html).not.toContain('audio__moderation')
    expect(html).not.toContain('MUTE THIS AUDIO')
    expect(html).not.toContain('BLOCK AUTHOR')
  })

  it('is what the item modal hands the audio card, and the general row leaves audio out (source)', () => {
    expect(source).toMatch(/moderation=\{audioModeration\(item, author, mine, close\)\}/)
    expect(source).toMatch(/item\.type !== 'audio' && <MuteItemButton/)
    expect(source).toMatch(/item\.type !== 'audio' && <BlockButton/)
  })

  it('a muted audio item leaves the world, so the item modal has nothing to show', () => {
    useShards.setState({ curated: null, discovered: { [ID]: find(HIDER) } })
    expect(useShards.getState().secretByEvent(ID)).not.toBeNull()
    useMutes.setState({ muted: { pubkeys: new Set(), items: new Set([ID]) } })
    expect(useShards.getState().worldItems().some((w) => w.key === ID)).toBe(false)
    expect(useShards.getState().secretByEvent(ID)).toBeNull()
  })

  it('a blocked hider\'s audio leaves the world, so the item modal has nothing to show', () => {
    useShards.setState({ curated: null, discovered: { [ID]: find(HIDER) } })
    useMutes.setState({ muted: { pubkeys: new Set([HIDER]), items: new Set() } })
    expect(useShards.getState().worldItems().some((w) => w.key === ID)).toBe(false)
    expect(useShards.getState().secretByEvent(ID)).toBeNull()
  })

  it('stops its sound when it closes, and both places it is shown drop it when hidden (source)', () => {
    // The card's play ends with the card.
    expect(cardSource).toMatch(/useEffect\(\(\) => \(\) => stopAudio\(id\), \[id\]\)/)
    // The item modal renders nothing for an item worldItems no longer holds.
    expect(source).toMatch(/useMutes\(\(s\) => s\.muted\)/)
    expect(source).toMatch(/if \(!item \|\| !author\) return null/)
    // ITEMS lists nothing the mute list hides, by id or lineage, and its audio card has the same row.
    expect(itemsSource).toMatch(/hidesThing\(muted, \{ authors: \[it\.author\], ids: \[it\.id, itemLineage\(it\.event\)\] \}, self\)/)
    expect(itemsSource).toMatch(/label="MUTE THIS AUDIO"/)
  })

  it('mutes a moved item by its lineage, so a move by its hider stays muted', () => {
    const LINEAGE = '4'.repeat(64)
    expect(muteIdOf({ key: ID, lineage: LINEAGE })).toBe(LINEAGE)
    useShards.setState({ curated: null, discovered: { [ID]: { ...find(HIDER), inner: { id: ID, pubkey: HIDER, kind: 1063, created_at: 1, tags: [['d', LINEAGE]], content: '' } as never } } })
    useMutes.setState({ muted: { pubkeys: new Set(), items: new Set([LINEAGE]) } })
    expect(useShards.getState().worldItems().some((w) => w.key === ID)).toBe(false)
  })
})
