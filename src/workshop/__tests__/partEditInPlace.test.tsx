/**
 * partEditInPlace.test.tsx: a placed object opened to edit in place by a
 * double-tap (useWorkshop enterPart), BACK up one level at any depth, the
 * workshop's ✕ only at the top, and the LINK or COPY mark on every placed
 * object and beside the publish status (lib/partForm.ts; owner, 2026-11-22).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { newShard, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { useWorkshop } from '../../store/useWorkshop'
import { useCyberspace } from '../../store/useCyberspace'
import { FORM_LABEL, partForm, shardForm, stillPublished } from '../../lib/partForm'
import { shardFingerprint, type Ledger } from '../../lib/published'
import { PartFormBadge } from '../PartFormBadge'
import { MAX_BADGES, badgeSpots } from '../PartBadges'
import { WayOut, backToName } from '../shell/TopBar'
import { setLocalAuthor } from '../../lib/carried'

const W = () => useWorkshop.getState()
const me = (): string => useCyberspace.getState().identity.pubkey
const THEM = 'b'.repeat(64)

function tri(name: string, id: string): ShardModel {
  return { ...newShard(name), id, mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
}
function placing(name: string, id: string, refs: Ref[], extra: Partial<ShardModel> = {}): ShardModel {
  return { ...newShard(name), id, mode: 'solid', vertices: [], faces: [], refs, parts: refs.map((_, i) => ({ ref: i, at: [i * 240, 0, 0], turn: [0, 0, 0], step: 0 })), ...extra }
}
const own = (d: string): Ref => ['a', `33331:${me()}:${d}`]
/** A vertex added to the shard on the bench: one edit. */
const editHere = (): void => { W().addVertex([5, 5, 5]) }
const byId = (id: string) => W().shards.find((s) => s.id === id)

beforeEach(() => {
  // Who "you" are, as store/localObjects.ts wires it at boot.
  setLocalAuthor(() => useCyberspace.getState().identity.pubkey)
  useWorkshop.setState({ shards: [], currentId: null, backStack: [], past: [], future: [], selection: [], partSel: [], notice: null, tool: 'view' })
})

describe('the LINK or COPY rule (lib/partForm.ts)', () => {
  it('a shard of yours is a link while published under your key and unedited, a copy otherwise', () => {
    const tile = tri('Tile', 'tile')
    const published: Ledger = { tile: { at: 1, fp: shardFingerprint(tile), pubkey: me() } }
    expect(stillPublished(tile, published, me())).toBe(true)
    expect(shardForm(tile, published, me())).toBe('link')
    expect(shardForm({ ...tile, name: 'Tile, edited' }, published, me())).toBe('copy')
    expect(shardForm(tile, {}, me())).toBe('copy')
    expect(shardForm(tile, { tile: { at: 1, fp: shardFingerprint(tile), pubkey: THEM } }, me())).toBe('copy')
  })

  it('a relay hint and anyone else\'s object are links; a table entry and an unpublished piece are copies', () => {
    const piece = tri('Piece', 'piece')
    const find = (id: string) => (id === 'piece' ? piece : undefined)
    const carried = `33331:${me()}:carried`
    const parent = { objects: { [carried]: toPayload(piece) } } as unknown as ShardModel
    expect(partForm(['a', `33331:${me()}:piece`, 'wss://relay.test'], parent, me(), find, {})).toBe('link')
    expect(partForm(['a', `33331:${THEM}:theirs`], parent, me(), find, {})).toBe('link')
    expect(partForm(['a', carried], parent, me(), find, {})).toBe('copy')
    expect(partForm(own('piece'), parent, me(), find, {})).toBe('copy')
    expect(partForm(own('not-here'), parent, me(), find, {})).toBe('link')
    expect(partForm(['e', 'f'.repeat(64)], parent, me(), find, {})).toBe('link')
  })

  it('the badge says it in colour, icon and words, the same everywhere', () => {
    const link = renderToStaticMarkup(<PartFormBadge form="link" />)
    const copy = renderToStaticMarkup(<PartFormBadge form="copy" size="inline" />)
    expect(link).toContain('partform--link')
    expect(link).toContain(`aria-label="${FORM_LABEL.link}"`)
    expect(link).toContain('lucide-link')
    expect(copy).toContain('partform--copy')
    expect(copy).toContain(`aria-label="${FORM_LABEL.copy}"`)
    expect(copy).toContain('lucide-copy')
  })

  it('a mark stands on the top corner of every placed object, and none on a floor of very many', () => {
    const parent = placing('Arch', 'arch', [own('a'), own('b')])
    const spots = badgeSpots(parent, new Map(), (i) => (i === 0 ? 'copy' : 'link'))
    expect(spots.map((s) => [s.index, s.form])).toEqual([[0, 'copy'], [1, 'link']])
    // An unresolved object is the unit placeholder cube: its top corner is half a unit up.
    expect(spots[0].at).toEqual([0.5, 0.5, 0.5])
    expect(spots[1].at[0]).toBeCloseTo(2.5)
    const floor = placing('Floor', 'floor', Array.from({ length: MAX_BADGES + 1 }, (_, i) => own(`t${i}`)))
    expect(badgeSpots(floor, new Map(), () => 'link')).toEqual([])
  })
})

