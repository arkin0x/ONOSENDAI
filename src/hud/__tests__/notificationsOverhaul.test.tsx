/**
 * notificationsOverhaul.test.tsx: the notifications modal and what it opens
 * (arkinox, 2026-11-14).
 *
 * - One action: every row's button says VIEW, and VIEW lands on what the
 *   notification is about, the comment (glowing) or the reactions.
 * - What VIEW opens stacks over the notifications modal: closing it, by
 *   Escape as by ✕, shows the notifications again. The profile is the same
 *   from anywhere.
 * - New ones carry the red dot and a lit row while the modal is open, and are
 *   read once it closes, kept per identity on this device.
 * - A shard you published and hid nowhere opens the hidden-thing card, PUBLIC
 *   beside YOURS, never "nothing to see".
 * - Any avatar opens the profile, over wherever it was tapped.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

// Timers the stores set on window, as the door tests stand it in.
;(globalThis as { window?: unknown }).window ??= globalThis
// The list's end-of-page watcher (NotificationsModal): a page that never scrolls.
;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= class { observe(): void {} disconnect(): void {} }

/** The published shard the relays hold, when a test puts one there. */
const relayHeld: { shard: unknown } = { shard: null }

vi.mock('../../lib/relay', async (real) => ({
  ...(await real<typeof import('../../lib/relay')>()),
  onAuthChange: () => () => {},
  onCanonicalSignIn: () => () => {},
  signInFailed: () => false,
  publishMany: vi.fn(async () => ({ ok: true })),
  publishTo: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async (_relays: string[], filter: { kinds?: number[] }) => (filter.kinds?.includes(33331) && relayHeld.shard ? [relayHeld.shard] : [])),
  queryAnyChecked: vi.fn(async () => ({ events: [], trouble: null })),
  // Profiles (store/useProfiles): none on these relays.
  askEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../lib/inbox', async (real) => ({ ...(await real<typeof import('../../lib/inbox')>()), relaysFor: async () => ['wss://relay.test'] }))
// The turning preview draws with WebGL; a test has none.
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newShard } from 'sno-core/shards'
import { objectFromEvent } from 'sno-core/feed'
import { mount, settled, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { useNotifications } from '../../store/useNotifications'
import { useCyberspace } from '../../store/useCyberspace'
import { useProfileView } from '../../store/useProfileView'
import { usePublicShard } from '../../store/usePublicShard'
import { useModalFocus, landsHere, useLandOn, LAND_WAIT_MS } from '../../store/useModalFocus'
import { landingOf, type Notification } from '../../lib/notifications'
import { publicObjectTemplate } from '../../lib/published'
import { escapeTop } from '../../hooks/useEscape'
import { leaveModals, stackedOpen } from '../modalStack'
import { NotificationsModal, NotificationsToast, view } from '../Notifications'
import { PublicShardModal } from '../SecretModal'
import { ProfileView } from '../ProfileView'
import { ProfileTap } from '../ProfileBadge'

const mySk = generateSecretKey()
const ME = getPublicKey(mySk)
const THEM = getPublicKey(generateSecretKey())
const T0 = 1_800_000_000

/** A shard you published, as the relays hold it. */
function publishedShard(sk = mySk): ReturnType<typeof finalizeEvent> {
  const shard = { ...newShard('Skulls'), id: 'maze-kit/skulls', vertices: [{ p: [0, 0, 0], c: [255, 0, 0] }, { p: [1, 0, 0], c: [0, 255, 0] }, { p: [0, 1, 0], c: [0, 0, 255] }], faces: [[0, 1, 2]] } as ReturnType<typeof newShard>
  return finalizeEvent(publicObjectTemplate(shard, T0), sk)
}

function note(over: Partial<Notification> & Pick<Notification, 'id' | 'createdAt' | 'on' | 'what'>): Notification {
  return { from: THEM, content: '+', sealed: false, ciphertext: null, bag: null, ...over }
}

const ADDRESS = `33331:${ME}:maze-kit/skulls`
const notes: Notification[] = [
  note({ id: 'a'.repeat(64), createdAt: T0 + 30, what: 'reaction', content: '🔥', on: { type: 'item', id: 'f'.repeat(64), address: ADDRESS, kind: 33331 } }),
  note({ id: 'b'.repeat(64), createdAt: T0 + 20, what: 'comment', content: 'nice move', on: { type: 'action', id: 'e'.repeat(64) } }),
  note({ id: 'c'.repeat(64), createdAt: T0 + 10, what: 'comment', content: 'agreed', on: { type: 'comment', id: 'd'.repeat(64) } }),
  note({ id: '1'.repeat(64), createdAt: T0 + 5, what: 'mention', content: 'hi', on: { type: 'chat', id: '1'.repeat(64) } }),
]

/** The notifications store as a page of `notes` leaves it, seen up to `lastSeen`. */
function seed(lastSeen: number): void {
  useNotifications.setState({ me: ME, items: notes, opened: {}, lastSeen, loading: false, done: true, trouble: null, open: false })
}

function rows(m: Mounted): Host[] {
  return m.all().filter((h) => h.type === 'li' && String(h.props.className ?? '').includes('notif__row'))
}

let mounted: Mounted | null = null
beforeEach(() => {
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: ME } })
  relayHeld.shard = null
  localStorage.clear()
})
afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  leaveModals()
  useProfileView.setState({ pubkey: null, editing: false })
  usePublicShard.setState({ object: null })
  useModalFocus.setState({ target: null, at: 0 })
})

