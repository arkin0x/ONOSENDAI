/**
 * useComments: the comments on one hidden item, and posting one.
 *
 * Fetched once per subject from the app's relays (every comment on the
 * bag, threaded to this item), posted by signing a kind 1111 with the
 * active signer and publishing it to the same relays. A posted comment is
 * shown at once; a failed publish says so and keeps the text.
 */

import { useCallback, useEffect, useState } from 'react'
import { commentTemplate, commentsFilter, itemParent, threadComments, type Comment, type CommentParent, type CommentSubject } from '../lib/comments'
import type { NostrEvent } from '../lib/events'
import { publish, query } from '../lib/relay'
import { useCyberspace } from '../store/useCyberspace'

export interface CommentsState {
  comments: Comment[]
  loading: boolean
  error: string | null
  posting: boolean
  /** Post a comment on the item, or a reply to one of its comments. Resolves true when a relay accepted it. */
  post: (text: string, parent?: CommentParent) => Promise<boolean>
  refresh: () => void
}

export function useComments(subject: CommentSubject | null): CommentsState {
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [tick, setTick] = useState(0)
  const key = subject ? `${subject.author}:${subject.lookupId}:${subject.itemId}` : null

  useEffect(() => {
    if (!subject) return
    let alive = true
    setLoading(true); setError(null); setEvents([])
    query(commentsFilter(subject))
      .then((found) => { if (alive) setEvents(found) })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])

  const post = useCallback(async (text: string, parent?: CommentParent): Promise<boolean> => {
    if (!subject) return false
    setPosting(true); setError(null)
    try {
      const template = commentTemplate(subject, parent ?? itemParent(subject), text, Math.floor(Date.now() / 1000))
      const event = await useCyberspace.getState().signEvent(template)
      const result = await publish(event)
      if (!result.ok) { setError(`Not published: ${result.reason}`); return false }
      setEvents((prev) => [...prev, event])
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setPosting(false)
    }
  }, [subject])

  const comments = subject ? threadComments(events, subject) : []
  return { comments, loading, error, posting, post, refresh: () => setTick((t) => t + 1) }
}
