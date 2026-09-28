/**
 * useSocial: reactions on anything, and public comments on a chain action.
 *
 * Both read from this app's relays plus the author's read relays (inbox.ts),
 * which is where other clients send theirs, and publish to the same union
 * plus everyone tagged, so the author hears about it on whatever client they
 * use. Posting shows at once; a failed publish says so and changes nothing.
 */

import { useCallback, useEffect, useState } from 'react'
import { threadUnder, type CommentParent } from '../lib/comments'
import type { NostrEvent } from '../lib/events'
import { publishTo, relaysFor } from '../lib/inbox'
import { queryAny } from '../lib/relay'
import { actionCommentTemplate, deletedBy, groupReactions, reactionTemplate, unreactTemplate, REACTION_KIND, type ReactionGroup, type SocialTarget } from '../lib/social'
import { COMMENT_KIND } from '../lib/comments'
import { useCyberspace } from '../store/useCyberspace'
import type { CommentsState } from './useComments'

const now = (): number => Math.floor(Date.now() / 1000)

export interface ReactionsState {
  groups: ReactionGroup[]
  loading: boolean
  busy: boolean
  error: string | null
  /** React with `content`, or take it back if you already reacted with it. */
  toggle: (content: string) => Promise<void>
}

/** Reactions to one event. `alsoTell` tags more people than its author (the hider of a shard hidden by reference). */
export function useReactions(target: SocialTarget | null, alsoTell: string[] = []): ReactionsState {
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = target?.id ?? null
  const author = target?.pubkey ?? null

  useEffect(() => {
    if (!id || !author) { setEvents([]); return }
    let alive = true
    setLoading(true); setError(null); setEvents([])
    void (async () => {
      try {
        const relays = await relaysFor([author])
        const reactions = await queryAny(relays, { kinds: [REACTION_KIND], '#e': [id], limit: 500 })
        const ids = reactions.map((r) => r.id)
        const deletions = ids.length ? await queryAny(relays, { kinds: [5], '#e': ids, limit: 500 }) : []
        if (alive) setEvents([...reactions, ...deletions])
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [id, author])

  const authorOf = new Map(events.filter((e) => e.kind === REACTION_KIND).map((e) => [e.id, e.pubkey]))
  const groups = id ? groupReactions(events, id, deletedBy(events, authorOf)) : []

  const toggle = useCallback(async (content: string): Promise<void> => {
    if (!target) return
    const me = useCyberspace.getState().identity.pubkey
    setBusy(true); setError(null)
    try {
      const mine = groups.find((g) => g.content === content)?.ids.get(me)
      const template = mine ? unreactTemplate(mine, now()) : reactionTemplate(target, content, now(), alsoTell)
      const event = await useCyberspace.getState().signEvent(template)
      const result = await publishTo(event, [target.pubkey, ...alsoTell])
      if (!result.ok) { setError(`Not published: ${result.reason}`); return }
      setEvents((prev) => [...prev, event])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
    // groups is derived from events, which is in the closure through this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, events, alsoTell.join(',')])

  return { groups, loading, busy, error, toggle }
}

/** The public comments on one chain action, threaded, and posting one. */
export function useActionComments(action: SocialTarget | null): CommentsState {
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [tick, setTick] = useState(0)
  const id = action?.id ?? null
  const author = action?.pubkey ?? null

  useEffect(() => {
    if (!id || !author) { setEvents([]); return }
    let alive = true
    setLoading(true); setError(null); setEvents([])
    relaysFor([author])
      .then((relays) => queryAny(relays, { kinds: [COMMENT_KIND], '#E': [id], limit: 500 }))
      .then((found) => { if (alive) setEvents(found) })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id, author, tick])

  const post = useCallback(async (text: string, parent?: CommentParent): Promise<boolean> => {
    if (!action) return false
    setPosting(true); setError(null)
    try {
      const event = await useCyberspace.getState().signEvent(actionCommentTemplate(action, text, now(), parent))
      const result = await publishTo(event, [action.pubkey, ...(parent ? [parent.pubkey] : [])])
      if (!result.ok) { setError(`Not published: ${result.reason}`); return false }
      setEvents((prev) => [...prev, event])
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setPosting(false)
    }
  }, [action])

  const comments = id ? threadUnder(events, id, id) : []
  return { comments, loading, error, posting, post, refresh: () => setTick((t) => t + 1) }
}