describe('one action: VIEW', () => {
  it('every row says VIEW, whatever it is about, and nothing else', async () => {
    seed(T0 + 100)
    useNotifications.setState({ open: true })
    mounted = await mount(<NotificationsModal />)
    expect(rows(mounted)).toHaveLength(4)
    const labels = mounted.buttons(/^(VIEW|OPENING…)/).map(textOf)
    expect(labels).toEqual(['VIEW', 'VIEW', 'VIEW', 'VIEW'])
    for (const old of ['VIEW ITEM', 'VIEW SHARD', 'VIEW THREAD', 'VIEW MOVE', 'VIEW IN CHAT']) expect(mounted.says(old)).toBe(false)
  })

  it('lands on the comment for a comment or a reply, your comment for a reaction to it, the reactions otherwise', () => {
    expect(landingOf(notes[1])).toEqual({ comment: notes[1].id })
    expect(landingOf(notes[2])).toEqual({ comment: notes[2].id })
    expect(landingOf({ id: 'x', what: 'reaction', on: { type: 'comment', id: 'mine' } })).toEqual({ comment: 'mine' })
    expect(landingOf(notes[0])).toEqual({ reactions: true })
    expect(landingOf(notes[3])).toBeNull()
  })

  it('the landing scrolls its target into view once, glows, and is spent; a stale one lands nowhere', async () => {
    const scrolled: string[] = []
    function Target({ id }: { id: string }): JSX.Element {
      const { ref, lit } = useLandOn<HTMLDivElement>({ comment: id })
      // The test renderer has no layout: stand in for the element it would scroll.
      ;(ref as { current: unknown }).current = { scrollIntoView: () => scrolled.push(id) }
      return <div className={lit ? 'is-landed' : ''}>{id}</div>
    }
    useModalFocus.getState().land({ comment: 'two' })
    mounted = await mount(<><Target id="one" /><Target id="two" /></>)
    const lit = mounted.all().filter((h) => h.props.className === 'is-landed').map(textOf)
    expect(lit).toEqual(['two'])
    expect(scrolled).toContain('two')
    expect(scrolled).not.toContain('one')
    expect(useModalFocus.getState().target).toBeNull()
    expect(landsHere({ target: { reactions: true }, at: 0 }, 'reactions', LAND_WAIT_MS + 1)).toBe(false)
    expect(landsHere({ target: { reactions: true }, at: 0 }, 'reactions', 10)).toBe(true)
  })
})

describe('VIEW on a shard you published and hid nowhere', () => {
  it('opens its card over the notifications, which stay open, and asks to land on the reactions', async () => {
    const ev = publishedShard()
    relayHeld.shard = ev
    seed(T0 + 100)
    useNotifications.setState({ open: true })
    mounted = await mount(<><NotificationsModal /><PublicShardModal /></>)
    expect(await view(notes[0])).toBeNull()
    await settled()
    expect(usePublicShard.getState().object?.address).toBe(`33331:${ME}:maze-kit/skulls`)
    // Landed: the card's reactions glow, and the landing is spent.
    const reactions = mounted.all().find((h) => h.type === 'section' && h.props['aria-label'] === 'Reactions')
    expect(String(reactions?.props.className)).toContain('is-landed')
    expect(useModalFocus.getState().target).toBeNull()
    expect(useNotifications.getState().open).toBe(true)
    expect(mounted.says('PUBLIC')).toBe(true)
    expect(mounted.says('That shard is published')).toBe(false)
  })

  it('a VIEW answered after the list was closed opens nothing', async () => {
    relayHeld.shard = publishedShard()
    seed(T0 + 100)
    useNotifications.setState({ open: true })
    const pending = view(notes[0])
    useNotifications.setState({ open: false })
    expect(await pending).toBeNull()
    expect(usePublicShard.getState().object).toBeNull()
  })

  it('says why when no relay has it, and leaves no landing behind', async () => {
    seed(T0 + 100)
    expect(await view(notes[0])).toBe('That shard could not be found on any relay.')
    expect(useModalFocus.getState().target).toBeNull()
  })
})

