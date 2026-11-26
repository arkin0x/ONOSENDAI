/**
 * nearbyLetters.test.tsx: messages and sounds in DISCOVERED NEARBY (owner,
 * 2026-11-26): a message's picture is its folded letter with the seal in its
 * author's colour, whole until read and broken after; two lines of its words;
 * the author's dot and name; when it was sealed, in plain words, never
 * "Ideaspace, height 6"; and which way it is, with an arrow. A sound's
 * picture is its waveform. Your own is "you", as the world says it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
;(globalThis as { window?: unknown }).window ??= globalThis
vi.mock('../../hooks/useNearbyLoot', () => ({ useNearbyLoot: () => [] }))

import { Row } from '../NearbyLootModal'
import { mount, type Host } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useHyperspace } from '../../store/useHyperspace'
import { useMessagesRead } from '../../store/useMessagesRead'
import { authorColour } from '../../lib/authorColour'
import { forgetViewPose, recordViewPose } from '../../lib/viewPose'
import type { NearbyItem } from '../../hooks/useNearbyLoot'

const ME = useCyberspace.getState().identity.pubkey
const MOLLY = 'a1'.repeat(32)
const now = Math.floor(Date.now() / 1000)
const base = { at: { x: 1n, y: 2n, z: 3n }, plane: 1, height: 6, mine: false, createdAt: now - 7200, distance: 9n }
const message = (over: Partial<NearbyItem> = {}): NearbyItem => ({ ...base, key: 'm'.repeat(64), type: 'message', author: MOLLY, text: 'The door on the north wall opens if you carry the blue key. Bring a friend.', ...over }) as unknown as NearbyItem
const sound = { ...base, key: 's'.repeat(64), type: 'audio', author: MOLLY, audio: { title: 'Night lattice', about: 'Recorded where the column used to be.', hash: 'ab'.repeat(32), url: 'https://blossom.test/x' } } as unknown as NearbyItem
/**
 * The row mounted for real (the stores' live state, not their first), written
 * out as markup enough to read: each element's class, style and fill, and its words.
 */
async function row(item: NearbyItem): Promise<string> {
  const m = await mount(<ul><Row item={item} me={ME} onView={() => undefined} /></ul>)
  const out = (h: Host | string): string => {
    if (typeof h === 'string') return h
    if (h.type === '#text') return String(h.props.text)
    const style = h.props.style ? ` style="${Object.entries(h.props.style as Record<string, unknown>).map(([k, v]) => `${k}:${String(v)}`).join(';')}"` : ''
    const attrs = `${h.props.className ? ` class="${String(h.props.className)}"` : ''}${style}${h.props.fill ? ` fill="${String(h.props.fill)}"` : ''}`
    return `<${h.type}${attrs}>${h.children.map(out).join('')}</${h.type}>`
  }
  const html = m.all().length ? out(m.all()[0]) : ''
  await m.unmount()
  return html
}

beforeEach(() => {
  useMessagesRead.setState({ owner: ME, read: { ids: [] }, ready: true })
  useHyperspace.setState({ tipHeight: 975_420 })
  forgetViewPose()
})

describe('a message row', () => {
  it('shows the folded letter with a whole seal in the author’s colour, UNREAD, two lines of words, the dot and name and the block', async () => {
    const html = await row(message())
    expect(html).toContain('letterthumb')
    expect(html).toContain('seal--whole')
    expect(html).toContain(`fill="${authorColour(MOLLY)}"`)
    expect(html).toContain('UNREAD')
    expect(html).toContain('nearby__label--two')
    expect(html).toContain('Bring a friend.')
    expect(html).toContain('authordot')
    expect(html).toContain('sealed at block 975,408')
    expect(html).not.toMatch(/Ideaspace|Dataspace|height 6/)
  })

  it('breaks the seal once read, and drops UNREAD', async () => {
    useMessagesRead.setState({ read: { ids: ['m'.repeat(64)] } })
    const html = await row(message())
    expect(html).toContain('seal--broken')
    expect(html).not.toContain('UNREAD')
  })

  it('says "you" for your own, its seal broken (you wrote it)', async () => {
    const html = await row(message({ author: ME }))
    expect(html).toContain('<span class="nearby__who">you</span>')
    expect(html).toContain('seal--broken')
  })

  it('says which way it is from the view, with the arrow turned to it, and how far', async () => {
    // The camera looks down -z from the item's side; the item is up and to the left of where it looks.
    const cs = useCyberspace.getState()
    useCyberspace.setState({ anchor: { x: 1n, y: 2n, z: 3n }, scaleExp: 0 })
    recordViewPose({ x: 6, y: -6, z: 4 }, { x: 0, y: 0, z: 0, w: 1 })
    const html = await row(message())
    expect(html).toContain('Up and to the left')
    expect(html).toMatch(/lucide-navigation-2[^>]*style="transform:rotate\(31\dDEG\)"/i)
    expect(html).toContain('away')
    useCyberspace.setState({ anchor: cs.anchor, scaleExp: cs.scaleExp })
  })

  it('a coin keeps its coin picture', async () => {
    const html = await row(message({ text: `cashuBo2Ft${'A'.repeat(200)}` } as Partial<NearbyItem>))
    expect(html).not.toContain('letterthumb')
  })
})

describe('a sound row', () => {
  it('shows its waveform in the chamfered frame, and its title and line in two lines of words', async () => {
    const html = await row(sound)
    expect(html).toContain('wavethumb')
    expect(html).toContain('--chamfer-size:80px')
    expect(html).toContain('Night lattice · Recorded where the column used to be.')
    expect(html).toContain('nearby__label--two')
  })
})
