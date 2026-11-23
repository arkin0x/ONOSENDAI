/**
 * commentLanding.test.tsx: VIEW lands on the comment a notification is
 * about, inside the thread it opens, and every face in a reaction row opens
 * that person's profile (arkinox, 2026-11-14).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis

const thread = vi.hoisted(() => ({
  comments: [
    { id: 'top', pubkey: 'a'.repeat(64), createdAt: 1, text: 'first', sealed: false, parentId: 'move', replies: [
      { id: 'reply', pubkey: 'b'.repeat(64), createdAt: 2, text: 'the reply', sealed: false, parentId: 'top', replies: [] },
    ] },
  ],
}))

vi.mock('../../hooks/useSocial', () => ({
  useActionComments: () => ({ comments: thread.comments, loading: false, error: null, trouble: null, posting: false, unavailable: false, post: async () => true, refresh: () => {} }),
  useReactions: () => ({ groups: [{ content: '🔥', pubkeys: ['a'.repeat(64), 'b'.repeat(64)], ids: new Map(), image: undefined }], loading: false, busy: false, error: null, toggle: async () => {} }),
}))
vi.mock('../../lib/relay', async (real) => ({ ...(await real<typeof import('../../lib/relay')>()), onAuthChange: () => () => {}, signInFailed: () => false, askEach: vi.fn(async () => []) }))

import { mount, textOf, type Mounted } from '../../test/elementRoot'
import { useModalFocus } from '../../store/useModalFocus'
import { useProfileView } from '../../store/useProfileView'
import { ActionComments, PublicComments } from '../Comments'
import { Reactions } from '../Reactions'

let mounted: Mounted | null = null
afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  useModalFocus.setState({ target: null, at: 0 })
  useProfileView.setState({ pubkey: null })
})

const target = { id: 'move', pubkey: 'c'.repeat(64), kind: 3333 }
const landed = (m: Mounted): string[] => m.all().filter((h) => String(h.props.className ?? '').includes('is-landed')).map(textOf)

describe('VIEW lands on the comment', () => {
  it('the reply a notification names glows, and nothing else', async () => {
    useModalFocus.getState().land({ comment: 'reply' })
    mounted = await mount(<ActionComments action={target} />)
    const lit = landed(mounted)
    expect(lit).toHaveLength(1)
    expect(lit[0]).toContain('the reply')
    expect(lit[0]).not.toContain('first')
  })

  it('a published shard\'s public comments land the same way', async () => {
    useModalFocus.getState().land({ comment: 'top' })
    mounted = await mount(<PublicComments target={{ id: 's', pubkey: 'c'.repeat(64), kind: 33331, address: `33331:${'c'.repeat(64)}:x` }} />)
    expect(landed(mounted)[0]).toContain('first')
    expect(mounted.all().find((h) => h.type === 'textarea')?.props.placeholder).toBe('Say something about this shard')
  })

  it('no landing asked: nothing glows', async () => {
    mounted = await mount(<ActionComments action={target} />)
    expect(landed(mounted)).toHaveLength(0)
  })
})

describe('VIEW lands on the reactions', () => {
  it('the reactions section glows when a reaction is what VIEW was for', async () => {
    useModalFocus.getState().land({ reactions: true })
    mounted = await mount(<Reactions target={target} />)
    expect(mounted.all().find((h) => h.type === 'section')?.props.className).toContain('is-landed')
  })

  it('each face opens that person\'s profile', async () => {
    mounted = await mount(<Reactions target={target} />)
    const faces = mounted.all().filter((h) => h.type === 'button' && String(h.props.className).includes('profile-tap'))
    expect(faces).toHaveLength(2)
    ;(faces[1].props.onClick as (e: unknown) => void)({ stopPropagation: () => {}, preventDefault: () => {} })
    expect(useProfileView.getState().pubkey).toBe('b'.repeat(64))
  })
})