describe('the published shard card', () => {
  it('is the hidden-thing card: name, LEFT BY, reactions, comments, metadata, with PUBLIC beside YOURS', async () => {
    usePublicShard.getState().open(objectFromEvent(publishedShard())!)
    mounted = await mount(<PublicShardModal />)
    for (const words of ['SHARD', 'YOURS', 'PUBLIC', 'Skulls', 'Left by', 'Reactions', 'Comments', 'METADATA']) expect(mounted.says(words)).toBe(true)
  })

  it('has nothing that belongs to a place: no VIEW to fly to, no DELETE', async () => {
    usePublicShard.getState().open(objectFromEvent(publishedShard())!)
    mounted = await mount(<PublicShardModal />)
    expect(mounted.buttons(/^VIEW$/)).toHaveLength(0)
    expect(mounted.buttons('DELETE')).toHaveLength(0)
    // Your own goes to the workshop under its own address, as from the Shard Feed.
    expect(mounted.buttons('OPEN IN WORKSHOP')).toHaveLength(1)
    expect(mounted.buttons('COPY TO WORKSHOP')).toHaveLength(0)
  })

  it('someone else\'s: PUBLIC alone, and their TARGET and BLOCK', async () => {
    usePublicShard.getState().open(objectFromEvent(publishedShard(generateSecretKey()))!)
    mounted = await mount(<PublicShardModal />)
    expect(mounted.says('PUBLIC')).toBe(true)
    expect(mounted.says('YOURS')).toBe(false)
    expect(mounted.buttons('TARGET CREATOR')).toHaveLength(1)
    // Someone else's: a credited REMIX, as from the Shard Feed.
    expect(mounted.buttons('REMIX')).toHaveLength(1)
  })

  it('a comment on someone else\'s published shard that tags you says "a shard", not yours', async () => {
    const OTHER = getPublicKey(generateSecretKey())
    useNotifications.setState({ me: ME, items: [note({ id: '8'.repeat(64), createdAt: T0, what: 'comment', content: 'hi', on: { type: 'item', id: 'f'.repeat(64), kind: 33331, address: `33331:${OTHER}:x` } })], lastSeen: T0, open: true, loading: false, done: true, trouble: null })
    mounted = await mount(<NotificationsModal />)
    expect(mounted.says('commented on a shard')).toBe(true)
    expect(mounted.says('your hidden item')).toBe(false)
  })
})

describe('closing comes back to the modal underneath', () => {
  it('Escape on the shard card shows the notifications again; again closes them', async () => {
    seed(T0 + 100)
    useNotifications.getState().setOpen(true)
    mounted = await mount(<><NotificationsModal /><PublicShardModal /></>)
    usePublicShard.getState().open(objectFromEvent(publishedShard())!)
    await settled()
    expect(stackedOpen()).toBe(2)
    expect(escapeTop()).toBe(true)
    await settled()
    expect(usePublicShard.getState().object).toBeNull()
    expect(useNotifications.getState().open).toBe(true)
    expect(escapeTop()).toBe(true)
    await settled()
    expect(useNotifications.getState().open).toBe(false)
  })

  it('✕ on the shard card does the same as Escape', async () => {
    seed(T0 + 100)
    useNotifications.getState().setOpen(true)
    mounted = await mount(<><NotificationsModal /><PublicShardModal /></>)
    usePublicShard.getState().open(objectFromEvent(publishedShard())!)
    await settled()
    const closes = mounted.all().filter((h) => h.type === 'button' && h.props['aria-label'] === 'Close')
    expect(closes).toHaveLength(2)
    // The shard card's ✕ (it mounts after the notifications in this tree).
    ;(closes[1].props.onClick as () => void)()
    await settled()
    expect(usePublicShard.getState().object).toBeNull()
    expect(useNotifications.getState().open).toBe(true)
  })

  it('leaving for the world closes the whole stack', async () => {
    seed(T0 + 100)
    useNotifications.getState().setOpen(true)
    mounted = await mount(<><NotificationsModal /><PublicShardModal /></>)
    usePublicShard.getState().open(objectFromEvent(publishedShard())!)
    await settled()
    leaveModals()
    await settled()
    expect(usePublicShard.getState().object).toBeNull()
    expect(useNotifications.getState().open).toBe(false)
  })
})