describe('double-tap opens a placed object to edit in place; BACK goes up', () => {
  it('a shard of yours opens as itself, and BACK brings the parent back with its own UNDO', () => {
    useWorkshop.setState({ shards: [tri('Column', 'column'), placing('Hall', 'hall', [own('column')])], currentId: 'hall' })
    editHere()
    expect(W().past).toHaveLength(1)
    return W().enterPart(0).then(() => {
      expect(W().currentId).toBe('column')
      expect(W().backStack.map((f) => f.id)).toEqual(['hall'])
      editHere()
      expect(byId('column')!.vertices).toHaveLength(4)
      W().back()
      expect(W().currentId).toBe('hall')
      expect(W().backStack).toEqual([])
      expect(W().past).toHaveLength(1)
    })
  })

  it('nests to any depth: BACK goes up one level each time', async () => {
    useWorkshop.setState({ shards: [tri('Base', 'base'), placing('Column', 'column', [own('base')]), placing('Hall', 'hall', [own('column')])], currentId: 'hall' })
    await W().enterPart(0)
    await W().enterPart(0)
    expect(W().currentId).toBe('base')
    expect(W().backStack.map((f) => f.id)).toEqual(['hall', 'column'])
    W().back()
    expect(W().currentId).toBe('column')
    W().back()
    expect(W().currentId).toBe('hall')
    W().back()
    expect(W().currentId).toBe('hall')
  })

  it('a LINK opens as your copy; the parent follows only on its first edit, and its UNDO puts the link back', async () => {
    const statue = tri('Statue', 'statue')
    const link: Ref = ['a', `33331:${THEM}:statue`, 'wss://relay.test']
    useWorkshop.setState({ shards: [placing('Plaza', 'plaza', [link])], currentId: 'plaza' })
    await W().enterPart(0, async () => toPayload(statue))
    const copyId = W().currentId!
    expect(copyId).not.toBe('plaza')
    expect(byId(copyId)!.name).toBe('Statue')
    // Credited to its author, as a REMIX is.
    expect(JSON.stringify(byId(copyId))).toContain(`33331:${THEM}:statue`)
    expect(byId('plaza')!.refs).toEqual([link])
    editHere()
    expect(byId('plaza')!.refs).toEqual([own(copyId)])
    W().back()
    expect(partForm(byId('plaza')!.refs![0], byId('plaza')!, me(), byId, {})).toBe('copy')
    W().undo()
    expect(byId('plaza')!.refs).toEqual([link])
  })

  it('a LINK only looked at leaves nothing behind: its copy goes on BACK', async () => {
    const link: Ref = ['a', `33331:${THEM}:statue`, 'wss://relay.test']
    useWorkshop.setState({ shards: [placing('Plaza', 'plaza', [link])], currentId: 'plaza' })
    await W().enterPart(0, async () => toPayload(tri('Statue', 'statue')))
    expect(W().shards).toHaveLength(2)
    W().back()
    expect(W().shards.map((s) => s.id)).toEqual(['plaza'])
    expect(byId('plaza')!.refs).toEqual([link])
  })

  it('a table entry opens as your copy; its first edit makes it a shard and the entry goes', async () => {
    const carried = `33331:${me()}:carried`
    useWorkshop.setState({ shards: [placing('Pond', 'pond', [['a', carried]], { objects: { [carried]: toPayload(tri('Water', 'water')) } as ShardModel['objects'] })], currentId: 'pond' })
    await W().enterPart(0)
    const copyId = W().currentId!
    expect(byId(copyId)!.name).toBe('Water')
    editHere()
    expect(byId('pond')!.refs).toEqual([own(copyId)])
    expect(byId('pond')!.objects).toBeUndefined()
  })

  it('a LINK that does not come back opens nothing, and says so', async () => {
    useWorkshop.setState({ shards: [placing('Plaza', 'plaza', [['a', `33331:${THEM}:gone`]])], currentId: 'plaza' })
    await W().enterPart(0, async () => null)
    expect(W().currentId).toBe('plaza')
    expect(W().backStack).toEqual([])
    expect(W().notice).toMatch(/did not come back/)
  })

  it('a shard picked from the list leaves the way in, and an unedited copy with it', async () => {
    useWorkshop.setState({ shards: [tri('Other', 'other'), placing('Plaza', 'plaza', [['a', `33331:${THEM}:statue`]])], currentId: 'plaza' })
    await W().enterPart(0, async () => toPayload(tri('Statue', 'statue')))
    W().select('other')
    expect(W().backStack).toEqual([])
    expect(W().shards.map((s) => s.id).sort()).toEqual(['other', 'plaza'])
  })

  it('a published piece of yours, edited in place, is a COPY from then on', async () => {
    const tile = tri('Tile', 'tile')
    const ledger: Ledger = { tile: { at: 1, fp: shardFingerprint(tile), pubkey: me() } }
    useWorkshop.setState({ shards: [tile, placing('Floor', 'floor', [own('tile')])], currentId: 'floor' })
    expect(partForm(own('tile'), byId('floor')!, me(), byId, ledger)).toBe('link')
    await W().enterPart(0)
    editHere()
    W().back()
    expect(partForm(own('tile'), byId('floor')!, me(), byId, ledger)).toBe('copy')
  })
})

describe('the way out: ✕ at the top, BACK inside', () => {
  it('shows ✕ at the top and BACK, naming the shard it goes back to, inside', async () => {
    useWorkshop.setState({ shards: [tri('Column', 'column'), placing('Hall', 'hall', [own('column')])], currentId: 'hall' })
    expect(backToName(W())).toBeNull()
    const top = renderToStaticMarkup(<WayOut backTo={backToName(W())} />)
    expect(top).toContain('aria-label="Close the workshop"')
    await W().enterPart(0)
    expect(backToName(W())).toBe('Hall')
    const inside = renderToStaticMarkup(<WayOut backTo={backToName(W())} />)
    expect(inside).toContain('aria-label="Back to Hall"')
    expect(inside).not.toContain('Close the workshop')
  })
})