describe('new and read', () => {
  it('rows newer than the last look carry the dot and the lit row while the modal is open', async () => {
    seed(T0 + 15)
    useNotifications.getState().setOpen(true)
    mounted = await mount(<NotificationsModal />)
    const fresh = rows(mounted).map((r) => String(r.props.className).includes('is-new'))
    expect(fresh).toEqual([true, true, false, false])
    const dots = mounted.all().filter((h) => String(h.props.className ?? '').includes('notif__dot--row'))
    expect(dots).toHaveLength(2)
  })

  it('opening does not read them; closing does, and the badge and toast clear with it', async () => {
    seed(T0 + 15)
    useNotifications.getState().setOpen(true)
    expect(useNotifications.getState().lastSeen).toBe(T0 + 15)
    mounted = await mount(<NotificationsToast />)
    expect(mounted.buttons('more').length + mounted.buttons('tagged').length + mounted.buttons('reacted').length).toBeGreaterThan(0)
    useNotifications.getState().setOpen(false)
    await settled()
    expect(useNotifications.getState().lastSeen).toBe(T0 + 30)
    expect(mounted.all()).toHaveLength(0)
  })

  it('a row that arrives while the modal is open, unseen under a card, stays new', async () => {
    seed(T0 + 15)
    useNotifications.getState().setOpen(true)
    const later = note({ id: '9'.repeat(64), createdAt: T0 + 500, what: 'reaction', on: { type: 'action', id: 'e'.repeat(64) } })
    useNotifications.setState({ items: [later, ...notes] })
    useNotifications.getState().setOpen(false)
    expect(useNotifications.getState().lastSeen).toBe(T0 + 30)
  })

  it('an identity switched while it was open reads nothing it was never shown', async () => {
    seed(T0 + 15)
    useNotifications.getState().setOpen(true)
    useNotifications.setState({ me: THEM, lastSeen: 0 })
    useNotifications.getState().setOpen(false)
    expect(useNotifications.getState().lastSeen).toBe(0)
    expect(localStorage.getItem(`onosendai:notif-seen:${THEM}`)).toBeNull()
  })

  it('is kept per identity on this device', async () => {
    seed(T0 + 15)
    useNotifications.getState().setOpen(true)
    useNotifications.getState().setOpen(false)
    expect(localStorage.getItem(`onosendai:notif-seen:${ME}`)).toBe(String(T0 + 30))
    expect(localStorage.getItem(`onosendai:notif-seen:${THEM}`)).toBeNull()
    // Read back when that identity's list next loads.
    useNotifications.setState({ me: null })
    await useNotifications.getState().start(ME)
    expect(useNotifications.getState().lastSeen).toBe(T0 + 30)
  })
})

describe('an avatar opens the profile, and closing it comes back', () => {
  it('a row\'s picture and name open the profile over the notifications; Escape returns to them', async () => {
    seed(T0 + 100)
    useNotifications.getState().setOpen(true)
    mounted = await mount(<><NotificationsModal /><ProfileView /></>)
    const taps = mounted.all().filter((h) => h.type === 'button' && String(h.props.className ?? '').includes('profile-tap'))
    expect(taps.length).toBeGreaterThanOrEqual(8)
    ;(taps[0].props.onClick as (e: unknown) => void)({ stopPropagation: () => {}, preventDefault: () => {} })
    await settled()
    expect(useProfileView.getState().pubkey).toBe(THEM)
    expect(mounted.says('PROFILE')).toBe(true)
    expect(escapeTop()).toBe(true)
    await settled()
    expect(useProfileView.getState().pubkey).toBeNull()
    expect(useNotifications.getState().open).toBe(true)
  })

  it('inside another button (a toast, a row) it is a span that acts as a button, and stops the tap there', async () => {
    let outer = 0
    mounted = await mount(<button onClick={() => { outer += 1 }}><ProfileTap pubkey={THEM} nested><span>pic</span></ProfileTap></button>)
    const span = mounted.all().find((h) => h.type === 'span' && h.props.role === 'button')!
    expect(span).toBeTruthy()
    let stopped = false
    ;(span.props.onClick as (e: unknown) => void)({ stopPropagation: () => { stopped = true }, preventDefault: () => {} })
    expect(stopped).toBe(true)
    expect(outer).toBe(0)
    expect(useProfileView.getState().pubkey).toBe(THEM)
  })

  it('the toast\'s picture is one too', async () => {
    seed(T0 + 15)
    mounted = await mount(<NotificationsToast />)
    expect(mounted.all().some((h) => h.type === 'span' && h.props.role === 'button' && String(h.props.className).includes('profile-tap'))).toBe(true)
  })
})
